import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, invoicesTable, jobsTable, activityTable } from "@workspace/db";
import { ListInvoicesQueryParams, MarkInvoicePaidParams } from "@workspace/api-zod";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { fireAndForget, fmtDate } from "../lib/sheets-sync";

const router: IRouter = Router();

const SHEET2 = process.env.MASTER_SHEET_2_ID || "";

function parseParam(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

router.post("/invoices", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { jobId, type, totalAmount, depositPaid = 0, dueDate } = req.body ?? {};

  if (!jobId || typeof jobId !== "number") { res.status(400).json({ error: "jobId is required" }); return; }
  if (!type || !["estimate", "invoice"].includes(type)) { res.status(400).json({ error: "type must be 'estimate' or 'invoice'" }); return; }
  if (typeof totalAmount !== "number" || totalAmount < 0) { res.status(400).json({ error: "totalAmount must be a non-negative number" }); return; }

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }

  const year = new Date().getFullYear();
  const prefix = type === "estimate" ? "EST" : "INV";
  const count = await db.select({ c: sql<number>`count(*)` }).from(invoicesTable)
    .where(eq(invoicesTable.type, type));
  const num = (Number(count[0]?.c) || 0) + 1;
  const invoiceNumber = `${prefix}-${year}-${String(num).padStart(3, "0")}`;
  const balanceDue = Math.max(0, totalAmount - depositPaid);
  const parsedDue = dueDate ? new Date(dueDate) : null;

  const [invoice] = await db.insert(invoicesTable).values({
    invoiceNumber,
    jobId,
    type,
    totalAmount: String(totalAmount),
    depositPaid: String(depositPaid),
    balanceDue: String(balanceDue),
    status: "unpaid",
    ...(parsedDue ? { dueDate: parsedDue } : {}),
  }).returning();

  await db.insert(activityTable).values({
    type: type === "estimate" ? "estimate_generated" : "invoice_generated",
    description: `${type === "estimate" ? "Estimate" : "Invoice"} ${invoiceNumber} created for job ${job.jobNumber}`,
    user: req.user!.username,
    linkedEntity: "invoice",
    linkedId: invoice.id,
  });

  res.status(201).json({
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    jobId: invoice.jobId,
    jobNumber: job.jobNumber,
    client: job.client,
    type: invoice.type,
    totalAmount: Number(invoice.totalAmount),
    depositPaid: Number(invoice.depositPaid),
    balanceDue: Number(invoice.balanceDue),
    status: invoice.status,
    issuedAt: invoice.issuedAt,
    dueDate: invoice.dueDate,
  });

  // Write to "3 - Invoice Log" for invoice type
  if (SHEET2 && type === "invoice") {
    const today = fmtDate();
    const dueDateStr = parsedDue ? fmtDate(parsedDue) : "";
    fireAndForget("invoice_created", SHEET2, "3 - Invoice Log", {
      type: "append",
      rowData: [
        invoiceNumber,
        job.jobNumber,
        job.client,
        job.address,
        today,
        totalAmount,
        depositPaid,
        balanceDue,
        dueDateStr,
        "Unpaid",
        "",
        "",
      ],
    });
  }
});

router.get("/invoices", requireAuth, async (_req, res): Promise<void> => {
  const query = _req.query;
  const invoices = await db.select({
    invoice: invoicesTable,
    job: {
      jobNumber: jobsTable.jobNumber,
      client: jobsTable.client,
      address: jobsTable.address,
    },
  }).from(invoicesTable)
    .leftJoin(jobsTable, eq(invoicesTable.jobId, jobsTable.id))
    .orderBy(sql`${invoicesTable.issuedAt} DESC`);

  const filtered = query.status
    ? invoices.filter((i) => i.invoice.status === query.status)
    : invoices;

  res.json(filtered.map((i) => ({
    id: i.invoice.id,
    invoiceNumber: i.invoice.invoiceNumber,
    jobId: i.invoice.jobId,
    jobNumber: i.job?.jobNumber || "",
    client: i.job?.client || "",
    address: i.job?.address || "",
    type: i.invoice.type,
    totalAmount: Number(i.invoice.totalAmount),
    depositPaid: Number(i.invoice.depositPaid),
    balanceDue: Number(i.invoice.balanceDue),
    status: i.invoice.status,
    issuedAt: i.invoice.issuedAt,
    dueDate: i.invoice.dueDate,
    pdfUrl: i.invoice.pdfUrl,
    driveFileId: i.invoice.driveFileId,
  })));
});

router.post("/invoices/:invoiceId/mark-paid", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const raw = parseParam(req.params.invoiceId);
  const invoiceId = parseInt(raw, 10);
  if (isNaN(invoiceId)) { res.status(400).json({ error: "Invalid invoice ID" }); return; }

  const [invoice] = await db.update(invoicesTable)
    .set({ status: "paid", balanceDue: "0" })
    .where(eq(invoicesTable.id, invoiceId))
    .returning();

  if (!invoice) { res.status(404).json({ error: "Invoice not found" }); return; }

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, invoice.jobId));

  await db.insert(activityTable).values({
    type: "invoice_paid",
    description: `Invoice ${invoice.invoiceNumber} marked as paid`,
    user: req.user!.username,
    linkedEntity: "invoice",
    linkedId: invoiceId,
  });

  res.json({
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    jobId: invoice.jobId,
    jobNumber: job?.jobNumber || "",
    client: job?.client || "",
    type: invoice.type,
    totalAmount: Number(invoice.totalAmount),
    depositPaid: Number(invoice.depositPaid),
    balanceDue: 0,
    status: "paid",
    issuedAt: invoice.issuedAt,
    dueDate: invoice.dueDate,
  });

  // Update "3 - Invoice Log" and "1 - Job Register" on payment
  if (SHEET2 && invoice.type === "invoice") {
    const today = fmtDate();
    const paidAmt = Number(invoice.totalAmount) - Number(invoice.depositPaid);
    fireAndForget("invoice_marked_paid", SHEET2, "3 - Invoice Log", {
      type: "update",
      matchCol: "Invoice #",
      matchVal: invoice.invoiceNumber,
      updates: {
        "Date Paid": today,
        "Amount Paid ($)": Math.max(0, paidAmt),
      },
    });

    if (job) {
      fireAndForget("invoice_paid_job_register", SHEET2, "1 - Job Register", {
        type: "update",
        matchCol: "Job #",
        matchVal: job.jobNumber,
        updates: {
          "Final Payment ($)": Math.max(0, paidAmt),
          "Final Pmt Date": today,
          "Status": "Paid",
        },
      });
    }
  }
});

export default router;
