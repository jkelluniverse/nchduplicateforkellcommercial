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
 * Generate a single-page PDF report showing all properties and their payment status.
 * Aggregates paid, unpaid, late, delinquent, and partial statuses with a summary table.
 */
router.get(
  "/collection/report/pdf",
  requireAuth,
  requireRole("jacob"),
  async (_req, res): Promise<void> => {
    try {
      const now = new Date();
      const month = now.getMonth() + 1;
      const year = now.getFullYear();

      const status = await rentec.getRentStatus(month, year);
      if (!status) {
        res.status(500).json({ error: "Failed to load rent status from Rentec" });
        return;
      }

      // Aggregate statistics by status
      const stats = {
        paid: 0,
        unpaid: 0,
        late: 0,
        delinquent: 0,
        partial: 0,
        totalDue: 0,
        totalPaid: 0,
      };

      for (const row of status.rows) {
        stats[row.status]++;
        const owed = Math.max(0, row.monthlyRent - row.amountPaid) + row.lateFeeDue;
        stats.totalDue += owed;
        stats.totalPaid += row.amountPaid;
      }

      // Create PDF document
      const doc = new PDFDocument({
        size: "letter",
        margin: 40,
      });

      // Set response headers for PDF download
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="rent-report-${year}-${String(month).padStart(2, "0")}.pdf"`,
      );

      // Pipe PDF to response
      doc.pipe(res);

      // Title and date
      doc.fontSize(24).font("Helvetica-Bold").text("Rent Status Report", { align: "center" });
      doc.fontSize(11).font("Helvetica").text(
        `Month: ${new Date(year, month - 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })}`,
        { align: "center" },
      );
      doc.fontSize(10).text(`Generated: ${new Date().toLocaleDateString("en-US")}`, { align: "center" });
      doc.moveDown(0.5);

      // Summary section
      doc.fontSize(12).font("Helvetica-Bold").text("Summary");
      doc.fontSize(10).font("Helvetica");
      const summaryData = [
        ["Total Properties:", status.uniquePropertyCount.toString()],
        ["Paid:", stats.paid.toString()],
        ["Unpaid:", stats.unpaid.toString()],
        ["Late:", stats.late.toString()],
        ["Delinquent:", stats.delinquent.toString()],
        ["Partial:", stats.partial.toString()],
        ["Total Amount Due:", `$${stats.totalDue.toFixed(2)}`],
        ["Total Amount Paid:", `$${stats.totalPaid.toFixed(2)}`],
      ];

      const summaryTable = {
        width: 200,
        columns: ["Label", "Value"],
        rows: summaryData.map((row) => ({
          Label: { text: row[0], width: 100 },
          Value: { text: row[1], width: 100 },
        })),
      };

      doc.moveDown(0.25);
      // Manual summary rendering since table plugin not available
      for (const [label, value] of summaryData) {
        doc.text(`${label} ${value}`, { indent: 20 });
      }

      doc.moveDown(0.5);

      // Properties table header
      doc.fontSize(12).font("Helvetica-Bold").text("Property Details");
      doc.fontSize(9).font("Helvetica-Bold");

      const pageHeight = doc.page.height;
      const pageWidth = doc.page.width;
      const margin = 40;
      const contentWidth = pageWidth - 2 * margin;

      // Column widths for compact display
      const colWidths = {
        address: contentWidth * 0.35,
        tenant: contentWidth * 0.25,
        status: contentWidth * 0.15,
        owed: contentWidth * 0.1,
        paid: contentWidth * 0.15,
      };

      // Table header row
      const headerY = doc.y;
      doc.text("Address", margin, headerY, { width: colWidths.address, continued: false });
      doc.text("Tenant", margin + colWidths.address, headerY, {
        width: colWidths.tenant,
        continued: false,
      });
      doc.text("Status", margin + colWidths.address + colWidths.tenant, headerY, {
        width: colWidths.status,
        continued: false,
      });
      doc.text("Owed", margin + colWidths.address + colWidths.tenant + colWidths.status, headerY, {
        width: colWidths.owed,
        continued: false,
      });
      doc.text(
        "Paid",
        margin + colWidths.address + colWidths.tenant + colWidths.status + colWidths.owed,
        headerY,
        {
          width: colWidths.paid,
          continued: false,
        },
      );

      // Draw header underline
      doc.moveTo(margin, doc.y).lineTo(pageWidth - margin, doc.y).stroke();
      doc.moveDown(0.25);

      // Table data rows
      doc.fontSize(8).font("Helvetica");
      for (const row of status.rows) {
        const owed = Math.max(0, row.monthlyRent - row.amountPaid) + row.lateFeeDue;
        const currentY = doc.y;

        // Check if we need a new page
        if (currentY > pageHeight - 80) {
          doc.addPage();
          doc.fontSize(8).font("Helvetica");
        }

        // Truncate address for display
        const displayAddress =
          row.address.length > 40 ? row.address.substring(0, 40) + "..." : row.address;

        doc.text(displayAddress, margin, { width: colWidths.address, continued: false });
        doc.text(row.tenantName || "—", margin + colWidths.address, {
          width: colWidths.tenant,
          continued: false,
        });

        // Status with color coding
        const statusColor = {
          paid: "green",
          unpaid: "red",
          late: "orange",
          delinquent: "darkred",
          partial: "blue",
        };

        const statusText = row.status.charAt(0).toUpperCase() + row.status.slice(1);
        doc.text(statusText, margin + colWidths.address + colWidths.tenant, {
          width: colWidths.status,
          continued: false,
        });
        doc.text(
          `$${owed.toFixed(2)}`,
          margin + colWidths.address + colWidths.tenant + colWidths.status,
          {
            width: colWidths.owed,
            continued: false,
          },
        );
        doc.text(
          `$${row.amountPaid.toFixed(2)}`,
          margin + colWidths.address + colWidths.tenant + colWidths.status + colWidths.owed,
          {
            width: colWidths.paid,
            continued: false,
          },
        );

        doc.moveDown(0.3);
      }

      // Footer
      doc.fontSize(8).font("Helvetica").text(
        "This report was automatically generated from Rentec data.",
        margin,
        pageHeight - 30,
        {
          align: "center",
        },
      );

      doc.end();
    } catch (err) {
      logger.error({ err }, "GET /collection/report/pdf failed");
      res.status(500).json({ error: "Failed to generate PDF report" });
    }
  },
);

export default router;
