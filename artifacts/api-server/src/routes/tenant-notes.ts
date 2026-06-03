import { Router, type IRouter } from "express";
import { eq, and, sql, desc } from "drizzle-orm";
import { db, tenantPaymentNotesTable, tenantNoteCommentsTable } from "@workspace/db";
import type { TenantPaymentNote } from "@workspace/db";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { notifyUser } from "../lib/web-push";
import { sendEmail, renderFieldsHtml } from "../lib/email";
import { logger } from "../lib/logger";

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

async function sendMissedPromiseAlert(note: TenantPaymentNote): Promise<void> {
  const dateStr = formatDateStr(note.expectedPaymentDate);
  const amountStr = note.expectedPaymentAmount
    ? ` · $${Number(note.expectedPaymentAmount).toLocaleString()}`
    : "";
  const appUrl = "https://app.nicecityhomes.com";

  void notifyUser("jacob", {
    title: "⚠️ Missed Promise",
    body: `${note.propertyAddress} — payment was due ${dateStr} and not received.`,
    url: appUrl,
  }).catch(() => {});

  void sendEmail({
    to: "jacob@nicecityhomes.com",
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
      `<a href="${appUrl}">Open App → Document Maker</a></p>`,
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
        url: "https://app.nicecityhomes.com",
      }).catch(() => {});

      void sendEmail({
        to: "jacob@nicecityhomes.com",
        subject: `Payment Follow-up: ${note.tenantName} — ${note.propertyAddress}`,
        html:
          renderFieldsHtml([
            ["Property", note.propertyAddress],
            ["Tenant", note.tenantName],
            ["Situation", note.situation],
            ["Expected", `${dateStr}${amountStr}`],
          ]) +
          `<p style="margin-top:16px;font-family:Arial,sans-serif;"><a href="https://app.nicecityhomes.com">Open App</a></p>`,
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
        desc(tenantPaymentNotesTable.createdAt),
      );

    const comments = await db
      .select()
      .from(tenantNoteCommentsTable)
      .orderBy(tenantNoteCommentsTable.createdAt);

    const result = notes.map((n) => ({
      ...n,
      comments: comments.filter((c) => c.noteId === n.id),
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

// ── PUT /api/tenant-notes/:id ─────────────────────────────────────────────────
router.put(
  "/tenant-notes/:id",
  requireAuth,
  requireRole("jacob"),
  async (req: AuthRequest, res): Promise<void> => {
    try {
      const id = parseInt(req.params.id, 10);
      const body = req.body as Record<string, string | undefined>;

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (body.propertyAddress !== undefined) patch.propertyAddress = body.propertyAddress;
      if (body.tenantName !== undefined) patch.tenantName = body.tenantName;
      if (body.situation !== undefined) patch.situation = body.situation;
      if (body.doorloopLeaseId !== undefined) patch.doorloopLeaseId = body.doorloopLeaseId || null;
      if (body.expectedPaymentDate !== undefined) patch.expectedPaymentDate = body.expectedPaymentDate || null;
      if (body.expectedPaymentAmount !== undefined) patch.expectedPaymentAmount = body.expectedPaymentAmount || null;
      if (body.status !== undefined) patch.status = body.status as NoteStatus;

      const [updated] = await db
        .update(tenantPaymentNotesTable)
        .set(patch)
        .where(eq(tenantPaymentNotesTable.id, id))
        .returning();

      if (!updated) { res.status(404).json({ error: "Note not found" }); return; }

      const comments = await db
        .select()
        .from(tenantNoteCommentsTable)
        .where(eq(tenantNoteCommentsTable.noteId, id))
        .orderBy(tenantNoteCommentsTable.createdAt);

      res.json({ ...updated, comments });
    } catch (err) {
      logger.error({ err }, "PUT /tenant-notes/:id failed");
      res.status(500).json({ error: "Failed to update note" });
    }
  },
);

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
