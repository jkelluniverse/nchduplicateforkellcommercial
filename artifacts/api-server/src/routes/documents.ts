/**
 * Standalone document generation — branded PDFs that are produced on demand
 * (not tied to an eviction case). Currently: the Past Due Notice, a one-page
 * formal demand for payment generated from a property's ledger balance.
 */
import { Router, type IRouter } from "express";
import { requireAuth, requireRole } from "../middlewares/auth";
import { generatePastDueNotice, type PastDueNoticeData } from "../lib/pdf-generator";
import { logger } from "../lib/logger";
import fs from "fs";

const router: IRouter = Router();
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

function todayMMDDYYYY(): string {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}${d.getFullYear()}`;
}

// POST /api/documents/past-due-notice — generate the branded PDF (Jacob only).
router.post("/documents/past-due-notice", requireAuth, requireRole("jacob"), async (req, res): Promise<void> => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const recipient_name = String(b.recipient_name ?? "").trim();
  const property_address = String(b.property_address ?? "").trim();
  if (!recipient_name || !property_address) {
    res.status(400).json({ error: "Recipient and property address are required" });
    return;
  }

  const data: PastDueNoticeData = {
    recipient_name,
    property_address,
    notice_date: String(b.notice_date ?? "").trim(),
    pay_by_date: String(b.pay_by_date ?? "").trim(),
    period_covered: b.period_covered ? String(b.period_covered).trim() : undefined,
    account_ref: b.account_ref ? String(b.account_ref).trim() : undefined,
    amount_past_due: num(b.amount_past_due),
    late_fees: num(b.late_fees),
    other_charges: num(b.other_charges),
  };

  try {
    const localPath = await generatePastDueNotice(data);
    const pdfBase64 = fs.readFileSync(localPath).toString("base64");
    try { fs.unlinkSync(localPath); } catch { /* best-effort cleanup */ }
    const filename = `Past Due Notice - ${property_address.replace(/[^a-zA-Z0-9 ]/g, "")}_${todayMMDDYYYY()}.pdf`;
    res.json({ filename, pdfBase64 });
  } catch (err: any) {
    logger.error({ err }, "past due notice generation failed");
    res.status(500).json({ error: err.message || "Failed to generate past due notice" });
  }
});

export default router;
