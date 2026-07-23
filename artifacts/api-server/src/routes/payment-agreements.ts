/**
 * Court Payment Agreements — magistrate-approved installment plans signed after
 * an eviction hearing. The eviction case parks in 'payment_plan' status (the
 * property returns to normal circulation) while the plan is tracked against the
 * live Rentec ledger by lib/payment-agreement-check. The signed document itself
 * is stored through the existing eviction document upload (documentType
 * 'payment_agreement'). Mutations are jacob-only.
 */
import { Router, type IRouter } from "express";
import { eq, desc, asc } from "drizzle-orm";
import {
  db,
  evictionCasesTable,
  evictionTimelineTable,
  paymentAgreementsTable,
  paymentInstallmentsTable,
} from "@workspace/db";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";

const router: IRouter = Router();
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const money = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const todayISO = () => new Date().toISOString().slice(0, 10);

async function addTimeline(caseId: number, notes: string, by: string): Promise<void> {
  await db.insert(evictionTimelineTable).values({ evictionCaseId: caseId, stage: "payment_plan", notes, createdBy: by });
}

function serializeAgreement(a: typeof paymentAgreementsTable.$inferSelect) {
  return {
    id: a.id,
    evictionCaseId: a.evictionCaseId,
    propertyAddress: a.propertyAddress,
    tenantName: a.tenantName,
    agreementDate: a.agreementDate,
    courtRef: a.courtRef,
    notes: a.notes,
    status: a.status,
    setoutFiledAt: a.setoutFiledAt ? a.setoutFiledAt.toISOString() : null,
    createdAt: a.createdAt ? a.createdAt.toISOString() : null,
  };
}

function serializeInstallment(i: typeof paymentInstallmentsTable.$inferSelect) {
  return {
    id: i.id,
    dueDate: i.dueDate,
    amount: num(i.amount),
    status: i.status,
    paidDate: i.paidDate,
    paidAmount: i.paidAmount != null ? num(i.paidAmount) : null,
    manuallyMarked: Boolean(i.manuallyMarked),
    notes: i.notes,
  };
}

// POST /api/evictions/:id/payment-agreement — set up the plan (Jacob only).
router.post("/evictions/:id/payment-agreement", requireAuth, requireRole("jacob"), async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!id || isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [c] = await db.select().from(evictionCasesTable).where(eq(evictionCasesTable.id, id));
  if (!c) { res.status(404).json({ error: "Case not found" }); return; }

  const b = (req.body ?? {}) as Record<string, unknown>;
  const rawInstallments = Array.isArray(b.installments) ? (b.installments as Array<Record<string, unknown>>) : [];
  const installments = rawInstallments
    .map((i) => ({ dueDate: String(i.dueDate ?? "").slice(0, 10), amount: num(i.amount) }))
    .filter((i) => /^\d{4}-\d{2}-\d{2}$/.test(i.dueDate) && i.amount > 0);
  if (installments.length === 0) { res.status(400).json({ error: "At least one installment (date + amount) is required" }); return; }

  const by = req.user?.username ?? "jacob";
  const [agreement] = await db.insert(paymentAgreementsTable).values({
    evictionCaseId: id,
    propertyAddress: c.propertyAddress,
    tenantName: c.tenantName,
    agreementDate: (b.agreementDate as string) || todayISO(),
    courtRef: (b.courtRef as string)?.trim() || null,
    notes: (b.notes as string)?.trim() || null,
    status: "active",
    createdBy: by,
  }).returning();
  await db.insert(paymentInstallmentsTable).values(
    installments.map((i) => ({ agreementId: agreement.id, dueDate: i.dueDate, amount: String(i.amount) })),
  );

  // Park the case in 'payment_plan' — the property returns to normal
  // circulation while the plan is tracked.
  await db.update(evictionCasesTable).set({ status: "payment_plan", updatedAt: new Date() }).where(eq(evictionCasesTable.id, id));
  const total = installments.reduce((a, i) => a + i.amount, 0);
  await addTimeline(id, `Payment agreement established — ${installments.length} payments totaling ${money(total)}`, by);

  res.status(201).json({ id: agreement.id });
});

// GET /api/evictions/:id/payment-agreement — the case's plan (latest) + schedule.
router.get("/evictions/:id/payment-agreement", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!id || isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [a] = await db.select().from(paymentAgreementsTable)
    .where(eq(paymentAgreementsTable.evictionCaseId, id))
    .orderBy(desc(paymentAgreementsTable.id))
    .limit(1);
  if (!a) { res.json({ agreement: null, installments: [] }); return; }
  const installments = await db.select().from(paymentInstallmentsTable)
    .where(eq(paymentInstallmentsTable.agreementId, a.id))
    .orderBy(asc(paymentInstallmentsTable.dueDate), asc(paymentInstallmentsTable.id));
  res.json({ agreement: serializeAgreement(a), installments: installments.map(serializeInstallment) });
});

// POST /api/payment-agreements/:aid/installments/:iid/mark-paid — manual
// override for cash/off-ledger payments (Jacob only).
router.post("/payment-agreements/:aid/installments/:iid/mark-paid", requireAuth, requireRole("jacob"), async (req: AuthRequest, res): Promise<void> => {
  const aid = parseInt(String(req.params.aid), 10);
  const iid = parseInt(String(req.params.iid), 10);
  if (!aid || !iid || isNaN(aid) || isNaN(iid)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [inst] = await db.select().from(paymentInstallmentsTable).where(eq(paymentInstallmentsTable.id, iid));
  if (!inst || inst.agreementId !== aid) { res.status(404).json({ error: "Installment not found" }); return; }
  const b = (req.body ?? {}) as Record<string, unknown>;
  await db.update(paymentInstallmentsTable).set({
    status: "paid",
    manuallyMarked: true,
    paidDate: (b.paidDate as string) || todayISO(),
    paidAmount: String(b.amount != null && b.amount !== "" ? num(b.amount) : num(inst.amount)),
    notes: (b.notes as string)?.trim() || inst.notes,
  }).where(eq(paymentInstallmentsTable.id, iid));
  await db.update(paymentAgreementsTable).set({ updatedAt: new Date() }).where(eq(paymentAgreementsTable.id, aid));
  res.json({ ok: true });
});

// POST /api/payment-agreements/:aid/status — default / complete / cancel /
// reactivate the plan (Jacob only). The case STAYS in 'payment_plan' status —
// the agreement's own status carries the default state.
router.post("/payment-agreements/:aid/status", requireAuth, requireRole("jacob"), async (req: AuthRequest, res): Promise<void> => {
  const aid = parseInt(String(req.params.aid), 10);
  if (!aid || isNaN(aid)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [a] = await db.select().from(paymentAgreementsTable).where(eq(paymentAgreementsTable.id, aid));
  if (!a) { res.status(404).json({ error: "Agreement not found" }); return; }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const status = String(b.status ?? "");
  if (!["active", "completed", "defaulted", "cancelled"].includes(status)) { res.status(400).json({ error: "Invalid status" }); return; }
  const setoutFiled = b.setoutFiled === true;
  const notes = (b.notes as string)?.trim() || null;
  const by = req.user?.username ?? "jacob";

  const set: Record<string, unknown> = { status, updatedAt: new Date() };
  if (status === "defaulted" && setoutFiled && !a.setoutFiledAt) set.setoutFiledAt = new Date();
  if (notes) set.notes = notes;
  await db.update(paymentAgreementsTable).set(set).where(eq(paymentAgreementsTable.id, aid));

  if (status === "defaulted") {
    await addTimeline(a.evictionCaseId, `Payment plan DEFAULTED — filing for set-out${notes ? ` · ${notes}` : ""}`, by);
  } else if (status === "completed") {
    await addTimeline(a.evictionCaseId, `Payment plan marked COMPLETED${notes ? ` · ${notes}` : ""}`, by);
  } else if (status === "cancelled") {
    await addTimeline(a.evictionCaseId, `Payment agreement cancelled${notes ? ` · ${notes}` : ""}`, by);
  } else if (status === "active" && a.status !== "active") {
    await addTimeline(a.evictionCaseId, `Payment agreement reactivated${notes ? ` · ${notes}` : ""}`, by);
  }
  res.json({ ok: true });
});

export default router;

// PUT /api/evictions/:id/payment-agreement — full edit (Jacob only). Updates
// the agreement fields and REPLACES the schedule: installments carrying an id
// are updated in place (keeping paid/manual state unless the row changed),
// ones without an id are inserted, and any existing row not present in the
// payload is deleted. Editing a date/amount resets an AUTO-set status back to
// 'pending' so the hourly ledger check re-evaluates it; a manual "Mark paid"
// is preserved.
router.put("/evictions/:id/payment-agreement", requireAuth, requireRole("jacob"), async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!id || isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  try {
    const [agreement] = await db
      .select()
      .from(paymentAgreementsTable)
      .where(eq(paymentAgreementsTable.evictionCaseId, id))
      .orderBy(desc(paymentAgreementsTable.id))
      .limit(1);
    if (!agreement) { res.status(404).json({ error: "No payment agreement for this case" }); return; }

    const body = req.body as {
      agreementDate?: string; courtRef?: string | null; notes?: string | null;
      installments?: Array<{ id?: number; dueDate: string; amount: number; notes?: string | null }>;
    };

    const patch: Record<string, unknown> = { updatedAt: new Date() };
    if (body.agreementDate !== undefined) patch["agreementDate"] = body.agreementDate;
    if (body.courtRef !== undefined) patch["courtRef"] = body.courtRef || null;
    if (body.notes !== undefined) patch["notes"] = body.notes || null;
    await db.update(paymentAgreementsTable).set(patch).where(eq(paymentAgreementsTable.id, agreement.id));

    if (Array.isArray(body.installments)) {
      const incoming = body.installments.filter((i) => i.dueDate && num(i.amount) > 0);
      if (incoming.length === 0) { res.status(400).json({ error: "At least one installment required" }); return; }
      const existing = await db
        .select()
        .from(paymentInstallmentsTable)
        .where(eq(paymentInstallmentsTable.agreementId, agreement.id));
      const byId = new Map(existing.map((r) => [r.id, r]));
      const keptIds = new Set<number>();
      for (const inc of incoming) {
        const cur = inc.id != null ? byId.get(inc.id) : undefined;
        if (cur) {
          keptIds.add(cur.id);
          const changed = cur.dueDate !== inc.dueDate || num(cur.amount) !== num(inc.amount);
          await db.update(paymentInstallmentsTable).set({
            dueDate: inc.dueDate,
            amount: String(num(inc.amount)),
            notes: inc.notes !== undefined ? inc.notes || null : cur.notes,
            // A changed date/amount invalidates an AUTO verdict — back to
            // pending for the checker. Manual marks survive edits.
            ...(changed && !cur.manuallyMarked
              ? { status: "pending", paidDate: null, paidAmount: null }
              : {}),
          }).where(eq(paymentInstallmentsTable.id, cur.id));
        } else {
          await db.insert(paymentInstallmentsTable).values({
            agreementId: agreement.id,
            dueDate: inc.dueDate,
            amount: String(num(inc.amount)),
            notes: inc.notes || null,
          });
        }
      }
      for (const row of existing) {
        if (!keptIds.has(row.id)) {
          await db.delete(paymentInstallmentsTable).where(eq(paymentInstallmentsTable.id, row.id));
        }
      }
    }

    await addTimeline(id, "Payment agreement edited.", req.user?.username ?? "jacob");
    const [updated] = await db.select().from(paymentAgreementsTable).where(eq(paymentAgreementsTable.id, agreement.id));
    const installments = await db
      .select()
      .from(paymentInstallmentsTable)
      .where(eq(paymentInstallmentsTable.agreementId, agreement.id))
      .orderBy(asc(paymentInstallmentsTable.dueDate), asc(paymentInstallmentsTable.id));
    res.json({ agreement: updated ? serializeAgreement(updated) : null, installments: installments.map(serializeInstallment) });
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : "Failed to update agreement" });
  }
});
