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

// A missed month is treated as 30+ days delinquent; a flat late fee applies.
const LATE_FEE_AMOUNT = 75;
const DELINQUENT_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
// Sub-$100 past-due remainders are treated as paid (carried fees, rent paid).
const UNPAID_FLOOR = 100;

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

export interface ParseOptions {
  asOf?: number;
  portfolio?: Portfolio;
  /** Absolute row indices (into `values`) flagged vacant via red highlight. */
  vacant?: Set<number>;
}

/**
 * Turn raw DAILY TRACKER rows into a rent-status snapshot for one month.
 *
 * Status rules reflect how the portfolio actually pays (per Jacob):
 *  - Each month's column already holds that month's payment regardless of the
 *    date it was made (pre-payments before the 1st included), so we attribute
 *    by column, never by calendar date.
 *  - Tenants have varying due days (e.g. Tom Reed pays the 15th), so an unpaid
 *    current month early in the cycle is NOT "late". We judge standing by
 *    whether a payment was recorded LAST month: if it was, the tenant is
 *    current; delinquent only when the prior month has no payment at all.
 *  - Vacant units (highlighted red in the sheet) are excluded entirely — their
 *    rent does not count toward expected collections.
 */
export function parseTrackerRows(
  values: unknown[][],
  month: number,
  year: number,
  opts: ParseOptions = {},
): DLRentStatus {
  const { asOf = Date.now(), portfolio = "all", vacant } = opts;
  const paidCol = 4 + (month - 1) * 2; // this month's "Paid $" column
  const billingFirst = new Date(year, month - 1, 1).getTime();
  const daysSinceFirst = Math.max(0, Math.floor((asOf - billingFirst) / DAY_MS));
  const monthPaidCol = (m: number) => 4 + (m - 1) * 2;

  const rows: DLRentRow[] = [];
  const properties = new Set<string>();
  // The tracker is split into "DAD'S PORTFOLIO" then "JACOB'S PROPERTIES"
  // section banners; track which we're in so we can include only one.
  let section: "dad" | "jacob" = "dad";

  for (let rowIndex = 0; rowIndex < values.length; rowIndex++) {
    const raw = values[rowIndex];
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
    // Vacant units (red in the sheet) don't count toward expected collections.
    if (vacant?.has(rowIndex)) continue;

    const paid = Math.max(0, money(raw[paidCol]));
    const appliedPaid = Math.min(paid, rent); // credit/overpay doesn't mask others

    // ── Delinquency ──────────────────────────────────────────────────
    // Tenants pay on varying days and pre-pay, so "didn't pay yet this month"
    // is NOT delinquent. A tenant is delinquent only when they are carrying a
    // real aged balance, which we detect two ways:
    //   (auto) a fully-skipped month between their first payment and two months
    //          ago — i.e. they missed a month and never caught up; and
    //   (manual) an operator flag in column A ("D"/"X"/"delinquent") for cases
    //          the 2026 tracker can't see (e.g. a balance carried from 2025).
    // An "OK"/"current" flag in column A clears a false positive.
    const flag = String(raw[0] ?? "").trim().toLowerCase();
    const forceDelinquent = flag === "d" || flag === "x" || flag.startsWith("delinq");
    const forceClear = ["ok", "c", "current", "good", "fine"].includes(flag);

    let firstPaymentMonth = 0;
    for (let m = 1; m <= 12; m++) {
      if (money(raw[monthPaidCol(m)]) > 0) { firstPaymentMonth = m; break; }
    }
    let oldestSkip = 0;
    if (firstPaymentMonth > 0) {
      // Months strictly after the first payment and at least two months back
      // (current and prior month are still within the normal pay window).
      for (let m = firstPaymentMonth + 1; m <= month - 2; m++) {
        if (money(raw[monthPaidCol(m)]) <= 0) { oldestSkip = m; break; }
      }
    }
    const delinquent = forceClear ? false : forceDelinquent || oldestSkip > 0;

    let status: DLRentRow["status"];
    let daysOverdue = 0;
    let lateFeeDue = 0;
    if (delinquent) {
      status = "delinquent";
      // Age from the oldest unpaid/short month so "days over" is meaningful.
      let agingMonth = oldestSkip;
      if (!agingMonth) {
        for (let m = firstPaymentMonth || 1; m <= month - 1; m++) {
          if (money(raw[monthPaidCol(m)]) < rent) { agingMonth = m; break; }
        }
      }
      if (!agingMonth) agingMonth = Math.max(1, month - 1);
      const ageFrom = new Date(year, agingMonth - 1, 1).getTime();
      daysOverdue = Math.max(DELINQUENT_DAYS, Math.floor((asOf - ageFrom) / DAY_MS));
      lateFeeDue = LATE_FEE_AMOUNT;
    } else if (paid >= rent) {
      // Covers this month (including pre-payments logged before the 1st).
      status = "paid";
    } else if (paid > 0) {
      status = "partial";
      daysOverdue = daysSinceFirst;
    } else {
      // Nothing yet this month, but current — due date may simply not have
      // arrived (varies per tenant). Outstanding for the month, but not late.
      status = "unpaid";
      daysOverdue = daysSinceFirst;
    }

    // Real past-due dollars this month. A sub-$100 remainder is almost always a
    // carried fee after the rent was paid, so treat it as paid (not unpaid).
    const pastDueAmount = round2(Math.max(0, rent - appliedPaid));
    if (pastDueAmount < UNPAID_FLOOR && status !== "delinquent") {
      status = "paid";
      daysOverdue = 0;
      lateFeeDue = 0;
    }

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
      pastDueAmount,
      // The Google Sheet path has no per-tenant due day, so it never produces an
      // "upcoming"/expected row.
      expectedDate: null,
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
