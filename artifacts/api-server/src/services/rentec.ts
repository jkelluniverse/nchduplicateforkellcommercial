/**
 * Rentec Direct API client for Kell Commercial Leasing (read-only).
 *
 * This app is READ-ONLY against Rentec — it never POSTs/PUTs/writes anything
 * back. It connects ONLY to the Kell Commercial / Dad's-portfolio Rentec
 * account (its own RENTEC_API_KEY) and never to NCH's data.
 *
 * Rentec essentials (per the integration spec):
 *   - Base https://secure.rentecdirect.com/api/v3
 *   - Auth header:  X-API-Key: <RENTEC_API_KEY>   (read-only permissions)
 *   - Rate limit 60 req/min — we throttle to ~1 req/sec and back off on HTTP 429.
 *   - Amount owed / past-due come from Tenant.balance and Lease.balance, which
 *     Rentec computes. `Property` has NO balance field — never sum transactions
 *     to derive what's owed.
 *   - /transactions takes EXACTLY ONE filter id (property_id OR renter_id, never
 *     both -> 400). Paginated 300/page; the LAST page's summary.ending_balance
 *     is the running ledger balance.
 *   - Sync order: /ping -> /accounts (cache) -> /properties?include_subunits=true
 *     -> /tenants -> /leases -> per-property /transactions for line items.
 *
 * This module exposes the SAME public surface the rest of the app already
 * consumed from the previous property-management client, so the routes,
 * directory sync, and rent-status aggregator did not have to change shape.
 * The normalized domain types keep their original (PM-agnostic) names.
 *
 * The client never throws — every public function returns null/[] on failure
 * so callers fall back to local data instead of leaking a 500 to the UI.
 *
 * NOTE: Rentec's exact JSON field names can vary by account/version. Field
 * access below is defensive (checks several likely keys). If a live probe with
 * a real key shows different names, adjust the small mapping helpers — the
 * public shapes returned to the app must stay the same.
 */
import { logger } from "../lib/logger";

const BASE_URL =
  process.env["RENTEC_API_BASE"] || "https://secure.rentecdirect.com/api/v3";
const CACHE_TTL_MS = 5 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 15_000;
const MIN_REQUEST_GAP_MS = 1_050; // ~1 req/sec keeps us under 60/min.
const MAX_PAGES = 50;
const PAGE_SIZE = 300; // Rentec /transactions pages at 300/page.

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}
const cache = new Map<string, CacheEntry<unknown>>();

function apiKey(): string | null {
  const k = process.env["RENTEC_API_KEY"];
  return k && k.length > 0 ? k : null;
}

/** Back-compat alias used across the app to gate live calls. */
export function hasToken(): boolean {
  return apiKey() !== null;
}
export function hasApiKey(): boolean {
  return apiKey() !== null;
}

export function clearCache(): void {
  cache.clear();
}

// ─── Throttled, backing-off fetch ───────────────────────────────────
let lastRequestAt = 0;
async function throttle(): Promise<void> {
  const now = Date.now();
  const wait = lastRequestAt + MIN_REQUEST_GAP_MS - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

interface ListResponse<T> {
  data?: T[];
  results?: T[];
  summary?: { ending_balance?: number; [k: string]: unknown };
  total?: number;
  [k: string]: unknown;
}

/** Single GET with timeout + one 429 backoff retry. Returns parsed JSON or null. */
async function rcGet<T>(path: string, attempt = 0): Promise<T | null> {
  const key = apiKey();
  if (!key) return null;
  await throttle();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE_URL}${path}`, {
      method: "GET",
      headers: { "X-API-Key": key, Accept: "application/json" },
      signal: ctl.signal,
    });
    if (res.status === 429 && attempt < 4) {
      const backoff = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s, 8s
      logger.warn({ path, backoff }, "Rentec 429 — backing off");
      await new Promise((r) => setTimeout(r, backoff));
      return rcGet<T>(path, attempt + 1);
    }
    if (!res.ok) {
      logger.warn({ path, status: res.status }, "Rentec request failed");
      return null;
    }
    const ctype = res.headers.get("content-type") ?? "";
    if (!ctype.includes("application/json")) {
      logger.warn({ path, ctype }, "Rentec returned non-JSON");
      return null;
    }
    return (await res.json()) as T;
  } catch (err) {
    logger.error({ err, path }, "Rentec request error");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function rowsOf<T>(body: ListResponse<T> | null): T[] {
  if (!body) return [];
  if (Array.isArray(body.data)) return body.data;
  if (Array.isArray(body.results)) return body.results;
  return [];
}

/** Paginated list helper (cached). */
async function rcList<T>(basePath: string): Promise<T[]> {
  const cached = cache.get(basePath);
  if (cached && cached.expiresAt > Date.now()) return cached.value as T[];
  const all: T[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const sep = basePath.includes("?") ? "&" : "?";
    const url = `${basePath}${sep}page=${page}&limit=${PAGE_SIZE}`;
    const body = await rcGet<ListResponse<T>>(url);
    const rows = rowsOf(body);
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  cache.set(basePath, { value: all, expiresAt: Date.now() + CACHE_TTL_MS });
  return all;
}

function num(...vals: unknown[]): number {
  for (const v of vals) {
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)))
      return Number(v);
  }
  return 0;
}
function str(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === "string" && v.trim() !== "") return v;
    if (typeof v === "number") return String(v);
  }
  return undefined;
}

// ─── Public domain types (PM-agnostic; same shapes the app already used) ──

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

export interface DLTenantPhone {
  type?: string;
  number?: string;
}
export interface DLTenantEmail {
  type?: string;
  address?: string;
}
export interface DLTenant {
  id: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  e164PhoneMobileNumber?: string;
  phones?: DLTenantPhone[];
  emails?: DLTenantEmail[];
  type?: string; // normalized to "LEASE_TENANT" for active residents
  createdAt?: string;
  balance?: number;
  leaseId?: string;
  propertyId?: string;
  unitId?: string;
  prospectInfo?: {
    status?: string;
    interests?: Array<{ property?: string; unit?: string }>;
  };
}

// ─── Raw Rentec shapes (loose; field names checked defensively) ─────
type RawObj = Record<string, unknown>;

function pick(o: RawObj, ...keys: string[]): unknown {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null) return o[k];
  return undefined;
}

function mapProperty(p: RawObj): DLProperty {
  return {
    id: String(pick(p, "id", "property_id", "propertyID") ?? ""),
    name: str(pick(p, "name", "property_name", "shortName")),
    address: {
      street1: str(pick(p, "address", "street", "address1", "street1")),
      street2: str(pick(p, "address2", "street2")),
      city: str(pick(p, "city")),
      state: str(pick(p, "state")),
      zip: str(pick(p, "zip", "zipcode", "postal_code")),
    },
    class: str(pick(p, "type", "class", "property_type")),
  };
}

function mapUnit(u: RawObj, parentPropertyId?: string): DLUnit {
  return {
    id: String(pick(u, "id", "unit_id", "subunit_id") ?? ""),
    name: str(pick(u, "name", "unit", "unit_name", "number")),
    property: String(
      pick(u, "property_id", "parent_id", "propertyID") ?? parentPropertyId ?? "",
    ),
    beds: typeof pick(u, "bedrooms", "beds") === "number"
      ? (pick(u, "bedrooms", "beds") as number)
      : undefined,
    baths: typeof pick(u, "bathrooms", "baths") === "number"
      ? (pick(u, "bathrooms", "baths") as number)
      : undefined,
    marketRent: num(pick(u, "market_rent", "rent", "marketRent")),
    active: pick(u, "active", "is_active") !== false,
  };
}

function mapTenant(t: RawObj): DLTenant {
  const first = str(pick(t, "firstName", "first_name", "first"));
  const last = str(pick(t, "lastName", "last_name", "last"));
  const full =
    str(pick(t, "fullName", "name", "full_name")) ||
    [first, last].filter(Boolean).join(" ") ||
    undefined;
  const phone = str(pick(t, "phone", "mobile", "cell", "phone_number"));
  const email = str(pick(t, "email", "email_address"));
  return {
    id: String(pick(t, "id", "tenant_id", "renter_id", "renterID") ?? ""),
    fullName: full,
    firstName: first,
    lastName: last,
    e164PhoneMobileNumber: phone,
    phones: phone ? [{ type: "mobile", number: phone }] : [],
    emails: email ? [{ type: "primary", address: email }] : [],
    // Rentec returns real residents; treat them all as LEASE_TENANT so the
    // shared current-resident helpers keep them.
    type: "LEASE_TENANT",
    createdAt: str(pick(t, "created", "createdAt", "date_created", "move_in")),
    balance: num(pick(t, "balance", "tenant_balance")),
    leaseId: str(pick(t, "lease_id", "leaseID", "lease")),
    propertyId: str(pick(t, "property_id", "propertyID", "property")),
    unitId: str(pick(t, "unit_id", "unitID", "unit")),
  };
}

function mapLease(l: RawObj): DLLease {
  const balance = num(pick(l, "balance", "lease_balance", "current_balance"));
  const pastDue = num(pick(l, "past_due", "overdue", "overdue_balance", "amount_past_due"));
  const unitId = str(pick(l, "unit_id", "unitID", "unit"));
  const rawStatus = String(pick(l, "status", "lease_status") ?? "active").toLowerCase();
  return {
    id: String(pick(l, "id", "lease_id", "leaseID") ?? ""),
    name: str(pick(l, "name", "tenant_name", "tenants", "title")),
    property: String(pick(l, "property_id", "propertyID", "property") ?? ""),
    units: unitId ? [unitId] : [],
    // Normalize Rentec's status to the "ACTIVE" sentinel the aggregator checks.
    status: rawStatus.startsWith("active") || rawStatus === "current" ? "ACTIVE" : rawStatus.toUpperCase(),
    start: str(pick(l, "start", "start_date", "lease_start", "move_in")),
    end: str(pick(l, "end", "end_date", "lease_end", "move_out")),
    totalRecurringRent: num(pick(l, "rent", "monthly_rent", "rent_amount", "amount")),
    // Rentec's lease balance IS the authoritative amount owed.
    outstandingBalance: balance,
    currentBalance: balance,
    // If Rentec exposes a dedicated past-due figure use it; otherwise the whole
    // balance is treated as owed and the aggregator ages it from the cycle.
    overdueBalance: pastDue > 0 ? pastDue : balance,
    lastLateFeesProcessedDate: str(pick(l, "last_late_fee", "lastLateFeesProcessedDate")),
  };
}

// ─── Public fetchers (cached) ───────────────────────────────────────

/** /ping — connection health. */
export async function ping(): Promise<boolean> {
  const body = await rcGet<RawObj>("/ping");
  return body !== null;
}

/** /accounts — cached GL/bank accounts (used to interpret transactions). */
export async function getAccounts(): Promise<RawObj[]> {
  return rcList<RawObj>("/accounts");
}

export async function getProperties(): Promise<DLProperty[]> {
  const raw = await rcList<RawObj>("/properties?include_subunits=true");
  return raw.map(mapProperty);
}

/**
 * Units come from each property's sub-units (include_subunits=true). Rentec
 * commercial buildings (e.g. the Kell Building) are one property with many
 * sub-units, which we surface as units here.
 */
export async function getUnits(): Promise<DLUnit[]> {
  const raw = await rcList<RawObj>("/properties?include_subunits=true");
  const units: DLUnit[] = [];
  for (const p of raw) {
    const pid = String(pick(p, "id", "property_id") ?? "");
    const subs = pick(p, "subunits", "sub_units", "units");
    if (Array.isArray(subs)) {
      for (const s of subs) units.push(mapUnit(s as RawObj, pid));
    } else {
      // Single-unit property — model the property itself as one unit.
      units.push({ id: pid, name: str(pick(p, "name")) ?? pid, property: pid, active: true });
    }
  }
  return units;
}

export async function getTenants(): Promise<DLTenant[]> {
  const raw = await rcList<RawObj>("/tenants");
  const tenants = raw.map(mapTenant);
  // Build the (property::unit) interest links the shared resident-selection
  // helpers expect, from each tenant's own property/unit/lease association.
  for (const t of tenants) {
    if (t.propertyId && t.unitId) {
      t.prospectInfo = { interests: [{ property: t.propertyId, unit: t.unitId }] };
    }
  }
  return tenants;
}

export async function getLeases(): Promise<DLLease[]> {
  const raw = await rcList<RawObj>("/leases");
  return raw.map(mapLease);
}

/**
 * Transactions for ONE filter id only (property_id OR renter_id — never both,
 * Rentec returns 400 if both are sent). Paginated 300/page.
 */
export async function getTransactionsForProperty(propertyId: string): Promise<RawObj[]> {
  return rcList<RawObj>(`/transactions?property_id=${encodeURIComponent(propertyId)}`);
}
export async function getTransactionsForTenant(renterId: string): Promise<RawObj[]> {
  return rcList<RawObj>(`/transactions?renter_id=${encodeURIComponent(renterId)}`);
}

/** Running ledger balance = last page's summary.ending_balance for a property. */
export async function getEndingBalanceForProperty(propertyId: string): Promise<number | null> {
  let lastSummary: ListResponse<RawObj>["summary"] | undefined;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await rcGet<ListResponse<RawObj>>(
      `/transactions?property_id=${encodeURIComponent(propertyId)}&page=${page}&limit=${PAGE_SIZE}`,
    );
    const rows = rowsOf(body);
    if (body?.summary) lastSummary = body.summary;
    if (rows.length < PAGE_SIZE) break;
  }
  return typeof lastSummary?.ending_balance === "number" ? lastSummary.ending_balance : null;
}

// ─── Current-resident selection helpers (shared, PM-agnostic) ───────

function leaseNameIncludes(leaseName: string, token: string): boolean {
  const t = token.trim();
  if (!t || !leaseName) return false;
  const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|\\W)${escaped}(\\W|$)`, "i").test(leaseName);
}

export function tenantMatchesLeaseName(t: DLTenant, leaseName: string): boolean {
  const full = (t.fullName ?? "").trim();
  const first = (t.firstName ?? "").trim();
  const last = (t.lastName ?? "").trim();
  if (full && leaseNameIncludes(leaseName, full)) return true;
  if (first && last && leaseNameIncludes(leaseName, `${first} ${last}`)) return true;
  if (first && last && leaseNameIncludes(leaseName, first) && leaseNameIncludes(leaseName, last))
    return true;
  return false;
}

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
  const freshest = [...candidates].sort((a, b) => {
    const aT = a.createdAt ? new Date(a.createdAt).getTime() : 0;
    const bT = b.createdAt ? new Date(b.createdAt).getTime() : 0;
    return bT - aT;
  });
  return freshest.slice(0, 1);
}

export function selectPrimaryLeaseTenant(
  lease: DLLease,
  tenantsByPropertyUnit: Map<string, DLTenant[]>,
): DLTenant | null {
  return selectCurrentLeaseTenants(lease, tenantsByPropertyUnit)[0] ?? null;
}

export function formatPropertyAddress(p: DLProperty): string {
  const a = p.address ?? {};
  const street = [a.street1, a.street2].filter(Boolean).join(" ");
  const tail = [a.city, a.state, a.zip]
    .filter(Boolean)
    .join(", ")
    .replace(/, ([A-Z]{2}), /, ", $1 ");
  return [street, tail].filter(Boolean).join(", ") || p.name || p.id;
}

// ─── Aggregated rent-status for the dashboard ───────────────────────

export interface DLRentRow {
  leaseId: string;
  propertyDoorloopId: string; // kept name for output-shape compatibility
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

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * Build a per-lease rent-status snapshot for the given month from live Rentec
 * data. Returns null when Rentec is unreachable so the caller can fall back to
 * the local rent_status table.
 *
 * Rentec computes balances for us, so amount-owed/past-due come straight from
 * Lease.balance — we never sum transactions to derive what's owed.
 */
export async function getRentStatus(
  month: number,
  year: number,
): Promise<DLRentStatus | null> {
  if (!hasApiKey()) return null;

  const [leases, properties, units, tenants] = await Promise.all([
    getLeases(),
    getProperties(),
    getUnits(),
    getTenants(),
  ]);

  if (leases.length === 0 && properties.length === 0) return null;

  const propById = new Map(properties.map((p) => [p.id, p]));
  void units;
  const tenantByPropertyUnit = buildLeaseTenantLookup(tenants);
  const tenantById = new Map(tenants.map((t) => [t.id, t]));

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
    const address = prop ? formatPropertyAddress(prop) : lease.name ?? lease.id;

    let tenantName: string | null = null;
    const t = selectPrimaryLeaseTenant(lease, tenantByPropertyUnit);
    if (t) {
      tenantName = t.fullName ?? ([t.firstName, t.lastName].filter(Boolean).join(" ") || null);
    }
    if (!tenantName) {
      // Fall back to any tenant directly associated with this lease.
      const direct = tenants.find((x) => x.leaseId && x.leaseId === lease.id);
      tenantName = direct?.fullName ?? lease.name ?? null;
    }
    void tenantById;

    const monthlyRent = lease.totalRecurringRent ?? 0;
    const outstanding = lease.outstandingBalance ?? 0; // Rentec lease balance
    const overdue = lease.overdueBalance ?? 0;
    const owesNothing = outstanding <= 0;

    const startMatch = lease.start?.match(/^(\d{4})-(\d{2})/);
    const startedThisMonthOrLater = startMatch
      ? (() => {
          const sy = parseInt(startMatch[1], 10);
          const sm = parseInt(startMatch[2], 10);
          return sy > year || (sy === year && sm >= month);
        })()
      : false;

    let status: DLRentRow["status"];
    let daysOverdue = 0;

    if (startedThisMonthOrLater) {
      status = "unpaid";
      daysOverdue = 0;
    } else if (owesNothing) {
      // Rentec says nothing is owed (incl. prepaid/credit) — current.
      status = "paid";
      daysOverdue = 0;
    } else if (!isCurrentMonth) {
      status = "delinquent";
      daysOverdue = DELINQUENT_DAYS;
    } else if (overdue > 0) {
      // Age the past-due balance from the oldest unpaid cycle.
      const monthsOverdue = monthlyRent > 0 ? Math.max(1, Math.round(overdue / monthlyRent)) : 1;
      const missedSince = new Date(year, month - 1 - (monthsOverdue - 1), 1);
      daysOverdue = Math.max(
        0,
        Math.floor((Date.now() - missedSince.getTime()) / (24 * 60 * 60 * 1000)),
      );
      status = daysOverdue >= DELINQUENT_DAYS ? "delinquent" : "unpaid";
    } else {
      status = "unpaid";
      daysOverdue = daysSinceFirst;
    }

    // amountPaid this month = max(0, monthlyRent - outstanding) is misleading
    // when back-balances exist; report 0 when owing and rent when current.
    const amountPaid = owesNothing ? monthlyRent : Math.max(0, monthlyRent - outstanding);

    rows.push({
      leaseId: lease.id,
      propertyDoorloopId: lease.property,
      address,
      tenantName,
      monthlyRent,
      amountPaid: round2(amountPaid),
      lateFeeDue: 0,
      lateFeePaid: 0,
      paymentDate: null,
      status,
      daysOverdue,
    });
  }

  return {
    month,
    year,
    rows,
    uniquePropertyCount: uniqueProps.size,
    fetchedAt: new Date().toISOString(),
  };
}

/**
 * All payments ever recorded for a lease — used by tenant-note auto-resolution.
 * Rentec filters transactions by renter_id; we resolve the lease's tenant first.
 */
export async function getPaymentsForLease(leaseId: string): Promise<Array<{ id: string; date: string; lease: string; amountReceived: number }>> {
  const tenants = await getTenants();
  const tenant = tenants.find((t) => t.leaseId === leaseId);
  if (!tenant) return [];
  const txns = await getTransactionsForTenant(tenant.id);
  return txns
    .filter((tx) => {
      const type = String((tx as RawObj)["type"] ?? "").toLowerCase();
      return type.includes("payment") || type.includes("credit");
    })
    .map((tx) => {
      const o = tx as RawObj;
      return {
        id: String(pick(o, "id", "transaction_id") ?? ""),
        date: str(pick(o, "date", "transaction_date")) ?? "",
        lease: leaseId,
        amountReceived: num(pick(o, "amount", "credit", "payment")),
      };
    });
}
