/**
 * DoorLoop API client for Nice City Homes (Canton OH portfolio).
 *
 * Confirmed working endpoints under https://app.doorloop.com/api (NO /v1):
 *   /properties, /units, /leases, /tenants, /lease-charges, /lease-payments,
 *   /owners, /auth/me
 *
 * Notes from the live probe (May 2026 portfolio):
 *   - 33 properties, 34 leases (one property = duplex with 2 leases)
 *   - 50 tenants, monthly rent charges posted on the 1st
 *   - Late-fee charges are posted by DoorLoop on the 11th. We detect them by
 *     scanning charge.lines[].memo against /late.*fee/i because there is no
 *     dedicated late-fee endpoint.
 *
 * The client never throws — every public function returns null/empty on
 * failure so the caller can fall back to local data without a 500 leaking
 * through to the UI.
 */
import { logger } from "../lib/logger";

const BASE_URL = "https://app.doorloop.com/api";
const CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_PAGES = 25;
const PAGE_SIZE = 100;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();

function token(): string | null {
  const t = process.env["DOORLOOP_API_TOKEN"];
  return t && t.length > 0 ? t : null;
}

export function hasToken(): boolean {
  return token() !== null;
}

export function clearCache(): void {
  cache.clear();
}

interface ListResponse<T> {
  data: T[];
  total?: number;
}

async function dlGet<T>(path: string): Promise<T | null> {
  const t = token();
  if (!t) return null;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      headers: { Authorization: `Bearer ${t}`, Accept: "application/json" },
      signal: ctl.signal,
    });
    if (!res.ok) {
      logger.warn({ path, status: res.status }, "DoorLoop request failed");
      return null;
    }
    const ctype = res.headers.get("content-type") ?? "";
    if (!ctype.includes("application/json")) {
      logger.warn({ path, ctype }, "DoorLoop returned non-JSON");
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    logger.error({ err, path }, "DoorLoop request error");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function dlList<T>(basePath: string): Promise<T[]> {
  const cached = cache.get(basePath);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value as T[];
  }
  const all: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const sep = basePath.includes("?") ? "&" : "?";
    const url = `${basePath}${sep}page_number=${page}&page_size=${PAGE_SIZE}`;
    const body = await dlGet<ListResponse<T>>(url);
    if (!body || !Array.isArray(body.data)) break;
    all.push(...body.data);
    if (body.data.length < PAGE_SIZE) break;
  }
  cache.set(basePath, { value: all, expiresAt: Date.now() + CACHE_TTL_MS });
  return all;
}

// ─── Public domain types ────────────────────────────────────────────

export interface DLProperty {
  id: string;
  name?: string;
  address?: {
    street1?: string;
    street2?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
  class?: string;
}

export interface DLUnit {
  id: string;
  name?: string;
  property: string;
  beds?: number;
  baths?: number;
  marketRent?: number;
  active?: boolean;
}

export interface DLLease {
  id: string;
  name?: string;
  property: string;
  units: string[];
  status?: string;
  start?: string;
  end?: string;
  totalRecurringRent?: number;
  outstandingBalance?: number;
  currentBalance?: number;
  overdueBalance?: number;
  lastLateFeesProcessedDate?: string;
}

export interface DLTenantPhone { type?: string; number?: string }
export interface DLTenantEmail { type?: string; address?: string }
export interface DLTenant {
  id: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  e164PhoneMobileNumber?: string;
  phones?: DLTenantPhone[];
  emails?: DLTenantEmail[];
  type?: string; // "LEASE_TENANT" | "PROSPECT_TENANT" | etc.
  createdAt?: string;
  prospectInfo?: {
    status?: string;
    interests?: Array<{ property?: string; unit?: string }>;
  };
}

export interface DLChargeLine {
  id: string;
  amount: number;
  balance: number;
  memo?: string;
  account?: string;
}
export interface DLCharge {
  id: string;
  date: string;
  lease: string;
  totalAmount: number;
  totalBalance: number;
  lines: DLChargeLine[];
}

export interface DLPaymentLinkedCharge {
  amount: number;
  linkedTransaction: string;
  linkedTransactionLine?: string;
}
export interface DLPayment {
  id: string;
  date: string;
  lease: string;
  receivedFromTenant?: string;
  amountReceived: number;
  amountAppliedToCharges?: number;
  paymentMethod?: string;
  linkedCharges?: DLPaymentLinkedCharge[];
}

// ─── Public fetchers (all cached) ───────────────────────────────────

export function getProperties(): Promise<DLProperty[]> {
  return dlList<DLProperty>("/properties");
}

export function getUnits(): Promise<DLUnit[]> {
  return dlList<DLUnit>("/units");
}

export function getLeases(): Promise<DLLease[]> {
  return dlList<DLLease>("/leases");
}

export function getTenants(): Promise<DLTenant[]> {
  return dlList<DLTenant>("/tenants");
}

// ---------------------------------------------------------------------------
// Shared tenant-selection helpers.
//
// DIRECTORY DATA SOURCE: DoorLoop ONLY. DoorLoop tenants link to a
// property+unit via `prospectInfo.interests`, NOT to a specific lease, and
// that link is never expired — so a unit accumulates every tenant who ever
// leased or inquired about it. To find the CURRENT resident(s) we must:
//   1. Keep only LEASE_TENANT records (PROSPECT_TENANT = listing-site inquiries
//      that never moved in).
//   2. Match candidate tenants against the lease's `name`, which DoorLoop sets
//      to the current tenant(s) (e.g. "Debra Riley & Linda Rogers"). Prior
//      tenants are not in the name, so this cleanly separates current
//      co-tenants (even when added months apart) from ended-lease tenants.
//   3. Fall back to the single most-recently-created tenant only when the
//      lease name matches no candidate (rare — lease names are near-always set).
//
// These helpers are the single source of truth reused by directory-sync,
// rent-status, and the docs picker so all three agree.
// ---------------------------------------------------------------------------

/** Word-boundary-safe substring test (so "Li" doesn't match "Linda", etc.). */
function leaseNameIncludes(leaseName: string, token: string): boolean {
  const t = token.trim();
  if (!t || !leaseName) return false;
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\W)${escaped}(\\W|$)`, "i").test(leaseName);
}

/** True when a tenant's name appears in the lease name. */
export function tenantMatchesLeaseName(t: DLTenant, leaseName: string): boolean {
  const full = (t.fullName ?? "").trim();
  const first = (t.firstName ?? "").trim();
  const last = (t.lastName ?? "").trim();
  if (full && leaseNameIncludes(leaseName, full)) return true;
  if (first && last && leaseNameIncludes(leaseName, `${first} ${last}`)) return true;
  if (first && last && leaseNameIncludes(leaseName, first) && leaseNameIncludes(leaseName, last)) return true;
  return false;
}

/** Earliest character position of a tenant's name within the lease name. */
function leaseNamePosition(t: DLTenant, leaseName: string): number {
  const lower = leaseName.toLowerCase();
  const candidates = [
    (t.fullName ?? "").trim(),
    [t.firstName, t.lastName].filter(Boolean).join(" ").trim(),
    (t.lastName ?? "").trim(),
    (t.firstName ?? "").trim(),
  ].filter(Boolean);
  let best = Number.MAX_SAFE_INTEGER;
  for (const c of candidates) {
    const idx = lower.indexOf(c.toLowerCase());
    if (idx >= 0 && idx < best) best = idx;
  }
  return best;
}

/**
 * Build a (propertyId::unitId) -> LEASE_TENANT[] lookup. Only real residents
 * (LEASE_TENANT) are included; prospects are skipped.
 */
export function buildLeaseTenantLookup(tenants: DLTenant[]): Map<string, DLTenant[]> {
  const map = new Map<string, DLTenant[]>();
  for (const t of tenants) {
    if (t.type !== "LEASE_TENANT") continue;
    for (const interest of t.prospectInfo?.interests ?? []) {
      if (interest.property && interest.unit) {
        const key = `${interest.property}::${interest.unit}`;
        const arr = map.get(key) ?? [];
        if (!arr.some((x) => x.id === t.id)) arr.push(t);
        map.set(key, arr);
      }
    }
  }
  return map;
}

/**
 * Return the current tenant(s) for a lease, ordered by appearance in the
 * lease name. Falls back to the single most-recently-created candidate when
 * the lease name matches nobody (keeps prior tenants out of the result).
 */
export function selectCurrentLeaseTenants(
  lease: DLLease,
  tenantsByPropertyUnit: Map<string, DLTenant[]>,
): DLTenant[] {
  const candidates: DLTenant[] = [];
  for (const unitId of lease.units ?? []) {
    const key = `${lease.property}::${unitId}`;
    for (const t of tenantsByPropertyUnit.get(key) ?? []) {
      if (!candidates.some((x) => x.id === t.id)) candidates.push(t);
    }
  }
  if (candidates.length === 0) return [];

  const leaseName = lease.name ?? "";
  const matched = candidates.filter((t) => tenantMatchesLeaseName(t, leaseName));
  if (matched.length > 0) {
    matched.sort((a, b) => leaseNamePosition(a, leaseName) - leaseNamePosition(b, leaseName));
    return matched;
  }

  // No name match — return only the freshest candidate so a prior tenant on
  // the same unit can never sneak in as a co-resident.
  const freshest = [...candidates].sort((a, b) => {
    const aT = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bT = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bT - aT;
  });
  return freshest.slice(0, 1);
}

/** Convenience: first/primary current tenant for a lease, or null. */
export function selectPrimaryLeaseTenant(
  lease: DLLease,
  tenantsByPropertyUnit: Map<string, DLTenant[]>,
): DLTenant | null {
  return selectCurrentLeaseTenants(lease, tenantsByPropertyUnit)[0] ?? null;
}

/** Charges (rent + late fees + other) for the given month. */
export async function getCharges(month: number, year: number): Promise<DLCharge[]> {
  const all = await dlList<DLCharge>("/lease-charges");
  return all.filter((c) => isInMonth(c.date, month, year));
}

/** Payments received in the given month. */
export async function getPayments(month: number, year: number): Promise<DLPayment[]> {
  const all = await dlList<DLPayment>("/lease-payments");
  return all.filter((p) => isInMonth(p.date, month, year));
}

/**
 * Late-fee charges for the given month — DoorLoop has no dedicated late-fee
 * endpoint, so we filter charge lines whose memo matches /late.*fee/i.
 * Returns one row per matching charge line with its parent charge id and
 * the lease that owns it.
 */
export async function getLateFees(
  month: number,
  year: number,
): Promise<Array<{ chargeId: string; lineId: string; lease: string; amount: number; balance: number; date: string }>> {
  const charges = await getCharges(month, year);
  const out: Array<{ chargeId: string; lineId: string; lease: string; amount: number; balance: number; date: string }> = [];
  for (const c of charges) {
    for (const line of c.lines ?? []) {
      if (line.memo && /late.*fee/i.test(line.memo)) {
        out.push({
          chargeId: c.id,
          lineId: line.id,
          lease: c.lease,
          amount: line.amount,
          balance: line.balance,
          date: c.date,
        });
      }
    }
  }
  return out;
}

/** All payments ever recorded for a specific lease. Used by tenant-note auto-resolution. */
export async function getPaymentsForLease(leaseId: string): Promise<DLPayment[]> {
  const all = await dlList<DLPayment>("/lease-payments");
  return all.filter((p) => p.lease === leaseId);
}

// ─── Helpers used by the rent-status aggregator ─────────────────────

function isInMonth(iso: string | undefined, month: number, year: number): boolean {
  if (!iso) return false;
  // DoorLoop returns ISO date strings like "2026-05-01" — parse without TZ drift.
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return false;
  return parseInt(m[1], 10) === year && parseInt(m[2], 10) === month;
}

function dayOfMonth(iso: string | undefined): number | null {
  if (!iso) return null;
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? parseInt(m[3], 10) : null;
}

export function formatPropertyAddress(p: DLProperty): string {
  const a = p.address ?? {};
  const street = [a.street1, a.street2].filter(Boolean).join(" ");
  const tail = [a.city, a.state, a.zip].filter(Boolean).join(", ").replace(/, ([A-Z]{2}), /, ", $1 ");
  return [street, tail].filter(Boolean).join(", ") || p.name || p.id;
}

// ─── Aggregated rent-status for the dashboard ───────────────────────

export interface DLRentRow {
  leaseId: string;
  propertyDoorloopId: string;
  address: string;
  tenantName: string | null;
  monthlyRent: number;
  amountPaid: number;
  lateFeeDue: number;
  lateFeePaid: number;
  paymentDate: string | null;
  status: "paid" | "unpaid" | "late" | "delinquent" | "partial";
  daysOverdue: number;
}

export interface DLRentStatus {
  month: number;
  year: number;
  rows: DLRentRow[];
  uniquePropertyCount: number;
  fetchedAt: string;
}

const DELINQUENT_DAYS = 30;

/**
 * Build a per-lease rent status snapshot for the given month from live
 * DoorLoop data. Returns null when DoorLoop is unreachable so the caller
 * can fall back to the local rent_status table.
 *
 * Status logic (per user decision):
 *   - paid:       full rent paid on/before the 1st
 *   - late:       full rent paid after the 1st (still in same month)
 *   - partial:    some payment received but < monthly rent
 *   - unpaid:     no payment, < 30 days past the 1st of billing month
 *   - delinquent: no payment, 30+ days past the 1st of billing month
 */
export async function getRentStatus(
  month: number,
  year: number,
): Promise<DLRentStatus | null> {
  if (!hasToken()) return null;

  const [leases, properties, units, tenants, charges, payments] =
    await Promise.all([
      getLeases(),
      getProperties(),
      getUnits(),
      getTenants(),
      getCharges(month, year),
      getPayments(month, year),
    ]);

  if (leases.length === 0 && properties.length === 0) {
    // We got nothing back — treat as unreachable.
    return null;
  }

  const propById = new Map(properties.map((p) => [p.id, p]));
  const unitById = new Map(units.map((u) => [u.id, u]));

  // Map: leaseId → sum of rent payments and late-fee payments this month,
  // and earliest payment date.
  const paidByLease = new Map<string, { rent: number; lateFee: number; earliestDate: string | null }>();

  // Build a chargeLine lookup so payments can determine if applied to rent vs late fee.
  const chargeLineMemo = new Map<string, string>(); // lineId -> memo
  const chargeLeaseByChargeId = new Map<string, string>(); // chargeId -> leaseId
  for (const c of charges) {
    chargeLeaseByChargeId.set(c.id, c.lease);
    for (const line of c.lines ?? []) {
      chargeLineMemo.set(line.id, line.memo ?? "");
    }
  }

  for (const p of payments) {
    const leaseId = p.lease;
    if (!leaseId) continue;
    let bucket = paidByLease.get(leaseId);
    if (!bucket) {
      bucket = { rent: 0, lateFee: 0, earliestDate: null };
      paidByLease.set(leaseId, bucket);
    }
    if (!bucket.earliestDate || p.date < bucket.earliestDate) {
      bucket.earliestDate = p.date;
    }
    // Distribute applied amount across linked charges by memo.
    const links = p.linkedCharges ?? [];
    if (links.length > 0) {
      for (const link of links) {
        const memo = link.linkedTransactionLine
          ? chargeLineMemo.get(link.linkedTransactionLine) ?? ""
          : "";
        if (memo && /late.*fee/i.test(memo)) {
          bucket.lateFee += link.amount;
        } else {
          bucket.rent += link.amount;
        }
      }
    } else {
      // Unapplied payment — count against rent by default.
      bucket.rent += p.amountReceived ?? 0;
    }
  }

  // Late-fee balances outstanding per lease (sum of unpaid late-fee charge lines).
  const lateFeeDueByLease = new Map<string, number>();
  for (const c of charges) {
    for (const line of c.lines ?? []) {
      if (line.memo && /late.*fee/i.test(line.memo) && line.balance > 0) {
        lateFeeDueByLease.set(c.lease, (lateFeeDueByLease.get(c.lease) ?? 0) + line.balance);
      }
    }
  }

  // Tenant lookup keyed by (property,unit) — DoorLoop tenants don't directly
  // reference their lease, but prospectInfo.interests links to property+unit.
  // Only LEASE_TENANT records (real residents); prospects are skipped by the
  // shared helper.
  const tenantByPropertyUnit = buildLeaseTenantLookup(tenants);

  const now = new Date();
  const isCurrentMonth = now.getMonth() + 1 === month && now.getFullYear() === year;
  const billingStart = new Date(year, month - 1, 1);
  const daysSinceFirst = Math.max(
    0,
    Math.floor((Date.now() - billingStart.getTime()) / (24 * 60 * 60 * 1000)),
  );

  const rows: DLRentRow[] = [];
  const uniqueProps = new Set<string>();

  for (const lease of leases) {
    if (lease.status && lease.status !== "ACTIVE") continue;

    uniqueProps.add(lease.property);

    const prop = propById.get(lease.property);
    const address = prop ? formatPropertyAddress(prop) : (lease.name ?? lease.id);

    // Pick the current tenant by lease.name (not "first interest match"), so
    // prior tenants on the same unit never surface in rent status.
    let tenantName: string | null = null;
    const t = selectPrimaryLeaseTenant(lease, tenantByPropertyUnit);
    if (t) {
      tenantName = t.fullName ?? ([t.firstName, t.lastName].filter(Boolean).join(" ") || null);
    }
    if (!tenantName && lease.name) tenantName = lease.name;

    const monthlyRent = lease.totalRecurringRent ?? 0;
    const paid = paidByLease.get(lease.id) ?? { rent: 0, lateFee: 0, earliestDate: null };
    const lateFeeDue = lateFeeDueByLease.get(lease.id) ?? 0;

    let status: DLRentRow["status"];
    let daysOverdue = 0;

    // DoorLoop balances are the source of truth for what's actually owed:
    //   outstandingBalance — net amount owed after any credits/prepayments
    //   overdueBalance     — portion of that which is past its due date
    // We trust these over reconstructing dues from payment history, because a
    // single DoorLoop payment can be applied to arbitrary back-charges, which
    // makes "did they pay last month?" an unreliable delinquency signal.
    const outstanding = lease.outstandingBalance ?? 0;
    const overdue = lease.overdueBalance ?? 0;
    // Net owes nothing (a credit can offset an overdue balance) → current.
    const owesNothing = outstanding <= 0;

    // A lease that started this month (or later) cannot be delinquent for any
    // prior month — there was no lease then. Parse the ISO date by parts to
    // avoid timezone drift (same approach as isInMonth/dayOfMonth).
    const startMatch = lease.start?.match(/^(\d{4})-(\d{2})/);
    const startedThisMonthOrLater = startMatch
      ? (() => {
          const sy = parseInt(startMatch[1], 10);
          const sm = parseInt(startMatch[2], 10);
          return sy > year || (sy === year && sm >= month);
        })()
      : false;

    if (startedThisMonthOrLater) {
      // The lease did not exist in the viewed month — nothing was chargeable,
      // so it can never be delinquent for this period (current OR historical).
      status = "unpaid";
      daysOverdue = 0;
    } else if (paid.rent >= monthlyRent && monthlyRent > 0) {
      const dom = dayOfMonth(paid.earliestDate ?? undefined);
      // 10-day grace period: paid on or before the 10th → "paid"; after → "late".
      // Missing payment date falls back to paid (we have the money but no
      // reliable date — do NOT misclassify as late).
      if (dom === null) {
        status = "paid";
      } else {
        status = dom <= 10 ? "paid" : "late";
      }
    } else if (!isCurrentMonth) {
      // Historical month: partial payment → "partial", otherwise → "delinquent".
      // (Balances are a live snapshot, so we can't reason about past overdue
      // amounts here — fall back to payment presence for historical rows.)
      status = paid.rent > 0 ? "partial" : "delinquent";
      daysOverdue = paid.rent > 0 ? 0 : DELINQUENT_DAYS;
    } else if (owesNothing) {
      // Current month, nothing net owed per DoorLoop (incl. prepaid/credit):
      // not delinquent. Reflect any partial payment, else just unpaid-so-far.
      status = paid.rent > 0 ? "partial" : "unpaid";
      daysOverdue = 0;
    } else if (overdue > 0) {
      // DoorLoop reports a past-due balance — the authoritative delinquency
      // signal, even if a partial payment landed this month. Estimate how many
      // months of rent it represents to age the delinquency from the OLDEST
      // unpaid month's 1st. ~One month (just the current cycle) is not yet
      // delinquent; a prior missed cycle pushes daysOverdue past 30.
      const monthsOverdue =
        monthlyRent > 0 ? Math.max(1, Math.round(overdue / monthlyRent)) : 1;
      const missedSince = new Date(year, month - 1 - (monthsOverdue - 1), 1);
      daysOverdue = Math.max(
        0,
        Math.floor((Date.now() - missedSince.getTime()) / (24 * 60 * 60 * 1000)),
      );
      if (daysOverdue >= DELINQUENT_DAYS) {
        status = "delinquent";
      } else {
        status = paid.rent > 0 ? "partial" : "unpaid";
      }
    } else {
      // Owes the current month but nothing is past due yet — just hasn't paid
      // (or has paid only partially).
      status = paid.rent > 0 ? "partial" : "unpaid";
      daysOverdue = daysSinceFirst;
    }

    rows.push({
      leaseId: lease.id,
      propertyDoorloopId: lease.property,
      address,
      tenantName,
      monthlyRent,
      amountPaid: round2(paid.rent),
      lateFeeDue: round2(lateFeeDue),
      lateFeePaid: round2(paid.lateFee),
      paymentDate: paid.earliestDate,
      status,
      daysOverdue,
    });
  }

  void unitById; // exported via getUnits if a caller needs it

  return {
    month,
    year,
    rows,
    uniquePropertyCount: uniqueProps.size,
    fetchedAt: new Date().toISOString(),
  };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
