/**
 * Collection routes (Kell Commercial):
 *   - Back-check: every currently-unpaid property must be tracked — either it has
 *     an open Payment Situation, or it has been contacted, or it shows up in the
 *     "Needs Contacted" list. The unpaid set comes from Rentec.
 *   - Per-stage text reminders: render a stage-specific message, log it on tap
 *     (the native Messages composer can't confirm a real send), and expose the
 *     reminder history.
 *   - Manual contact logging: records a call/text so the property drops off the
 *     Needs Contacted list.
 *
 * All tenant/balance/phone data is read live from Rentec; nothing is hardcoded.
 */
import { Router, type IRouter } from "express";
import { and, desc, eq, gte, or } from "drizzle-orm";
import {
  db,
  tenantPaymentNotesTable,
  contactLogTable,
  reminderLogTable,
} from "@workspace/db";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { logger } from "../lib/logger";
import * as rentec from "../services/rentec";
import { getTenantContact } from "../services/situation-ledger";
import { renderReminder, type ReminderStage } from "../config/reminder-templates";

const router: IRouter = Router();

function normStreet(addr: string | null | undefined): string {
  if (!addr) return "";
  return (addr.split(",")[0] ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function firstOfMonthISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

interface NeedsContactedRow {
  address: string;
  tenantName: string | null;
  leaseId: string | null;
  amountOwed: number;
  status: string;
  daysOverdue: number;
  phone: string | null;
}

/**
 * GET /api/collection/needs-contacted
 * Unpaid properties (per Rentec) that are NOT yet tracked — no open situation
 * and no contact logged this month.
 */
router.get("/collection/needs-contacted", requireAuth, async (_req, res): Promise<void> => {
  try {
    const now = new Date();
    const status = await rentec.getRentStatus(now.getMonth() + 1, now.getFullYear());
    if (!status) {
      res.json({ entries: [], source: "unavailable", fetchedAt: new Date().toISOString() });
      return;
    }

    const unpaid = status.rows.filter((r) => r.status !== "paid");

    // Exclude properties with an open/missed situation.
    const openNotes = await db
      .select()
      .from(tenantPaymentNotesTable)
      .where(
        or(
          eq(tenantPaymentNotesTable.status, "open"),
          eq(tenantPaymentNotesTable.status, "missed_promise"),
        )!,
      );
    const trackedStreets = new Set(openNotes.map((n) => normStreet(n.propertyAddress)));

    // Exclude properties contacted this month.
    const contacts = await db
      .select()
      .from(contactLogTable)
      .where(gte(contactLogTable.contactedAt, new Date(firstOfMonthISO())));
    for (const c of contacts) trackedStreets.add(normStreet(c.propertyAddress));

    // Resolve phone for each remaining unpaid property (Rentec source of truth).
    const entries: NeedsContactedRow[] = [];
    for (const r of unpaid) {
      if (trackedStreets.has(normStreet(r.address))) continue;
      let phone: string | null = null;
      try {
        const contact = await getTenantContact({ address: r.address, leaseId: r.leaseId });
        phone = contact.phone;
      } catch {
        /* phone optional */
      }
      const owed = Math.max(0, (r.monthlyRent || 0) - (r.amountPaid || 0)) + (r.lateFeeDue || 0);
      entries.push({
        address: r.address,
        tenantName: r.tenantName,
        leaseId: r.leaseId,
        amountOwed: Math.round(owed * 100) / 100,
        status: r.status,
        daysOverdue: r.daysOverdue,
        phone,
      });
    }

    res.json({ entries, source: "rentec", fetchedAt: status.fetchedAt });
  } catch (err) {
    logger.error({ err }, "GET /collection/needs-contacted failed");
    res.status(500).json({ error: "Failed to load needs-contacted list" });
  }
});

/**
 * GET /api/collection/contact-info?address=&leaseId=
 * Resolve the recipient name + phone for a reminder (Rentec). Phone null → the
 * UI disables the reminder button.
 */
router.get("/collection/contact-info", requireAuth, async (req, res): Promise<void> => {
  try {
    const address = (req.query.address as string) || null;
    const leaseId = (req.query.leaseId as string) || null;
    const contact = await getTenantContact({ address, leaseId });
    res.json(contact);
  } catch (err) {
    logger.error({ err }, "GET /collection/contact-info failed");
    res.status(500).json({ error: "Failed to resolve contact" });
  }
});

/**
 * POST /api/collection/reminders
 * Render a per-stage reminder, resolve the recipient phone from Rentec, LOG it
 * (logged on tap — Messages can't confirm send), and return the message + phone
 * so the client can open the native composer.
 */
router.post(
  "/collection/reminders",
  requireAuth,
  requireRole("jacob"),
  async (req: AuthRequest, res): Promise<void> => {
    try {
      const body = req.body as {
        noteId?: number;
        propertyAddress?: string;
        tenantName?: string;
        leaseId?: string | null;
        stage?: ReminderStage;
        amount?: number | string | null;
        date?: string | null;
      };
      if (!body.propertyAddress || !body.stage) {
        res.status(400).json({ error: "propertyAddress and stage are required" });
        return;
      }

      const contact = await getTenantContact({ address: body.propertyAddress, leaseId: body.leaseId ?? null });
      const tenantName = body.tenantName || contact.name;
      const msg = renderReminder(body.stage, {
        tenant: tenantName,
        property: body.propertyAddress,
        amount: body.amount ?? null,
        date: body.date ?? null,
      });

      const [row] = await db
        .insert(reminderLogTable)
        .values({
          noteId: body.noteId ?? null,
          propertyAddress: body.propertyAddress,
          tenantName: tenantName ?? null,
          stage: body.stage,
          amount: body.amount != null ? String(body.amount) : null,
          sentBy: req.user?.role ?? "jacob",
        })
        .returning();

      res.status(201).json({
        id: row!.id,
        sentAt: row!.sentAt,
        stage: body.stage,
        label: msg.label,
        body: msg.body,
        phone: contact.phone,
        tenantName: tenantName ?? null,
      });
    } catch (err) {
      logger.error({ err }, "POST /collection/reminders failed");
      res.status(500).json({ error: "Failed to log reminder" });
    }
  },
);

/**
 * GET /api/collection/reminders?noteId=  OR  ?address=
 * Reminder history for a situation or a property.
 */
router.get("/collection/reminders", requireAuth, async (req, res): Promise<void> => {
  try {
    const noteId = req.query.noteId ? parseInt(req.query.noteId as string, 10) : null;
    const address = (req.query.address as string) || null;
    let rows;
    if (noteId !== null && !Number.isNaN(noteId)) {
      rows = await db
        .select()
        .from(reminderLogTable)
        .where(eq(reminderLogTable.noteId, noteId))
        .orderBy(desc(reminderLogTable.sentAt));
    } else if (address) {
      rows = await db
        .select()
        .from(reminderLogTable)
        .where(eq(reminderLogTable.propertyAddress, address))
        .orderBy(desc(reminderLogTable.sentAt));
    } else {
      rows = await db.select().from(reminderLogTable).orderBy(desc(reminderLogTable.sentAt));
    }
    res.json(rows);
  } catch (err) {
    logger.error({ err }, "GET /collection/reminders failed");
    res.status(500).json({ error: "Failed to load reminders" });
  }
});

/**
 * POST /api/collection/contacts
 * Log a manual contact (call/text/email) so the property drops off Needs Contacted.
 */
router.post(
  "/collection/contacts",
  requireAuth,
  requireRole("jacob"),
  async (req: AuthRequest, res): Promise<void> => {
    try {
      const body = req.body as {
        propertyAddress?: string;
        tenantName?: string;
        method?: string;
        note?: string;
      };
      if (!body.propertyAddress) {
        res.status(400).json({ error: "propertyAddress is required" });
        return;
      }
      const [row] = await db
        .insert(contactLogTable)
        .values({
          propertyAddress: body.propertyAddress,
          tenantName: body.tenantName ?? null,
          method: body.method ?? "other",
          note: body.note ?? null,
          contactedBy: req.user?.role ?? "jacob",
        })
        .returning();
      res.status(201).json(row);
    } catch (err) {
      logger.error({ err }, "POST /collection/contacts failed");
      res.status(500).json({ error: "Failed to log contact" });
    }
  },
);

export default router;
