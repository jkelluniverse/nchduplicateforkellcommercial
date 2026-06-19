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
import { ne } from "drizzle-orm";
import { db, propertiesTable, tenantPaymentNotesTable } from "@workspace/db";
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

// ─── Ledger LIST (sortable/filterable property roster) ──────────────────────
//
// Mirrors NCH's `getLedgerProperties`: one enriched row per directory property,
// carrying the Rentec-derived account state the Ledger list sorts and filters
// on. The row `id` stays the Postgres directory id so the existing
// `/api/properties/:id/ledger` statement click-through is unchanged.
//
// Rentec adaptation: Rentec's API exposes neither a per-property last-payment
// date nor a reversed/returned-payment feed without an extra, rate-limited
// transaction scan per property, so those two NCH columns are intentionally
// omitted here (and from the Ledger filter bar). Everything below comes from
// data the dashboard already trusts: live lease balances + the same rent-status
// aging used on the home screen.

export type LedgerListStatus = "paid" | "current" | "past_due" | "expected";

export interface LedgerPropertyRow {
  id: number; // Postgres directory id — opens the per-property statement
  address: string;
  resident1Name: string | null;
  resident2Name: string | null;
  currentBalance: number; // negative = owes, positive = credit on account
  pastDue: number; // amount past due (positive)
  status: LedgerListStatus;
  daysLate: number; // 0 when not overdue (Rentec rent-status aging)
  hasSituation: boolean; // an open Payment Situation exists for this address
  // For an "expected" row: ISO date this month's rent is due (custom due day).
  // The tenant owes it but the due day hasn't arrived — an expected incoming
  // payment, not a past-due balance. Null for every other status.
  expectedDate: string | null;
}

const DELINQUENT_DAYS = 30; // 30+ days past due → past_due (matches rent cycle)

/** Street portion of an address, normalized for matching directory↔Rentec. */
function streetKey(address: string): string {
  return (address.split(",")[0] ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

export async function getLedgerList(q?: string): Promise<LedgerPropertyRow[]> {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  // Directory properties (the click-through ids) + open situations, always.
  const [dirProps, openNotes] = await Promise.all([
    db.select().from(propertiesTable).orderBy(propertiesTable.address),
    db
      .select({ address: tenantPaymentNotesTable.propertyAddress })
      .from(tenantPaymentNotesTable)
      .where(ne(tenantPaymentNotesTable.status, "resolved")),
  ]);
  const situationKeys = new Set(openNotes.map((n) => streetKey(n.address)));

  // Live Rentec state, keyed by street so it joins to directory addresses.
  // outstanding/overdue come from authoritative lease balances; status + aging
  // come from the same rent-status pathway the dashboard uses.
  const balByKey = new Map<string, { outstanding: number; overdue: number }>();
  const ageByKey = new Map<
    string,
    { owes: boolean; daysLate: number; upcoming: boolean; expectedDate: string | null }
  >();

  if (rentec.hasApiKey()) {
    try {
      const [props, leases, status] = await Promise.all([
        rentec.getProperties(),
        rentec.getLeases(),
        rentec.getRentStatus(month, year),
      ]);
      const addrByPropId = new Map(props.map((p) => [p.id, rentec.formatPropertyAddress(p)]));

      for (const l of leases) {
        if (l.status && l.status !== "ACTIVE") continue;
        const addr = addrByPropId.get(l.property);
        if (!addr) continue;
        const k = streetKey(addr);
        const agg = balByKey.get(k) ?? { outstanding: 0, overdue: 0 };
        agg.outstanding += l.outstandingBalance ?? 0;
        agg.overdue += Math.max(0, l.overdueBalance ?? 0);
        balByKey.set(k, agg);
      }

      for (const row of status?.rows ?? []) {
        const k = streetKey(row.address);
        const prev =
          ageByKey.get(k) ?? { owes: false, daysLate: 0, upcoming: false, expectedDate: null };
        if (row.status === "upcoming") {
          // Owes this month but not due yet — expected, not past-due.
          prev.upcoming = true;
          if (!prev.expectedDate && row.expectedDate) prev.expectedDate = row.expectedDate;
        } else {
          prev.owes = prev.owes || row.status !== "paid";
          prev.daysLate = Math.max(prev.daysLate, row.daysOverdue);
        }
        ageByKey.set(k, prev);
      }
    } catch {
      /* Rentec unreachable — fall through with directory-only rows. */
    }
  }

  const round2 = (n: number) => Math.round(n * 100) / 100;

  const rows: LedgerPropertyRow[] = dirProps.map((p) => {
    const k = streetKey(p.address);
    const bal = balByKey.get(k);
    const age = ageByKey.get(k);
    const outstanding = bal?.outstanding ?? 0;
    const overdue = bal?.overdue ?? 0;
    const owes = age ? age.owes : outstanding < -0.005;
    // Expected = owes only the not-yet-due current month (and nothing past due).
    const isExpected = !owes && (age?.upcoming ?? false);
    const daysLate = owes ? age?.daysLate ?? 0 : 0;
    const status: LedgerListStatus = isExpected
      ? "expected"
      : !owes
        ? "paid"
        : daysLate >= DELINQUENT_DAYS || overdue > 0.005
          ? "past_due"
          : "current";
    return {
      id: p.id,
      address: p.address,
      resident1Name: p.resident1Name,
      resident2Name: p.resident2Name,
      currentBalance: round2(outstanding),
      pastDue: round2(Math.max(0, overdue)),
      status,
      daysLate,
      hasSituation: situationKeys.has(k),
      expectedDate: isExpected ? age?.expectedDate ?? null : null,
    };
  });

  const query = q?.trim().toLowerCase();
  if (query) {
    return rows.filter(
      (r) =>
        r.address.toLowerCase().includes(query) ||
        (r.resident1Name && r.resident1Name.toLowerCase().includes(query)) ||
        (r.resident2Name && r.resident2Name.toLowerCase().includes(query)),
    );
  }
  return rows;
}
