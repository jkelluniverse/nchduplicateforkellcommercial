import { Router, type IRouter } from "express";
import { eq, and, sql, desc } from "drizzle-orm";
import { db, tenantPaymentNotesTable, tenantNoteCommentsTable } from "@workspace/db";
import type { TenantPaymentNote } from "@workspace/db";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { notifyUser } from "../lib/web-push";
import { sendEmail, renderFieldsHtml } from "../lib/email";
import { logger } from "../lib/logger";
import { getSituationLedger, activitySince } from "../services/situation-ledger";

const router: IRouter = Router();

function useDoorLoop(): boolean {
  return Boolean(process.env.RENTEC_API_KEY);
}

function formatDateStr(iso: string | null | undefined): string {
  if (!iso) return "unknown";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[parseInt(m[2], 10) - 1]} ${parseInt(m[3], 10)}, ${m[1]}`;
}

type NoteStatus = "open" | "missed_promise" | "resolved";

function fmtMoney(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (Number.isNaN(n)) return String(v);
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  missed_promise: "Missed promise",
  resolved: "Resolved",
};

/**
 * Build a human "Field A → B" change summary for an edit, comparing the existing
 * note against the incoming patch. Returns null when nothing meaningful changed.
 */
function describeChanges(
  before: TenantPaymentNote,
  patch: Record<string, unknown>,
): string | null {
  const parts: string[] = [];
  if ("expectedPaymentAmount" in patch) {
    const a = before.expectedPaymentAmount;
    const b = patch.expectedPaymentAmount as string | null;
    if (String(a ?? "") !== String(b ?? "")) parts.push(`Amount ${fmtMoney(a)} → ${fmtMoney(b)}`);
  }
  if ("expectedPaymentDate" in patch) {
    const a = before.expectedPaymentDate;
    const b = patch.expectedPaymentDate as string | null;
    if (String(a ?? "") !== String(b ?? "")) parts.push(`Expected date ${formatDateStr(a)} → ${formatDateStr(b)}`);
  }
  if ("status" in patch) {
    const a = before.status;
    const b = patch.status as string;
    if (a !== b) parts.push(`Status ${STATUS_LABELS[a] ?? a} → ${STATUS_LABELS[b] ?? b}`);
  }
  if ("situation" in patch) {
    const a = before.situation;
    const b = patch.situation as string;
    if (a !== b) parts.push("Situation updated");
  }
  return parts.length ? parts.join(" · ") : null;
}

/**
 * Append a system entry to a situation's comment thread. System entries use the
 * reserved author "system" so the UI can render them visually distinct, and are
 * never edited or deleted — they form the audit trail of changes.
 */
export async function appendSystemComment(noteId: number, text: string): Promise<void> {
  await db.insert(tenantNoteCommentsTable).values({ noteId, author: "system", comment: text });
}

async function sendMissedPromiseAlert(note: TenantPaymentNote): Promise<void> {
  const dateStr = formatDateStr(note.expectedPaymentDate);
  const amountStr = note.expectedPaymentAmount
    ? ` · $${Number(note.expectedPaymentAmount).toLocaleString()}`
    : "";
  const appUrl = process.env.APP_URL || "https://app.kellcommercial.com";

  void notifyUser("jacob", {
    title: "⚠️ Missed Promise",
    body: `${note.propertyAddress} — payment was due ${dateStr} and not received.`,
    url: appUrl,
  }).catch(() => {});

  void sendEmail({
    to: (process.env.ADMIN_EMAIL || "admin@kellcommercial.com"),
    subject: `Missed Payment Promise: ${note.tenantName} — ${note.propertyAddress}`,
    html:
      renderFieldsHtml([
        ["Property", note.propertyAddress],
        ["Tenant", note.tenantName],
        ["Situation", note.situation],
        ["Expected", `${dateStr}${amountStr}`],
        ["Action", "Consider sending a 3-Day Notice"],
      ]) +
      `<p style="margin-top:16px;font-family:Arial,sans-serif;">` +
      `<a href="${appUrl}">Open App</a></p>`,
  }).catch(() => {});
}

/** Exported so index.ts can schedule the daily 8 AM reminder job. */
export async function runDailyReminders(): Promise<void> {
  try {
    const today = new Date().toISOString().split("T")[0];
    const openNotes = await db
      .select()
      .from(tenantPaymentNotesTable)
      .where(
        and(
          eq(tenantPaymentNotesTable.status, "open"),
          eq(tenantPaymentNotesTable.expectedPaymentDate, today),
        ),
      );

    for (const note of openNotes) {
      const dateStr = formatDateStr(note.expectedPaymentDate);
      const amountStr = note.expectedPaymentAmount
        ? ` · $${Number(note.expectedPaymentAmount).toLocaleString()}`
        : "";

      void notifyUser("jacob", {
        title: "Payment Follow-up",
        body: `${note.propertyAddress} — payment expected today. Check if received.`,
        url: process.env.APP_URL || "https://app.kellcommercial.com",
      }).catch(() => {});

      void sendEmail({
        to: (process.env.ADMIN_EMAIL || "admin@kellcommercial.com"),
        subject: `Payment Follow-up: ${note.tenantName} — ${note.propertyAddress}`,
        html:
          renderFieldsHtml([
            ["Property", note.propertyAddress],
            ["Tenant", note.tenantName],
            ["Situation", note.situation],
            ["Expected", `${dateStr}${amountStr}`],
          ]) +
          `<p style="margin-top:16px;font-family:Arial,sans-serif;"><a href="${process.env.APP_URL || "https://app.kellcommercial.com"}">Open App</a></p>`,
      }).catch(() => {});
    }

    logger.info({ count: openNotes.length }, "Daily tenant note reminders sent");
  } catch (err) {
    logger.error({ err }, "Daily tenant note reminders failed");
  }
}

/** Auto-updates open notes whose expected date has passed. Fire-and-forget safe. */
async function autoUpdateStatuses(): Promise<void> {
  const today = new Date().toISOString().split("T")[0];

  const openNotes = await db
    .select()
    .from(tenantPaymentNotesTable)
    .where(eq(tenantPaymentNotesTable.status, "open"));

  const pastDue = openNotes.filter(
    (n) => n.expectedPaymentDate && n.expectedPaymentDate < today,
  );

  for (const note of pastDue) {
    let newStatus: NoteStatus = "missed_promise";

    if (useDoorLoop() && note.doorloopLeaseId && note.expectedPaymentDate) {
      try {
        const { getPaymentsForLease } = await import("../services/rentec");
        const payments = await getPaymentsForLease(note.doorloopLeaseId);
        const hasPaid = payments.some((p) => p.date >= note.expectedPaymentDate!);
        newStatus = hasPaid ? "resolved" : "missed_promise";
      } catch (err) {
        logger.warn({ err, noteId: note.id }, "DoorLoop payment check failed, defaulting to missed_promise");
      }
    }

    await db
      .update(tenantPaymentNotesTable)
      .set({
        status: newStatus,
        updatedAt: new Date(),
        ...(newStatus === "resolved" ? { resolvedAt: new Date() } : {}),
      })
      .where(eq(tenantPaymentNotesTable.id, note.id));

    if (newStatus === "missed_promise") {
      void sendMissedPromiseAlert(note);
    }
  }
}

/** Live-ledger assessment attached to an open situation for the UI banner. */
export interface LedgerAssessment {
  currentBalance: number;
  flag: "paid" | "partial" | "returned" | "none";
  message: string | null;
  /** Suggested new amount for the one-tap "Update amount to balance" action. */
  suggestedAmount: number | null;
}

function autoApplyEnabled(): boolean {
  return process.env.SITUATION_AUTO_APPLY === "true";
}

function noteCreatedDate(note: TenantPaymentNote): string {
  const c = note.createdAt as unknown;
  const iso = c instanceof Date ? c.toISOString() : String(c ?? "");
  return iso.slice(0, 10);
}

/**
 * Read one open situation's live Rentec ledger and classify activity SINCE the
 * situation was created. All amounts come from Rentec — we never derive them.
 *
 * Side effects (best-effort, logged as system comments — never touching prior
 * entries):
 *   - paid in full   → resolve the situation
 *   - returned/NSF   → raise the amount to the new balance (auto, it's a reversal)
 *   - partial        → only auto-applied when SITUATION_AUTO_APPLY=true; the
 *                      banner always shows what changed regardless
 * Expected date is NEVER auto-changed.
 *
 * Returns the assessment for the UI banner, or null when the ledger couldn't be
 * read (caller falls back to the stored status).
 */
async function assessSituation(note: TenantPaymentNote): Promise<LedgerAssessment | null> {
  let led;
  try {
    led = await getSituationLedger({ address: note.propertyAddress, leaseId: note.doorloopLeaseId });
  } catch (err) {
    logger.warn({ err, noteId: note.id }, "assessSituation ledger read failed");
    return null;
  }
  if (!led.resolved) return null;

  const act = activitySince(led, noteCreatedDate(note));
  const hasReturned = act.returnedPayments.length > 0;
  const hasPayment = act.payments.length > 0;
  const balance = led.currentBalance;

  // Paid in full → resolve.
  if (balance <= 0) {
    if (note.status !== "resolved") {
      await db
        .update(tenantPaymentNotesTable)
        .set({ status: "resolved", resolvedAt: new Date(), updatedAt: new Date() })
        .where(eq(tenantPaymentNotesTable.id, note.id));
      await appendSystemComment(note.id, "Resolved — Rentec shows the balance paid in full — system");
    }
    return { currentBalance: balance, flag: "paid", message: "Paid in full per Rentec", suggestedAmount: 0 };
  }

  // Returned / NSF → raise the amount to match the new (higher) balance.
  if (hasReturned) {
    const prev = note.expectedPaymentAmount;
    const next = balance.toFixed(2);
    if (String(prev ?? "") !== next) {
      await db
        .update(tenantPaymentNotesTable)
        .set({ expectedPaymentAmount: next, updatedAt: new Date() })
        .where(eq(tenantPaymentNotesTable.id, note.id));
      await appendSystemComment(
        note.id,
        `Payment returned (NSF) — amount ${fmtMoney(prev)} → ${fmtMoney(next)} to match the new Rentec balance — system`,
      );
    }
    return {
      currentBalance: balance,
      flag: "returned",
      message: `Payment returned — balance is now ${fmtMoney(balance)}`,
      suggestedAmount: balance,
    };
  }

  // Partial payment activity → suggest updating the amount (banner). Auto-apply
  // only when explicitly enabled; expected date is never changed automatically.
  if (hasPayment) {
    if (autoApplyEnabled()) {
      const prev = note.expectedPaymentAmount;
      const next = balance.toFixed(2);
      if (String(prev ?? "") !== next) {
        await db
          .update(tenantPaymentNotesTable)
          .set({ expectedPaymentAmount: next, updatedAt: new Date() })
          .where(eq(tenantPaymentNotesTable.id, note.id));
        await appendSystemComment(
          note.id,
          `Payment activity — amount auto-updated ${fmtMoney(prev)} → ${fmtMoney(next)} (Rentec balance) — system`,
        );
      }
    }
    return {
      currentBalance: balance,
      flag: "partial",
      message: `Payment activity since created — balance is now ${fmtMoney(balance)}`,
      suggestedAmount: balance,
    };
  }

  return { currentBalance: balance, flag: "none", message: null, suggestedAmount: null };
}

// ── GET /api/tenant-notes ─────────────────────────────────────────────────────
router.get("/tenant-notes", requireAuth, async (_req, res): Promise<void> => {
  try {
    await autoUpdateStatuses().catch((err) =>
      logger.warn({ err }, "autoUpdateStatuses non-fatal error"),
    );

    const notes = await db
      .select()
      .from(tenantPaymentNotesTable)
      .orderBy(
        sql`CASE status WHEN 'missed_promise' THEN 0 WHEN 'open' THEN 1 ELSE 2 END`,
        // Soonest expected date first within a status group (nulls last), so an
        // edited expected date re-sorts the row.
        sql`${tenantPaymentNotesTable.expectedPaymentDate} ASC NULLS LAST`,
        desc(tenantPaymentNotesTable.createdAt),
      );

    // Ledger-informed assessment for open situations (best-effort, non-fatal).
    // Runs the live Rentec check per open note; may auto-resolve/raise amounts.
    const assessments = new Map<number, LedgerAssessment | null>();
    for (const n of notes) {
      if (n.status === "resolved") continue;
      try {
        assessments.set(n.id, await assessSituation(n));
      } catch (err) {
        logger.warn({ err, noteId: n.id }, "assessSituation non-fatal error");
      }
    }

    // Re-read notes whose status/amount the assessment may have changed.
    const fresh = await db
      .select()
      .from(tenantPaymentNotesTable)
      .orderBy(
        sql`CASE status WHEN 'missed_promise' THEN 0 WHEN 'open' THEN 1 ELSE 2 END`,
        sql`${tenantPaymentNotesTable.expectedPaymentDate} ASC NULLS LAST`,
        desc(tenantPaymentNotesTable.createdAt),
      );

    const comments = await db
      .select()
      .from(tenantNoteCommentsTable)
      .orderBy(tenantNoteCommentsTable.createdAt);

    const result = fresh.map((n) => ({
      ...n,
      comments: comments.filter((c) => c.noteId === n.id),
      ledger: assessments.get(n.id) ?? null,
    }));

    res.json(result);
  } catch (err) {
    logger.error({ err }, "GET /tenant-notes failed");
    res.status(500).json({ error: "Failed to load notes" });
  }
});

// ── POST /api/tenant-notes ────────────────────────────────────────────────────
router.post(
  "/tenant-notes",
  requireAuth,
  requireRole("jacob"),
  async (req: AuthRequest, res): Promise<void> => {
    try {
      const body = req.body as Record<string, string | undefined>;
      const { propertyAddress, tenantName, situation, doorloopLeaseId, expectedPaymentDate, expectedPaymentAmount } = body;

      if (!propertyAddress || !tenantName || !situation) {
        res.status(400).json({ error: "propertyAddress, tenantName, and situation are required" });
        return;
      }

      const [note] = await db
        .insert(tenantPaymentNotesTable)
        .values({
          propertyAddress,
          tenantName,
          doorloopLeaseId: doorloopLeaseId || null,
          situation,
          expectedPaymentDate: expectedPaymentDate || null,
          expectedPaymentAmount: expectedPaymentAmount || null,
          status: "open",
          createdBy: req.user?.role ?? "jacob",
        })
        .returning();

      res.status(201).json({ ...note, comments: [] });
    } catch (err) {
      logger.error({ err }, "POST /tenant-notes failed");
      res.status(500).json({ error: "Failed to create note" });
    }
  },
);

// ── PUT|PATCH /api/tenant-notes/:id — edit-in-place with audit trail ──────────
// Accepts any subset of editable fields. In the SAME operation it appends a
// "system" comment summarizing what changed (Amount A → B · Expected date X → Y)
// so prior comments/reminders are never modified, only added to. The list is
// re-sorted by the (possibly new) expected date on the client + GET ordering.
const updateNoteHandler = async (req: AuthRequest, res: any): Promise<void> => {
    try {
      const id = parseInt(req.params.id, 10);
      const body = req.body as Record<string, string | undefined>;

      const [before] = await db
        .select()
        .from(tenantPaymentNotesTable)
        .where(eq(tenantPaymentNotesTable.id, id));
      if (!before) { res.status(404).json({ error: "Note not found" }); return; }

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (body.propertyAddress !== undefined) patch.propertyAddress = body.propertyAddress;
      if (body.tenantName !== undefined) patch.tenantName = body.tenantName;
      if (body.situation !== undefined) patch.situation = body.situation;
      if (body.doorloopLeaseId !== undefined) patch.doorloopLeaseId = body.doorloopLeaseId || null;
      if (body.expectedPaymentDate !== undefined) patch.expectedPaymentDate = body.expectedPaymentDate || null;
      if (body.expectedPaymentAmount !== undefined) patch.expectedPaymentAmount = body.expectedPaymentAmount || null;
      if (body.status !== undefined) {
        patch.status = body.status as NoteStatus;
        if (body.status === "resolved" && before.status !== "resolved") patch.resolvedAt = new Date();
      }

      // Summarize the change BEFORE writing, so the audit comment reflects the diff.
      const summary = describeChanges(before, patch);

      const [updated] = await db
        .update(tenantPaymentNotesTable)
        .set(patch)
        .where(eq(tenantPaymentNotesTable.id, id))
        .returning();

      if (summary) {
        const who = req.user?.role ?? "jacob";
        await appendSystemComment(id, `${summary} — ${who}`);
      }

      const comments = await db
        .select()
        .from(tenantNoteCommentsTable)
        .where(eq(tenantNoteCommentsTable.noteId, id))
        .orderBy(tenantNoteCommentsTable.createdAt);

      res.json({ ...updated, comments });
    } catch (err) {
      logger.error({ err }, "update /tenant-notes/:id failed");
      res.status(500).json({ error: "Failed to update note" });
    }
};
router.put("/tenant-notes/:id", requireAuth, requireRole("jacob"), updateNoteHandler);
router.patch("/tenant-notes/:id", requireAuth, requireRole("jacob"), updateNoteHandler);

// ── PUT /api/tenant-notes/:id/resolve ────────────────────────────────────────
router.put(
  "/tenant-notes/:id/resolve",
  requireAuth,
  requireRole("jacob"),
  async (req, res): Promise<void> => {
    try {
      const id = parseInt(req.params.id, 10);
      const [updated] = await db
        .update(tenantPaymentNotesTable)
        .set({ status: "resolved", resolvedAt: new Date(), updatedAt: new Date() })
        .where(eq(tenantPaymentNotesTable.id, id))
        .returning();

      if (!updated) { res.status(404).json({ error: "Note not found" }); return; }
      res.json(updated);
    } catch (err) {
      logger.error({ err }, "PUT /tenant-notes/:id/resolve failed");
      res.status(500).json({ error: "Failed to resolve note" });
    }
  },
);

// ── DELETE /api/tenant-notes/:id ─────────────────────────────────────────────
router.delete(
  "/tenant-notes/:id",
  requireAuth,
  requireRole("jacob"),
  async (req, res): Promise<void> => {
    try {
      const id = parseInt(req.params.id, 10);
      await db.delete(tenantPaymentNotesTable).where(eq(tenantPaymentNotesTable.id, id));
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "DELETE /tenant-notes/:id failed");
      res.status(500).json({ error: "Failed to delete note" });
    }
  },
);

// ── POST /api/tenant-notes/:id/comments ──────────────────────────────────────
router.post(
  "/tenant-notes/:id/comments",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    try {
      const noteId = parseInt(req.params.id, 10);
      const { comment } = req.body as { comment?: string };

      if (!comment?.trim()) {
        res.status(400).json({ error: "comment is required" });
        return;
      }

      const [row] = await db
        .insert(tenantNoteCommentsTable)
        .values({ noteId, author: req.user?.role ?? "jacob", comment: comment.trim() })
        .returning();

      res.status(201).json(row);
    } catch (err) {
      logger.error({ err }, "POST /tenant-notes/:id/comments failed");
      res.status(500).json({ error: "Failed to post comment" });
    }
  },
);

export default router;
