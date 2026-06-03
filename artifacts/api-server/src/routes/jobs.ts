import { Router, type IRouter } from "express";
import { eq, and, sql } from "drizzle-orm";
import {
  db, jobsTable, receiptsTable, jobNotesTable, statusHistoryTable,
  invoicesTable, activityTable
} from "@workspace/db";
import {
  CreateJobBody, UpdateJobBody, ListJobsQueryParams,
  CreateReceiptBody,
} from "@workspace/api-zod";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { fireAndForget, fmtDate } from "../lib/sheets-sync";
import { uploadBase64ToDrive } from "../lib/google-drive";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const SHEET2 = process.env.MASTER_SHEET_2_ID || "";

function calcJobNumber(id: number, year: number): string {
  return `NCH-${year}-${String(id).padStart(3, "0")}`;
}

function parseParam(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\- ]/g, "").replace(/\s+/g, "_").slice(0, 50);
}

const USER_DISPLAY: Record<string, string> = {
  mike: "Mike Kell",
  jack: "Jack Kanam",
  jacob: "Jacob",
};

router.get("/jobs", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const params = ListJobsQueryParams.safeParse(req.query);
  const jobs = await db.select().from(jobsTable)
    .orderBy(sql`${jobsTable.createdAt} DESC`);

  const filtered = params.success && params.data.status
    ? jobs.filter((j) => j.status === params.data.status)
    : jobs;

  res.json(filtered.map((j) => ({
    id: j.id,
    jobNumber: j.jobNumber,
    client: j.client,
    address: j.address,
    description: j.description,
    status: j.status,
    estimateAmount: Number(j.estimateAmount),
    depositAmount: Number(j.depositAmount),
    totalCosts: Number(j.totalCosts),
    marginPercent: Number(j.estimateAmount) > 0
      ? Math.round(((Number(j.estimateAmount) - Number(j.totalCosts)) / Number(j.estimateAmount)) * 100)
      : 0,
    isOverBudget: j.isOverBudget,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
  })));
});

router.post("/jobs", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const parsed = CreateJobBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const year = new Date().getFullYear();
  const estimate = Number(parsed.data.estimateAmount);

  const [job] = await db.insert(jobsTable).values({
    jobNumber: "TEMP",
    client: parsed.data.client,
    address: parsed.data.address,
    description: parsed.data.description,
    estimateAmount: String(estimate),
    depositAmount: String(estimate * 0.5),
    totalCosts: "0",
    status: "estimate",
    isOverBudget: false,
    createdBy: req.user!.username,
  }).returning();

  const jobNumber = calcJobNumber(job.id, year);
  const [updated] = await db.update(jobsTable)
    .set({ jobNumber })
    .where(eq(jobsTable.id, job.id))
    .returning();

  await db.insert(statusHistoryTable).values({
    jobId: job.id,
    fromStatus: null,
    toStatus: "estimate",
    changedBy: req.user!.username,
    note: "Job created",
  });

  await db.insert(activityTable).values({
    type: "job_created",
    description: `New job ${jobNumber} created at ${updated.address}`,
    user: req.user!.username,
    linkedEntity: "job",
    linkedId: job.id,
  });

  const result = {
    ...updated,
    estimateAmount: Number(updated.estimateAmount),
    depositAmount: Number(updated.depositAmount),
    totalCosts: Number(updated.totalCosts),
    marginPercent: 100,
    isOverBudget: false,
  };
  res.status(201).json(result);

  // Trigger 1: New Job Created
  if (SHEET2) {
    fireAndForget("job_created", SHEET2, "1 - Job Register", {
      type: "append",
      rowData: [
        jobNumber,
        parsed.data.client,
        parsed.data.address,
        parsed.data.description ?? "",
        estimate,
        estimate * 0.5,
        "", "", "", "", "", "", "", "",
        "Estimate",
        year,
        "",
      ],
    });
  }
});

router.get("/jobs/:jobId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const raw = parseParam(req.params.jobId);
  const jobId = parseInt(raw, 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid job ID" }); return; }

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }

  const receipts = await db.select().from(receiptsTable).where(eq(receiptsTable.jobId, jobId));
  const notes = await db.select().from(jobNotesTable).where(eq(jobNotesTable.jobId, jobId)).orderBy(sql`${jobNotesTable.createdAt} DESC`);
  const statusHistory = await db.select().from(statusHistoryTable).where(eq(statusHistoryTable.jobId, jobId)).orderBy(sql`${statusHistoryTable.changedAt} DESC`);

  res.json({
    id: job.id,
    jobNumber: job.jobNumber,
    client: job.client,
    address: job.address,
    description: job.description,
    status: job.status,
    estimateAmount: Number(job.estimateAmount),
    depositAmount: Number(job.depositAmount),
    totalCosts: Number(job.totalCosts),
    marginPercent: Number(job.estimateAmount) > 0
      ? Math.round(((Number(job.estimateAmount) - Number(job.totalCosts)) / Number(job.estimateAmount)) * 100)
      : 0,
    isOverBudget: job.isOverBudget,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    receipts: receipts.map((r) => ({
      ...r,
      amount: Number(r.amount),
    })),
    notes,
    statusHistory,
  });
});

router.patch("/jobs/:jobId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const raw = parseParam(req.params.jobId);
  const jobId = parseInt(raw, 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid job ID" }); return; }

  const parsed = UpdateJobBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [existing] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!existing) { res.status(404).json({ error: "Job not found" }); return; }

  const updateData: Record<string, unknown> = {};
  if (parsed.data.status !== undefined) updateData.status = parsed.data.status;
  if (parsed.data.description !== undefined) updateData.description = parsed.data.description;
  if (parsed.data.estimateAmount !== undefined) {
    const est = Number(parsed.data.estimateAmount);
    updateData.estimateAmount = String(est);
    updateData.depositAmount = String(est * 0.5);
  }

  const statusChanged = parsed.data.status && parsed.data.status !== existing.status;

  if (statusChanged) {
    await db.insert(statusHistoryTable).values({
      jobId,
      fromStatus: existing.status,
      toStatus: parsed.data.status!,
      changedBy: req.user!.username,
      note: parsed.data.note || null,
    });

    await db.insert(activityTable).values({
      type: "job_status_changed",
      description: `Job ${existing.jobNumber} status changed to ${parsed.data.status}`,
      user: req.user!.username,
      linkedEntity: "job",
      linkedId: jobId,
    });
  }

  if (parsed.data.note && !parsed.data.status) {
    await db.insert(jobNotesTable).values({
      jobId,
      note: parsed.data.note,
      author: req.user!.username,
    });
  }

  const [updated] = await db.update(jobsTable).set(updateData).where(eq(jobsTable.id, jobId)).returning();
  if (!updated) { res.status(404).json({ error: "Job not found" }); return; }

  res.json({
    id: updated.id,
    jobNumber: updated.jobNumber,
    client: updated.client,
    address: updated.address,
    description: updated.description,
    status: updated.status,
    estimateAmount: Number(updated.estimateAmount),
    depositAmount: Number(updated.depositAmount),
    totalCosts: Number(updated.totalCosts),
    marginPercent: Number(updated.estimateAmount) > 0
      ? Math.round(((Number(updated.estimateAmount) - Number(updated.totalCosts)) / Number(updated.estimateAmount)) * 100)
      : 0,
    isOverBudget: updated.isOverBudget,
    createdAt: updated.createdAt,
    updatedAt: updated.updatedAt,
  });

  // Trigger 4: Job Status Updated
  if (SHEET2 && statusChanged) {
    const newStatus = parsed.data.status!;
    const displayStatus =
      newStatus === "estimate" ? "Estimate"
      : newStatus === "deposit_received" ? "Deposit Received"
      : newStatus === "in_progress" ? "In Progress"
      : newStatus === "invoiced" ? "Invoiced"
      : newStatus === "paid" ? "Paid"
      : newStatus === "complete" ? "Complete"
      : newStatus === "closed" ? "Closed"
      : newStatus;

    fireAndForget("job_status_updated", SHEET2, "1 - Job Register", {
      type: "update",
      matchCol: "Job #",
      matchVal: existing.jobNumber,
      updates: { "Status": displayStatus },
    });

    // Trigger 3: Deposit Received
    if (newStatus === "deposit_received") {
      const depositAmt = Number(existing.depositAmount);
      fireAndForget("deposit_received", SHEET2, "1 - Job Register", {
        type: "update",
        matchCol: "Job #",
        matchVal: existing.jobNumber,
        updates: {
          "Deposit Received ($)": depositAmt,
          "Deposit Date": fmtDate(),
          "Status": "Deposit Received",
        },
      });
    }

    // Trigger 6: Final Payment Received
    if (newStatus === "paid") {
      const invoices = await db.select().from(invoicesTable)
        .where(eq(invoicesTable.jobId, jobId));
      const latestInvoice = invoices
        .filter((inv) => inv.type === "invoice")
        .sort((a, b) => Number(b.id) - Number(a.id))[0];

      if (latestInvoice) {
        const finalAmt = Number(latestInvoice.balanceDue);
        const today = fmtDate();
        fireAndForget("final_payment_received_job", SHEET2, "1 - Job Register", {
          type: "update",
          matchCol: "Job #",
          matchVal: existing.jobNumber,
          updates: {
            "Final Payment ($)": finalAmt,
            "Final Pmt Date": today,
            "Status": "Paid",
          },
        });
        fireAndForget("final_payment_received_invoice", SHEET2, "3 - Invoice Log", {
          type: "update",
          matchCol: "Invoice #",
          matchVal: latestInvoice.invoiceNumber,
          updates: {
            "Date Paid": today,
            "Amount Paid ($)": finalAmt,
          },
        });
      }
    }
  }
});

router.get("/jobs/:jobId/receipts", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const raw = parseParam(req.params.jobId);
  const jobId = parseInt(raw, 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid job ID" }); return; }

  const receipts = await db.select().from(receiptsTable).where(eq(receiptsTable.jobId, jobId)).orderBy(sql`${receiptsTable.createdAt} DESC`);
  res.json(receipts.map((r) => ({ ...r, amount: Number(r.amount) })));
});

router.post("/jobs/:jobId/receipts", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const raw = parseParam(req.params.jobId);
  const jobId = parseInt(raw, 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid job ID" }); return; }

  const parsed = CreateReceiptBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }

  const [receipt] = await db.insert(receiptsTable).values({
    jobId,
    amount: String(parsed.data.amount),
    category: parsed.data.category,
    vendorName: parsed.data.vendorName || null,
    notes: parsed.data.notes || null,
    createdBy: req.user!.username,
  }).returning();

  const allReceipts = await db.select().from(receiptsTable).where(eq(receiptsTable.jobId, jobId));
  const newTotal = allReceipts.reduce((sum, r) => sum + Number(r.amount), 0);
  const isOverBudget = newTotal > Number(job.estimateAmount);

  await db.update(jobsTable).set({
    totalCosts: String(newTotal),
    isOverBudget,
  }).where(eq(jobsTable.id, jobId));

  await db.insert(activityTable).values({
    type: "receipt_logged",
    description: `Receipt logged for job ${job.jobNumber}: $${parsed.data.amount} (${parsed.data.category})`,
    user: req.user!.username,
    linkedEntity: "job",
    linkedId: jobId,
  });

  res.status(201).json({ ...receipt, amount: Number(receipt.amount) });

  // Fire-and-forget: upload photo to Drive, then write to Sheets with the Drive URL.
  const categoryLabel: Record<string, string> = {
    materials: "Materials",
    labor: "Labor",
    subcontractor: "Subcontractor",
    equipment_tools: "Equipment/Tools",
    vehicle_fuel: "Vehicle/Fuel",
    other: "Other Job Cost",
  };
  const today = fmtDate();
  const year = new Date().getFullYear();
  const username = req.user!.username;
  const receiptId = receipt.id;
  const jobNumber = job.jobNumber;
  const hasPhoto = Boolean(parsed.data.photoBase64);
  const photoBase64 = parsed.data.photoBase64;
  const vendorName = parsed.data.vendorName ?? "";
  const category = parsed.data.category;
  const notesText = parsed.data.notes ?? "";
  const amountNum = Number(parsed.data.amount);

  void (async () => {
    let photoUrl: string | null = null;

    if (hasPhoto && photoBase64) {
      const now = new Date();
      const dateStr = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}-${now.getFullYear()}`;
      const vendorSlug = sanitizeFilename(vendorName || "receipt");
      const filename = `${jobNumber}_${dateStr}_${vendorSlug}.jpg`;
      const folderPath = ["Receipt Scans", "Job Expenses", jobNumber];

      try {
        photoUrl = await uploadBase64ToDrive(photoBase64, filename, folderPath);
        if (photoUrl) {
          await db.update(receiptsTable)
            .set({ photoUrl })
            .where(eq(receiptsTable.id, receiptId));
        } else {
          logger.error({ receiptId, jobNumber, filename }, "Drive upload returned null — receipt saved without photo URL");
        }
      } catch (err: any) {
        logger.error(
          { receiptId, jobNumber, filename, err: String(err?.message ?? err) },
          "Drive upload threw — receipt saved without photo URL",
        );
      }
    }

    if (SHEET2) {
      fireAndForget("receipt_logged", SHEET2, "2 - Job Costs", {
        type: "append",
        rowData: [
          jobNumber,
          today,
          categoryLabel[category] ?? category,
          vendorName,
          notesText,
          amountNum,
          photoUrl ?? "",
          USER_DISPLAY[username] ?? username,
          "",
          year,
        ],
      });
    } else {
      logger.error({ receiptId, jobNumber }, "Skipping Sheets write: MASTER_SHEET_2_ID is not set");
    }
  })();
});

router.post("/jobs/:jobId/generate-estimate", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const raw = parseParam(req.params.jobId);
  const jobId = parseInt(raw, 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid job ID" }); return; }

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }

  const year = new Date().getFullYear();
  const count = await db.select({ count: sql<number>`count(*)` }).from(invoicesTable)
    .where(and(eq(invoicesTable.type, "estimate")));
  const num = (Number(count[0]?.count) || 0) + 1;
  const invoiceNumber = `EST-${year}-${String(num).padStart(3, "0")}`;
  const estimate = Number(job.estimateAmount);
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 14);

  const [invoice] = await db.insert(invoicesTable).values({
    invoiceNumber,
    jobId,
    type: "estimate",
    totalAmount: String(estimate),
    depositPaid: "0",
    balanceDue: String(estimate),
    status: "unpaid",
    dueDate,
  }).returning();

  await db.insert(activityTable).values({
    type: "estimate_generated",
    description: `Estimate ${invoiceNumber} generated for job ${job.jobNumber}`,
    user: req.user!.username,
    linkedEntity: "job",
    linkedId: jobId,
  });

  res.json({
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    pdfUrl: null,
    driveFileId: null,
  });
});

router.post("/jobs/:jobId/generate-invoice", requireAuth, async (req: AuthRequest, res): Promise<void> => {

  const raw = parseParam(req.params.jobId);
  const jobId = parseInt(raw, 10);
  if (isNaN(jobId)) { res.status(400).json({ error: "Invalid job ID" }); return; }

  const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, jobId));
  if (!job) { res.status(404).json({ error: "Job not found" }); return; }

  const year = new Date().getFullYear();
  const count = await db.select({ count: sql<number>`count(*)` }).from(invoicesTable)
    .where(and(eq(invoicesTable.type, "invoice")));
  const num = (Number(count[0]?.count) || 0) + 1;
  const invoiceNumber = `INV-${year}-${String(num).padStart(3, "0")}`;
  const total = Number(job.totalCosts);
  const deposit = Number(job.depositAmount);
  const balance = Math.max(0, total - deposit);
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30);

  const [invoice] = await db.insert(invoicesTable).values({
    invoiceNumber,
    jobId,
    type: "invoice",
    totalAmount: String(total),
    depositPaid: String(deposit),
    balanceDue: String(balance),
    status: "unpaid",
    dueDate,
  }).returning();

  await db.update(jobsTable).set({ status: "invoiced" }).where(eq(jobsTable.id, jobId));

  await db.insert(activityTable).values({
    type: "invoice_generated",
    description: `Invoice ${invoiceNumber} generated for job ${job.jobNumber} — $${balance} due`,
    user: req.user!.username,
    linkedEntity: "job",
    linkedId: jobId,
  });

  res.json({
    invoiceId: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    pdfUrl: null,
    driveFileId: null,
  });

  // Trigger 5: Invoice Generated → "3 - Invoice Log"
  if (SHEET2) {
    const today = fmtDate();
    fireAndForget("invoice_generated", SHEET2, "3 - Invoice Log", {
      type: "append",
      rowData: [
        invoiceNumber,
        job.jobNumber,
        job.client,
        job.address,
        today,
        total,
        deposit,
        balance,
        fmtDate(dueDate),
        "Unpaid",
        "",
        "",
      ],
    });

    // Also update Job Register status
    fireAndForget("invoice_generated_status", SHEET2, "1 - Job Register", {
      type: "update",
      matchCol: "Job #",
      matchVal: job.jobNumber,
      updates: { "Status": "Invoiced" },
    });
  }
});

export default router;
