/**
 * Monthly Communication Checklist routes (Kell Commercial).
 *
 *   GET    /api/contact-checklist?month=&year=   — unpaid props + comm status
 *   POST   /api/contact-checklist/mark-contacted — log a contact (idempotent)
 *   DELETE /api/contact-checklist/:id            — remove a contact log
 *   GET    /api/contact-checklist/history        — prior-month contact logs
 *
 * Activation: the checklist is gated to "after the 6th" for the CURRENT month
 * so Jacob isn't nagged before the grace period. Prior months are always
 * viewable as history.
 *
 * The column name `doorloop_lease_id` is intentionally retained — its value is
 * a Rentec lease id here. All tenant/balance data is read live from Rentec.
 */
import { Router, type IRouter } from "express";
import { desc, eq } from "drizzle-orm";
import { db, monthlyContactLogTable } from "@workspace/db";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { notifyUser } from "../lib/web-push";
import { logger } from "../lib/logger";
import { getContactChecklist } from "../services/contact-checklist";

const router: IRouter = Router();

const ACTIVATION_DAY = 6; // checklist activates AFTER the 6th of the month

function currentMonthYear(): { month: number; year: number } {
  const d = new Date();
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}

// GET /api/contact-checklist?month=&year=
router.get("/contact-checklist", requireAuth, async (req, res): Promise<void> => {
  const cur = currentMonthYear();
  const month = parseInt(String(req.query.month ?? cur.month), 10);
  const year = parseInt(String(req.query.year ?? cur.year), 10);
  if (!month || month < 1 || month > 12 || !year || year < 2000 || year > 9999) {
    res.status(400).json({ error: "Invalid month or year" });
    return;
  }

  const now = new Date();
  const isCurrentMonth = month === cur.month && year === cur.year;
  const dormant = isCurrentMonth && now.getDate() <= ACTIVATION_DAY;

  try {
    const items = await getContactChecklist(month, year);
    // Before the 6th the regular checklist is dormant — but returned payments
    // are urgent and always surface immediately.
    if (dormant) {
      const returnedOnly = items.filter((i) => i.returned_payment);
      if (returnedOnly.length === 0) {
        res.json({
          active: false,
          note: "Follow-up checklist activates after the 6th",
          month,
          year,
          items: [],
        });
        return;
      }
      res.json({ active: true, month, year, items: returnedOnly });
      return;
    }
    res.json({ active: true, month, year, items });
  } catch (err) {
    logger.error({ err }, "GET /contact-checklist failed");
    res.status(500).json({ error: "Failed to load checklist" });
  }
});

// POST /api/contact-checklist/mark-contacted
router.post(
  "/contact-checklist/mark-contacted",
  requireAuth,
  requireRole("jacob"),
  async (req: AuthRequest, res): Promise<void> => {
    const body = (req.body ?? {}) as {
      property_address?: string;
      tenant_name?: string;
      doorloop_lease_id?: string;
      contact_method?: string;
      notes?: string;
      sms_sent?: boolean;
    };

    if (!body.property_address) {
      res.status(400).json({ error: "property_address is required" });
      return;
    }

    const { month, year } = currentMonthYear();
    const now = new Date();

    // A text contact (via the Send Text flow, or the "Text" method) keeps the
    // property on the list in an "awaiting_reply" state until the tenant
    // responds. Every other method resolves it ('done').
    const method = typeof body.contact_method === "string" ? body.contact_method.trim() : "";
    const isText = body.sms_sent === true || /^(sms|text)$/i.test(method);
    const status = isText ? "awaiting_reply" : "done";
    const contactMethod = body.sms_sent ? "sms" : method || (isText ? "text" : null);
    const smsSentAt = isText ? now : null;

    try {
      const [row] = await db
        .insert(monthlyContactLogTable)
        .values({
          propertyAddress: body.property_address,
          tenantName: body.tenant_name ?? null,
          doorloopLeaseId: body.doorloop_lease_id ?? null,
          month,
          year,
          status,
          contactedBy: req.user?.role ?? "jacob",
          contactMethod,
          notes: body.notes ?? null,
          smsSentAt,
        })
        // Idempotent within a month: a second tap updates the existing row.
        .onConflictDoUpdate({
          target: [
            monthlyContactLogTable.propertyAddress,
            monthlyContactLogTable.month,
            monthlyContactLogTable.year,
          ],
          set: {
            tenantName: body.tenant_name ?? null,
            doorloopLeaseId: body.doorloop_lease_id ?? null,
            status,
            contactMethod,
            notes: body.notes ?? null,
            contactedAt: now,
            contactedBy: req.user?.role ?? "jacob",
            smsSentAt,
          },
        })
        .returning();

      res.status(201).json(row);
    } catch (err) {
      logger.error({ err }, "POST /contact-checklist/mark-contacted failed");
      res.status(500).json({ error: "Failed to log contact" });
    }
  },
);

// DELETE /api/contact-checklist/:id
router.delete(
  "/contact-checklist/:id",
  requireAuth,
  requireRole("jacob"),
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (!id || isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    try {
      await db.delete(monthlyContactLogTable).where(eq(monthlyContactLogTable.id, id));
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "DELETE /contact-checklist/:id failed");
      res.status(500).json({ error: "Failed to delete contact log" });
    }
  },
);

// GET /api/contact-checklist/history — prior-month logs, newest first.
router.get("/contact-checklist/history", requireAuth, async (req, res): Promise<void> => {
  try {
    const rows = await db
      .select()
      .from(monthlyContactLogTable)
      .orderBy(
        desc(monthlyContactLogTable.year),
        desc(monthlyContactLogTable.month),
        desc(monthlyContactLogTable.contactedAt),
      );

    // Optionally scope to a single month if asked.
    const month = req.query.month ? parseInt(String(req.query.month), 10) : null;
    const year = req.query.year ? parseInt(String(req.query.year), 10) : null;
    const filtered =
      month && year ? rows.filter((r) => r.month === month && r.year === year) : rows;

    res.json(filtered);
  } catch (err) {
    logger.error({ err }, "GET /contact-checklist/history failed");
    res.status(500).json({ error: "Failed to load history" });
  }
});

/**
 * Daily 9 AM follow-up reminder (scheduled in index.ts). Only fires after the
 * 6th, and only when unpaid properties still have no status update. Guarded so
 * it no-ops when push isn't configured (notifyUser itself no-ops without VAPID).
 */
export async function sendFollowUpReminder(): Promise<void> {
  try {
    const today = new Date();
    if (today.getDate() <= ACTIVATION_DAY) return;

    const items = await getContactChecklist(today.getMonth() + 1, today.getFullYear());
    const needs = items.filter((p) => p.needs_followup);
    const awaiting = items.filter((p) => p.awaiting_reply);
    if (needs.length === 0 && awaiting.length === 0) return;

    const body =
      `${needs.length} ${needs.length === 1 ? "property" : "properties"} need follow-up` +
      ` · ${awaiting.length} awaiting text reply`;

    await notifyUser("jacob", {
      title: "Payment Follow-up Needed",
      body,
      url: process.env.APP_URL || "https://app.kellcommercial.com",
    });
    logger.info({ needs: needs.length, awaiting: awaiting.length }, "Sent payment follow-up reminder");
  } catch (err) {
    logger.error({ err }, "sendFollowUpReminder failed");
  }
}

export default router;
