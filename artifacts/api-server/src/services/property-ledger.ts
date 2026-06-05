/**
 * Per-property account statement for Kell Commercial.
 *
 * Hybrid source (per Jacob): pull the live Rentec ledger first so the screen
 * mirrors Rentec's own statement (date · description · check# · debit · credit ·
 * running balance). If Rentec is unreachable or has no transactions for the
 * property, fall back to a statement built from the Master Ledger's monthly
 * history so the screen is never empty.
 *
 * Balance convention matches Rentec: running balance = Σ(credit − debit), so a
 * rent charge drives the balance negative (tenant owes) and a payment brings it
 * back toward zero.
 */
import * as rentec from "./rentec";
import { getTrackerHistoryForAddress, type LedgerHistory } from "./rent-ledger";

export interface LedgerLine {
  date: string; // ISO yyyy-mm-dd
  description: string;
  subDescription: string | null;
  reference: string | null;
  debit: number | null;
  credit: number | null;
  balance: number;
  hidden?: boolean; // processing noise — counted in the balance, not displayed
}

export interface LedgerStatement {
  source: "rentec" | "ledger" | "none";
  address: string;
  tenantName: string | null;
  currentBalance: number;
  lines: LedgerLine[];
  fetchedAt: string;
}

type RawLine = Omit<LedgerLine, "balance">;

const pad = (n: number) => String(n).padStart(2, "0");

/** Sort oldest→newest, accumulate balance, then return newest-first for display. */
function withRunningBalance(raw: RawLine[]): LedgerLine[] {
  const order = raw
    .map((l, i) => ({ l, i }))
    .sort((a, b) => {
      const ta = Date.parse(a.l.date) || 0;
      const tb = Date.parse(b.l.date) || 0;
      if (ta !== tb) return ta - tb;
      // Same day: charges before payments so the balance reads naturally.
      const aCharge = (a.l.debit ?? 0) > 0 ? 0 : 1;
      const bCharge = (b.l.debit ?? 0) > 0 ? 0 : 1;
      if (aCharge !== bCharge) return aCharge - bCharge;
      return a.i - b.i;
    });

  let running = 0;
  const withBal: LedgerLine[] = order.map(({ l }) => {
    running += (l.credit ?? 0) - (l.debit ?? 0);
    return { ...l, balance: Math.round(running * 100) / 100 };
  });
  return withBal.reverse(); // newest first, like Rentec
}

/** Parse a tracker "m/d" date cell into ISO for the given year. */
function parseTrackerDate(cell: string, year: number, month: number): string {
  const m = cell.match(/(\d{1,2})\s*\/\s*(\d{1,2})/);
  if (m && m[1] && m[2]) {
    const mm = parseInt(m[1], 10);
    const dd = parseInt(m[2], 10);
    // A 12/xx date in an early-year column is a prior-year prepayment.
    const yr = mm > month + 1 ? year - 1 : year;
    return `${yr}-${pad(mm)}-${pad(dd)}`;
  }
  return `${year}-${pad(month)}-28`;
}

function buildLinesFromHistory(hist: LedgerHistory, year: number): RawLine[] {
  const now = new Date();
  const upTo = year === now.getFullYear() ? now.getMonth() + 1 : 12;
  const monthName = (m: number) =>
    new Date(year, m - 1, 1).toLocaleString("en-US", { month: "long" });

  const lines: RawLine[] = [];
  for (const mo of hist.months) {
    if (mo.month > upTo) break;
    lines.push({
      date: `${year}-${pad(mo.month)}-01`,
      description: "Rent charge",
      subDescription: `${monthName(mo.month)} rent`,
      reference: null,
      debit: mo.rent,
      credit: null,
    });
    if (mo.paid > 0) {
      lines.push({
        date: parseTrackerDate(mo.date, year, mo.month),
        description: "Payment received",
        subDescription: null,
        reference: null,
        debit: null,
        credit: mo.paid,
      });
    }
  }
  return lines;
}

export async function getPropertyLedger(
  address: string,
  tenantName: string | null,
  year: number = new Date().getFullYear(),
): Promise<LedgerStatement> {
  const now = new Date().toISOString();

  // 1. Live Rentec statement — the TENANT's ledger (rent invoices + late fees +
  //    payments), which is what Rentec's own statement shows. The per-property
  //    query only returns bank deposits (payments), so we resolve the property's
  //    current resident and pull their ledger by renter_id instead.
  if (rentec.hasApiKey()) {
    try {
      const propertyId = await rentec.findRentecPropertyIdByAddress(address);
      const renterId = propertyId
        ? await rentec.getCurrentRenterIdForProperty(propertyId)
        : null;
      if (renterId) {
        const { lines: raw, endingBalance } = await rentec.getTenantLedger(renterId);
        if (raw.length > 0) {
          // Running balance accounts for EVERY transaction (incl. processing
          // noise) so it ties out to Rentec's real balance; only the displayed
          // rows are filtered, leaving a clean charges-and-payments statement.
          const all = withRunningBalance(raw.map((l) => ({ ...l })));
          const lines = all.filter((l) => !l.hidden);
          // Prefer Rentec's authoritative ending balance (negative = owes);
          // fall back to our computed running total.
          const currentBalance = endingBalance ?? all[0]?.balance ?? 0;
          return {
            source: "rentec",
            address,
            tenantName,
            currentBalance,
            lines,
            fetchedAt: now,
          };
        }
      }
    } catch {
      /* fall through to the sheet */
    }
  }

  // 2. Master Ledger fallback.
  const hist = await getTrackerHistoryForAddress(address);
  if (hist) {
    const lines = withRunningBalance(buildLinesFromHistory(hist, year));
    return {
      source: "ledger",
      address,
      tenantName: tenantName ?? hist.tenant,
      currentBalance: lines[0]?.balance ?? 0,
      lines,
      fetchedAt: now,
    };
  }

  return { source: "none", address, tenantName, currentBalance: 0, lines: [], fetchedAt: now };
}
