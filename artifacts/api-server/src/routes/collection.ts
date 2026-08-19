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
 *   - PDF report generation: aggregates all properties and their payment status
 *     into a single-page PDF for owner viewing.
 *
 * All tenant/balance/phone data is read live from Rentec; nothing is hardcoded.
 */
import { Router, type IRouter } from "express";
import { and, desc, eq, gte, or } from "drizzle-orm";
import PDFDocument from "pdfkit";
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
import { getLedgerList } from "../services/property-ledger";
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


/**
 * GET /api/collection/report/pdf
 * One-page owner report: every property with its payment status (paid /
 * unpaid / delinquent / expected), days late, past-due amount, and balance.
 * Data comes from the SAME source as the Ledger page (getLedgerList), so the
 * report always matches what's on screen. The PDF is built fully in memory
 * and only sent on success, so a generation error returns a clean JSON 500
 * instead of a corrupt stream.
 */
router.get("/collection/report/pdf", requireAuth, async (_req, res): Promise<void> => {
  try {
    const rows = await getLedgerList();
    if (rows.length === 0) {
      res.status(500).json({ error: "No ledger data available" });
      return;
    }

    // Problem accounts first: delinquent, unpaid, expected, then paid;
    // within each group, biggest amount owed first.
    const ORDER: Record<string, number> = { delinquent: 0, unpaid: 1, expected: 2, paid: 3 };
    const sorted = [...rows].sort((a, b) => {
      const g = (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9);
      if (g !== 0) return g;
      return -b.currentBalance - -a.currentBalance;
    });

    const owedOf = (r: (typeof rows)[number]) => Math.max(0, -r.currentBalance);
    const totals = {
      paid: 0,
      unpaid: 0,
      delinquent: 0,
      expected: 0,
      totalOwed: 0,
      totalPastDue: 0,
    };
    for (const r of rows) {
      totals[r.status]++;
      totals.totalOwed += owedOf(r);
      totals.totalPastDue += r.pastDue;
    }

    const now = new Date();
    const monthLabel = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const fmt$ = (n: number) =>
      n.toLocaleString("en-US", { style: "currency", currency: "USD" });

    // ── Build the PDF in memory ──────────────────────────────────────────
    const doc = new PDFDocument({ size: "letter", margin: 36 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on("end", () => resolve(Buffer.concat(chunks)));
      doc.on("error", reject);
    });

    const M = 36; // margin
    const pageW = doc.page.width; // 612
    const pageH = doc.page.height; // 792
    const W = pageW - 2 * M;

    // Header
    doc.font("Helvetica-Bold").fontSize(18).text("Rent Status Report", M, M, { width: W, align: "center" });
    doc.font("Helvetica").fontSize(10).text(
      `${monthLabel}  ·  Generated ${now.toLocaleDateString("en-US")}`,
      M, M + 24, { width: W, align: "center" },
    );

    // Summary band
    let y = M + 46;
    doc.font("Helvetica-Bold").fontSize(10);
    const summary =
      `Properties: ${rows.length}    Paid: ${totals.paid}    Unpaid: ${totals.unpaid}    ` +
      `Delinquent: ${totals.delinquent}    Expected: ${totals.expected}`;
    doc.text(summary, M, y, { width: W, align: "center" });
    y += 14;
    doc.text(
      `Total owed: ${fmt$(totals.totalOwed)}        Past due (aged): ${fmt$(totals.totalPastDue)}`,
      M, y, { width: W, align: "center" },
    );
    y += 18;
    doc.moveTo(M, y).lineTo(pageW - M, y).lineWidth(1).stroke("#333333");
    y += 6;

    // Table geometry — everything must fit on ONE page.
    const col = {
      address: { x: M, w: W * 0.34 },
      tenant: { x: M + W * 0.34, w: W * 0.24 },
      status: { x: M + W * 0.58, w: W * 0.13 },
      late: { x: M + W * 0.71, w: W * 0.07 },
      owed: { x: M + W * 0.78, w: W * 0.11 },
      balance: { x: M + W * 0.89, w: W * 0.11 },
    };
    const footerY = pageH - M - 10;
    const bodyTop = y + 14;
    const avail = footerY - 6 - bodyTop;
    // Shrink rows (and font) as the portfolio grows so it always stays on one page.
    const rowH = Math.max(9, Math.min(15, Math.floor(avail / sorted.length)));
    const bodyFont = Math.min(8, rowH - 3);

    // Table header
    doc.font("Helvetica-Bold").fontSize(8).fillColor("#333333");
    doc.text("Property", col.address.x, y, { width: col.address.w, lineBreak: false });
    doc.text("Tenant", col.tenant.x, y, { width: col.tenant.w, lineBreak: false });
    doc.text("Status", col.status.x, y, { width: col.status.w, lineBreak: false });
    doc.text("Late", col.late.x, y, { width: col.late.w, align: "right", lineBreak: false });
    doc.text("Owed", col.owed.x, y, { width: col.owed.w, align: "right", lineBreak: false });
    doc.text("Balance", col.balance.x, y, { width: col.balance.w, align: "right", lineBreak: false });
    y += 12;

    const STATUS_COLOR: Record<string, string> = {
      paid: "#1a7f37",
      unpaid: "#b58900",
      delinquent: "#b02a1e",
      expected: "#1c64b0",
    };
    const STATUS_LABEL: Record<string, string> = {
      paid: "Paid",
      unpaid: "Unpaid",
      delinquent: "Delinquent",
      expected: "Expected",
    };

    const clip = (s: string, max: number) => (s.length > max ? s.slice(0, max - 1) + "…" : s);
    // Street portion only — keeps every row to a single line.
    const street = (addr: string) => (addr.split(",")[0] ?? addr).trim();

    doc.fontSize(bodyFont);
    for (const r of sorted) {
      if (y + rowH > footerY) break; // hard one-page guarantee
      const owed = owedOf(r);
      const tenant = [r.resident1Name, r.resident2Name].filter(Boolean).join(" & ") || "—";
      const credit = r.currentBalance > 0.005;

      doc.font("Helvetica").fillColor("#000000");
      doc.text(clip(street(r.address), 40), col.address.x, y, { width: col.address.w, lineBreak: false });
      doc.text(clip(tenant, 30), col.tenant.x, y, { width: col.tenant.w, lineBreak: false });
      doc.font("Helvetica-Bold").fillColor(STATUS_COLOR[r.status] ?? "#000000");
      doc.text(STATUS_LABEL[r.status] ?? r.status, col.status.x, y, { width: col.status.w, lineBreak: false });
      doc.font("Helvetica").fillColor("#000000");
      doc.text(r.daysLate > 0 ? `${r.daysLate}d` : "", col.late.x, y, { width: col.late.w, align: "right", lineBreak: false });
      doc.fillColor(owed > 0.005 ? "#b02a1e" : "#000000");
      doc.text(owed > 0.005 ? fmt$(owed) : "", col.owed.x, y, { width: col.owed.w, align: "right", lineBreak: false });
      doc.fillColor(credit ? "#1a7f37" : owed > 0.005 ? "#b02a1e" : "#000000");
      doc.text(
        credit ? `+${fmt$(r.currentBalance)}` : fmt$(r.currentBalance),
        col.balance.x, y, { width: col.balance.w, align: "right", lineBreak: false },
      );
      y += rowH;
    }

    // Footer
    doc.font("Helvetica").fontSize(7).fillColor("#666666");
    doc.text(
      "Live data from Rentec. Owed = current balance due; Past due (aged) = amounts past the grace period.",
      M, footerY, { width: W, align: "center", lineBreak: false },
    );

    doc.end();
    const pdf = await done;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="rent-report-${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}.pdf"`,
    );
    res.setHeader("Content-Length", pdf.length);
    res.end(pdf);
  } catch (err) {
    logger.error({ err }, "GET /collection/report/pdf failed");
    if (!res.headersSent) {
      res.status(500).json({ error: "Failed to generate PDF report" });
    } else {
      res.end();
    }
  }
});

export default router;
