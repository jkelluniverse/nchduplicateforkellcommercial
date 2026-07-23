/**
 * Standalone document generation — branded PDFs that are produced on demand
 * (not tied to an eviction case). Currently: the Past Due Notice, a one-page
 * formal demand for payment generated from a property's ledger balance.
 */
import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, propertiesTable } from "@workspace/db";
import { requireAuth, requireRole } from "../middlewares/auth";
import { generatePastDueNotice, generateAccountBalance, type PastDueNoticeData } from "../lib/pdf-generator";
import { getPropertyLedger } from "../services/property-ledger";
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

// POST /api/documents/statement — full transaction-history statement for a
// property (Jacob only). Prints the same branded account-balance layout used
// for court filings, built from the live ledger (Rentec first, sheet fallback).
router.post("/documents/statement", requireAuth, requireRole("jacob"), async (req, res): Promise<void> => {
  const propertyId = num((req.body as Record<string, unknown> | undefined)?.propertyId);
  if (!propertyId) { res.status(400).json({ error: "propertyId required" }); return; }
  try {
    const [prop] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, propertyId));
    if (!prop) { res.status(404).json({ error: "Property not found" }); return; }
    const ledger = await getPropertyLedger(prop.address, prop.resident1Name ?? null);
    if (ledger.lines.length === 0) { res.status(404).json({ error: "No transactions on this account yet" }); return; }

    // Ledger lines arrive newest-first — the statement reads oldest-first.
    const lines = [...ledger.lines].reverse();
    const total_charged = lines.reduce((s, l) => s + (l.debit ?? 0), 0);
    const total_paid = lines.reduce((s, l) => s + (l.credit ?? 0), 0);
    const localPath = await generateAccountBalance({
      property_address: prop.address,
      tenant_name: ledger.tenantName ?? prop.resident1Name ?? "",
      generated_date: new Date().toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }),
      transactions: lines.map((l) => ({
        date: l.date,
        description: l.subDescription ? `${l.description} — ${l.subDescription}` : l.description,
        charge: l.debit ?? 0,
        payment: l.credit ?? 0,
        balance: l.balance,
      })),
      total_charged: Math.round(total_charged * 100) / 100,
      total_paid: Math.round(total_paid * 100) / 100,
      balance_due: Math.max(0, -ledger.currentBalance),
    });
    const pdfBase64 = fs.readFileSync(localPath).toString("base64");
    try { fs.unlinkSync(localPath); } catch { /* best-effort cleanup */ }
    const filename = `Statement - ${prop.address.replace(/[^a-zA-Z0-9 ]/g, "")}_${todayMMDDYYYY()}.pdf`;
    res.json({ filename, pdfBase64 });
  } catch (err: any) {
    logger.error({ err }, "statement generation failed");
    res.status(500).json({ error: err.message || "Failed to generate statement" });
  }
});

export default router;
