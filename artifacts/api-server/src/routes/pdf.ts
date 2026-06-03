import { Router, type IRouter } from "express";
import { eq, sql, like, and } from "drizzle-orm";
import { db, invoicesTable, jobsTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { generateEstimate, generateInvoice, type EstimateData, type InvoiceData } from "../lib/pdf-generator";
import { resolveOrCreateFolderPath, uploadFileToDrive } from "../lib/google-drive";
import { fireAndForget, fmtDate } from "../lib/sheets-sync";
import { buildEstimateFilename, buildInvoiceFilename } from "../lib/doc-filename";
import fs from "fs";
import path from "path";

const SHEET2 = process.env.MASTER_SHEET_2_ID || "";

const router: IRouter = Router();

/** GET /api/invoices/next-number?type=estimate|invoice
 *  Returns the next document number for the current year.
 */
router.get("/invoices/next-number", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  try {
    const type = req.query.type as string;
    if (!type || !["estimate", "invoice"].includes(type)) {
      res.status(400).json({ error: "type must be 'estimate' or 'invoice'" });
      return;
    }

    const year = new Date().getFullYear();
    const prefix = type === "estimate" ? "EST" : "INV";
    const pattern = `${prefix}-${year}-%`;

    const rows = await db
      .select({ invoiceNumber: invoicesTable.invoiceNumber })
      .from(invoicesTable)
      .where(and(eq(invoicesTable.type, type as any), like(invoicesTable.invoiceNumber, pattern)));

    let maxNum = 0;
    for (const row of rows) {
      const parts = row.invoiceNumber.split("-");
      const n = parseInt(parts[2] || "0", 10);
      if (n > maxNum) maxNum = n;
    }

    const nextNum = maxNum + 1;
    const docNumber = `${prefix}-${year}-${String(nextNum).padStart(3, "0")}`;
    res.json({ docNumber, nextNum, year, type });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to get next document number" });
  }
});

/** POST /api/generate-pdf
 *  Body: { type: "estimate"|"invoice", jobId: number, data: EstimateData|InvoiceData }
 *  Returns: { filename, driveUrl, pdfBase64, savedTo }
 */
router.post("/generate-pdf", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { type, jobId, data } = req.body ?? {};

  if (!type || !["estimate", "invoice"].includes(type)) {
    res.status(400).json({ error: "type must be 'estimate' or 'invoice'" });
    return;
  }
  if (!data || typeof data !== "object") {
    res.status(400).json({ error: "data is required" });
    return;
  }
  if (!data.doc_number || !data.issued_date || !data.client_name || !data.client_address) {
    res.status(400).json({ error: "data must include doc_number, issued_date, client_name, client_address" });
    return;
  }
  if (!Array.isArray(data.line_items) || data.line_items.length === 0) {
    res.status(400).json({ error: "data.line_items must be a non-empty array" });
    return;
  }

  try {
    // 1. Generate PDF
    let localPath: string;
    if (type === "invoice") {
      localPath = await generateInvoice(data as InvoiceData);
    } else {
      localPath = await generateEstimate(data as EstimateData);
    }

    // Build filename per Jacob's spec (May 2026):
    //   "NCH Estimate - <jobNumber>_<MM-DD-YYYY>.pdf"
    //   "NCH Invoice - <jobNumber>_<MM-DD-YYYY>.pdf"
    // Use the JOB number (e.g. "NCH-2026-006") rather than the document
    // number (e.g. "EST-2026-001") per spec. Fall back to the doc number
    // if no jobId was supplied (legacy callers).
    let jobNumberForFilename = String(data.doc_number);
    if (jobId) {
      try {
        const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, Number(jobId)));
        if (job?.jobNumber) jobNumberForFilename = job.jobNumber;
      } catch {
        // Non-fatal — keep the doc_number fallback.
      }
    }
    const filename = type === "estimate"
      ? buildEstimateFilename(jobNumberForFilename)
      : buildInvoiceFilename(jobNumberForFilename);

    // 2. Upload to Google Drive
    let driveUrl = "";
    let savedTo = "";
    let driveFileId = "";

    try {
      let folderPath: string[];
      if (type === "estimate") {
        folderPath = ["Invoices", "Estimates"];
        savedTo = "NCH Drive / Invoices / Estimates";
      } else {
        const jobLabel = jobId ? `Job-${jobId}` : data.doc_number;
        folderPath = ["Invoices", jobLabel];
        savedTo = `NCH Drive / Invoices / ${jobLabel}`;
      }

      const folderId = await resolveOrCreateFolderPath(folderPath);
      const result = await uploadFileToDrive(localPath, filename, folderId);
      driveUrl = result.webViewLink;
      driveFileId = result.fileId;
    } catch (driveErr: any) {
      // Drive upload is non-fatal — still return the PDF for download
      driveUrl = "";
      // Surface a clean message without the full stack
      const msg = String(driveErr.message || "").toLowerCase();
      if (msg.includes("quota") || msg.includes("service account")) {
        savedTo = "Drive upload unavailable — the service account needs editor access to a Shared Drive. PDF is available for download below.";
      } else {
        savedTo = `Drive upload skipped: ${driveErr.message}`;
      }
    }

    // 3. Read PDF as base64 for in-app download
    const pdfBuffer = fs.readFileSync(localPath);
    const pdfBase64 = pdfBuffer.toString("base64");

    // 4. Update invoice record if jobId provided
    if (jobId && driveFileId) {
      try {
        const year = new Date().getFullYear();
        const docPrefix = type === "estimate" ? "EST" : "INV";
        const count = await db
          .select({ c: sql<number>`count(*)` })
          .from(invoicesTable)
          .where(eq(invoicesTable.type, type as any));
        const num = (Number(count[0]?.c) || 0) + 1;
        const invoiceNumber = data.doc_number || `${docPrefix}-${year}-${String(num).padStart(3, "0")}`;
        const totalAmount = (data.line_items as any[]).reduce((s: number, i: any) => s + (i.qty * i.price), 0);
        const depositPaid = type === "invoice" ? ((data as InvoiceData).deposit_paid || 0) : 0;
        const balanceDue = Math.max(0, totalAmount - depositPaid);

        await db.insert(invoicesTable).values({
          invoiceNumber,
          jobId: Number(jobId),
          type: type as any,
          totalAmount: String(totalAmount),
          depositPaid: String(depositPaid),
          balanceDue: String(balanceDue),
          status: "unpaid",
          driveFileId,
        }).onConflictDoNothing();
      } catch {
        // Non-fatal: invoice record creation failure
      }
    }

    // 5. Clean up temp file
    try { fs.unlinkSync(localPath); } catch {}

    // Calculate total for sheets
    const invoiceTotal = (data.line_items as any[]).reduce(
      (s: number, i: any) => s + (i.qty * i.price), 0
    );

    res.json({
      filename,
      driveUrl,
      savedTo,
      pdfBase64,
    });

    // Trigger 5: Invoice Generated (only for invoice type, not estimates)
    if (SHEET2 && type === "invoice" && jobId) {
      const invoiceNumber = data.doc_number as string;
      const today = fmtDate();
      const year = new Date().getFullYear();

      // Fetch job number for the update
      try {
        const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, Number(jobId)));
        if (job) {
          // 5A — Append to invoice log
          fireAndForget("invoice_generated_log", SHEET2, "3 - Invoice Log", {
            type: "append",
            rowData: [
              invoiceNumber,
              job.jobNumber,
              data.client_name as string,
              today,
              invoiceTotal,
              "", "",
              year,
            ],
          });

          // 5B — Update job register
          fireAndForget("invoice_generated_job", SHEET2, "1 - Job Register", {
            type: "update",
            matchCol: "Job #",
            matchVal: job.jobNumber,
            updates: {
              "Invoice #": invoiceNumber,
              "Invoice Amount ($)": invoiceTotal,
              "Status": "Invoiced",
            },
          });
        }
      } catch {
        // Non-fatal
      }
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message || "PDF generation failed" });
  }
});

export default router;
