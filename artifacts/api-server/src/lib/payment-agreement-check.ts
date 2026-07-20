/**
 * Court Payment Agreement auto-check.
 *
 * Watches every ACTIVE payment agreement against the live Rentec ledger and
 * flips installments between pending/paid/missed. Satisfaction is CUMULATIVE:
 * ledger payments received since the agreement date are applied to the
 * installments oldest-first, so early or combined payments count. An unpaid
 * installment whose due date is strictly past becomes 'missed' — and the moment
 * one newly transitions to missed, Jacob is notified on every channel (push,
 * task, case timeline, best-effort email) so he can file for a set-out.
 *
 * Never throws — every agreement is processed inside its own try/catch.
 */
import { eq, inArray, asc } from "drizzle-orm";
import {
  db,
  evictionCasesTable,
  evictionTimelineTable,
  paymentAgreementsTable,
  paymentInstallmentsTable,
  tasksTable,
  type PaymentAgreement,
  type PaymentInstallment,
} from "@workspace/db";
import * as rentec from "../services/rentec";
import { getTenantContact } from "../services/situation-ledger";
import { notifyUser } from "./web-push";
import { sendEmail } from "./email";
import { logger } from "./logger";

const APP_URL = process.env.APP_URL || "https://app.kellcommercial.com";
const JACOB_EMAIL = process.env.ADMIN_EMAIL || "admin@kellcommercial.com";

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmtDate = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
};

/** Sum of non-hidden ledger credits (payments received) since the agreement
 *  date. Returns null when the Rentec ledger cannot be read — the caller then
 *  skips ledger-based transitions rather than raising false missed alarms. */
async function ledgerPaymentsSince(
  address: string,
  leaseId: string | null,
  sinceDate: string,
): Promise<number | null> {
  if (!rentec.hasApiKey()) return null;
  const contact = await getTenantContact({ address, leaseId });
  if (!contact.renterId) return null;
  try {
    const ledger = await rentec.getTenantLedger(contact.renterId);
    let sum = 0;
    for (const line of ledger.lines) {
      if (line.hidden) continue;
      if (line.credit && line.credit > 0 && line.date >= sinceDate) sum += line.credit;
    }
    return Math.round(sum * 100) / 100;
  } catch (err) {
    logger.warn({ err, address }, "payment-agreement-check: ledger fetch failed");
    return null;
  }
}

async function addTimeline(caseId: number, notes: string): Promise<void> {
  await db.insert(evictionTimelineTable).values({
    evictionCaseId: caseId, stage: "payment_plan", notes, createdBy: "system",
  });
}

async function onInstallmentMissed(a: PaymentAgreement, inst: PaymentInstallment): Promise<void> {
  const amount = num(inst.amount);
  const due = fmtDate(inst.dueDate);
  // a. Push — the landlord may file for a set-out immediately.
  void notifyUser("jacob", {
    title: "⚠️ Payment plan MISSED",
    body: `${a.tenantName} — ${a.propertyAddress}: ${money(amount)} was due ${due}. You may file for set-out.`,
    url: APP_URL,
  }).catch(() => {});
  // b. Task.
  try {
    await db.insert(tasksTable).values({
      title: `File set-out: ${a.tenantName} missed payment plan installment (${money(amount)} due ${due})`,
      description: `Court payment agreement for ${a.propertyAddress} — the ${money(amount)} installment due ${due} was not received. Per the magistrate-approved agreement, a set-out may be filed immediately.`,
      assignedTo: "jacob",
      assignedBy: "jacob",
      propertyAddress: a.propertyAddress,
      priority: "urgent",
      status: "pending",
      createdBy: "system",
    });
  } catch (err) {
    logger.warn({ err, agreementId: a.id }, "payment-agreement-check: task insert failed");
  }
  // c. Case timeline.
  await addTimeline(a.evictionCaseId, `Payment plan installment MISSED — ${money(amount)} was due ${due}. Set-out may be filed.`);
  // d. Best-effort email.
  try {
    await sendEmail({
      to: JACOB_EMAIL,
      subject: `Payment plan MISSED — ${a.propertyAddress}`,
      html: [
        `<p><b>${a.tenantName}</b> — ${a.propertyAddress}</p>`,
        `<p>The court payment agreement installment of <b>${money(amount)}</b> due <b>${due}</b> was not received.</p>`,
        `<p>Per the magistrate-approved agreement you may file for a set-out date immediately (no new hearing or notice required).</p>`,
        `<p><a href="${APP_URL}">Open the app</a></p>`,
      ].join(""),
    });
  } catch (err) {
    logger.warn({ err, agreementId: a.id }, "payment-agreement-check: email failed");
  }
}

async function checkAgreement(a: PaymentAgreement, installments: PaymentInstallment[]): Promise<void> {
  const today = todayISO();
  const sinceDate = a.agreementDate ?? (a.createdAt ? a.createdAt.toISOString().slice(0, 10) : today);
  // Resolve the tenant via the case's lease id first (most precise), falling
  // back to the property address — the getTenantContact resolution order.
  const [c] = await db.select().from(evictionCasesTable).where(eq(evictionCasesTable.id, a.evictionCaseId));
  const credit = await ledgerPaymentsSince(a.propertyAddress, c?.doorloopLeaseId ?? null, sinceDate);
  const ledgerAvailable = credit != null;
  let remaining = credit ?? 0;

  const ordered = [...installments].sort((x, y) => x.dueDate.localeCompare(y.dueDate) || x.id - y.id);
  for (const inst of ordered) {
    // A manual mark (cash payment) is already satisfied — never consumes ledger credit.
    if (inst.status === "paid" && inst.manuallyMarked) continue;
    const amount = num(inst.amount);
    let next: "paid" | "missed" | "pending";
    if (ledgerAvailable && remaining >= amount - 0.5) {
      next = "paid";
      remaining -= amount;
    } else if (inst.dueDate < today) {
      // Without a readable ledger we can't tell a missed payment from a Rentec
      // outage — leave the installment alone rather than raise a false alarm.
      if (!ledgerAvailable) continue;
      next = "missed";
    } else {
      next = "pending";
    }
    if (next === inst.status) continue;
    await db.update(paymentInstallmentsTable).set({
      status: next,
      paidDate: next === "paid" ? (inst.paidDate ?? today) : null,
      paidAmount: next === "paid" ? (inst.paidAmount ?? String(amount)) : null,
    }).where(eq(paymentInstallmentsTable.id, inst.id));
    inst.status = next;
    if (next === "missed") await onInstallmentMissed(a, inst);
    if (next === "paid") {
      await addTimeline(a.evictionCaseId, `Payment plan installment received — ${money(amount)} (due ${fmtDate(inst.dueDate)}) satisfied from the Rentec ledger.`);
    }
  }

  // Everything paid → the plan is complete.
  if (ordered.length > 0 && ordered.every((i) => i.status === "paid")) {
    await db.update(paymentAgreementsTable)
      .set({ status: "completed", updatedAt: new Date() })
      .where(eq(paymentAgreementsTable.id, a.id));
    await addTimeline(a.evictionCaseId, `Payment plan COMPLETED — all ${ordered.length} installments paid.`);
    void notifyUser("jacob", {
      title: "✅ Payment plan completed",
      body: `${a.tenantName} — ${a.propertyAddress}: all ${ordered.length} installments paid.`,
      url: APP_URL,
    }).catch(() => {});
  }
}

/** Check every active payment agreement against the live ledger. Never throws. */
export async function runPaymentAgreementCheck(): Promise<void> {
  try {
    const agreements = await db.select().from(paymentAgreementsTable)
      .where(eq(paymentAgreementsTable.status, "active"));
    if (agreements.length === 0) return;
    const installments = await db.select().from(paymentInstallmentsTable)
      .where(inArray(paymentInstallmentsTable.agreementId, agreements.map((a) => a.id)))
      .orderBy(asc(paymentInstallmentsTable.dueDate));
    for (const a of agreements) {
      try {
        await checkAgreement(a, installments.filter((i) => i.agreementId === a.id));
      } catch (err) {
        logger.warn({ err, agreementId: a.id }, "payment-agreement-check: agreement check failed");
      }
    }
  } catch (err) {
    logger.warn({ err }, "runPaymentAgreementCheck failed");
  }
}
