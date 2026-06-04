/**
 * Pure parser for the "MASTER RENT LEDGER V.4" → DAILY TRACKER tab.
 *
 * Kept free of any I/O (no googleapis import) so it can be unit-tested and so
 * the heavy Sheets client only loads where it's actually needed.
 *
 * DAILY TRACKER column layout (0-based):
 *   0 section banner | 1 Address | 2 Tenant | 3 Rent($) |
 *   4 Jan Paid | 5 Jan Date | 6 Feb Paid | 7 Feb Date | … (two cols per month)
 */
import type { DLRentStatus, DLRentRow } from "./rentec";

// Rent-cycle rules shared across the app: due on the 1st, 10-day grace, late
// fee on the 11th, delinquent once a balance is 30+ days old.
const GRACE_DAYS = 10;
const LATE_FEE_AMOUNT = 75;
const DELINQUENT_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

export function money(v: unknown): number {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string") {
    const n = Number(v.replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

export type Portfolio = "dad" | "jacob" | "all";

/** Turn raw DAILY TRACKER rows into a rent-status snapshot for one month. */
export function parseTrackerRows(
  values: unknown[][],
  month: number,
  year: number,
  asOf: number = Date.now(),
  portfolio: Portfolio = "all",
): DLRentStatus {
  const paidCol = 4 + (month - 1) * 2; // this month's "Paid $" column
  const priorPaidCol = paidCol - 2; // previous month's "Paid $" column
  const billingFirst = new Date(year, month - 1, 1).getTime();
  const priorFirst = new Date(year, month - 2, 1).getTime();
  const daysSinceFirst = Math.max(0, Math.floor((asOf - billingFirst) / DAY_MS));
  const pastGrace = daysSinceFirst > GRACE_DAYS;

  const rows: DLRentRow[] = [];
  const properties = new Set<string>();
  // The tracker is split into "DAD'S PORTFOLIO" then "JACOB'S PROPERTIES"
  // section banners; track which we're in so we can include only one.
  let section: "dad" | "jacob" = "dad";

  for (const raw of values) {
    if (!Array.isArray(raw)) continue;

    // Section banners (label sits in col A; the rest of the row is empty).
    const banner = `${String(raw[0] ?? "")} ${String(raw[1] ?? "")}`;
    if (/jacob'?s?\b/i.test(banner) && /propert/i.test(banner)) { section = "jacob"; continue; }
    if (/dad'?s?\b/i.test(banner) && /portfolio/i.test(banner)) { section = "dad"; continue; }
    if (portfolio !== "all" && section !== portfolio) continue;

    const address = String(raw[1] ?? "").trim();
    const tenant = String(raw[2] ?? "").trim();
    const rent = money(raw[3]);
    // Occupied data rows only: real address + tenant + a positive rent.
    if (!address || !tenant || rent <= 0) continue;
    // Skip section banners / totals / header rows.
    if (/portfolio|^\s*totals?\s*$|property address/i.test(address)) continue;
    if (/^\s*totals?\s*$|portfolio/i.test(tenant)) continue;

    const paid = Math.max(0, money(raw[paidCol]));
    const priorPaid = priorPaidCol >= 4 ? money(raw[priorPaidCol]) : rent;
    const priorCovered = priorPaid >= rent;
    const appliedPaid = Math.min(paid, rent); // credit/overpay doesn't mask others

    let status: DLRentRow["status"];
    let daysOverdue = 0;
    if (paid >= rent) {
      status = "paid";
    } else if (!priorCovered) {
      // Carrying an unpaid balance from a prior month → 30+ days old.
      status = "delinquent";
      daysOverdue = Math.max(DELINQUENT_DAYS, Math.floor((asOf - priorFirst) / DAY_MS));
    } else if (paid > 0) {
      status = "partial";
      daysOverdue = daysSinceFirst;
    } else {
      status = "unpaid";
      daysOverdue = daysSinceFirst;
    }

    const lateFeeDue = status !== "paid" && pastGrace ? LATE_FEE_AMOUNT : 0;

    rows.push({
      leaseId: `${address}::${tenant}`,
      propertyDoorloopId: address,
      address,
      tenantName: tenant,
      monthlyRent: rent,
      amountPaid: round2(appliedPaid),
      lateFeeDue,
      lateFeePaid: 0,
      paymentDate: null,
      status,
      daysOverdue,
    });
    properties.add(address);
  }

  return {
    month,
    year,
    rows,
    uniquePropertyCount: properties.size,
    fetchedAt: new Date().toISOString(),
  };
}
