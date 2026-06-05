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

// Rentec's exact auth header isn't documented publicly, so we try the common
// schemes once and remember whichever the account accepts.
const AUTH_SCHEMES: Array<{ name: string; headers: (k: string) => Record<string, string> }> = [
  { name: "bearer", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
  { name: "x-api-key", headers: (k) => ({ "X-API-Key": k }) },
  { name: "apikey-header", headers: (k) => ({ apikey: k }) },
  { name: "authorization-raw", headers: (k) => ({ Authorization: k }) },
];
let workingScheme = -1;

export function workingAuthScheme(): string | null {
  return workingScheme >= 0 ? (AUTH_SCHEMES[workingScheme]?.name ?? null) : null;
}

async function rcFetch(path: string, schemeIdx: number, key: string): Promise<Response> {
  await throttle();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), REQUEST_TIMEOUT_MS);
  try {
    return await fetch(`${BASE_URL}${path}`, {
      method: "GET",
      headers: { ...AUTH_SCHEMES[schemeIdx]!.headers(key), Accept: "application/json" },
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Single GET with auth-scheme detection + 429 backoff. Returns parsed JSON or null. */
async function rcGet<T>(path: string, attempt = 0): Promise<T | null> {
  const key = apiKey();
  if (!key) return null;
  // Once a scheme works, stick with it; otherwise probe all of them.
  const schemes = workingScheme >= 0 ? [workingScheme] : AUTH_SCHEMES.map((_, i) => i);

  for (const idx of schemes) {
    let res: Response;
    try {
      res = await rcFetch(path, idx, key);
    } catch (err) {
      logger.error({ err, path, scheme: AUTH_SCHEMES[idx]!.name }, "Rentec request error");
      continue;
    }
    if (res.status === 429 && attempt < 4) {
      const backoff = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s, 8s
      logger.warn({ path, backoff }, "Rentec 429 — backing off");
      await new Promise((r) => setTimeout(r, backoff));
      return rcGet<T>(path, attempt + 1);
    }
    // Auth rejected — try the next scheme (and forget a previously-cached one).
    if (res.status === 401 || res.status === 403) {
      if (workingScheme >= 0) workingScheme = -1;
      continue;
    }
    if (!res.ok) {
      logger.warn({ path, status: res.status }, "Rentec request failed");
      return null;
    }
    if (workingScheme < 0) {
      workingScheme = idx;
      logger.info({ scheme: AUTH_SCHEMES[idx]!.name }, "Rentec auth scheme accepted");
    }
    const ctype = res.headers.get("content-type") ?? "";
    if (!ctype.includes("application/json")) {
      logger.warn({ path, ctype }, "Rentec returned non-JSON");
      return null;
    }
    return (await res.json()) as T;
  }
  return null;
}

function rowsOf<T>(body: ListResponse<T> | null): T[] {
  if (!body) return [];
  if (Array.isArray(body)) return body as unknown as T[];
  for (const k of ["data", "results", "records", "items", "rows", "properties", "tenants", "leases", "transactions", "payments"]) {
    const v = (body as Record<string, unknown>)[k];
    if (Array.isArray(v)) return v as T[];
  }
  return [];
}

/**
 * Live connection probe for the Settings "Test Rentec connection" button.
 * Tries each auth scheme against /properties and reports raw status + a sample
 * of the body, then (if one works) the record shape for the key endpoints, so
 * the field mappings can be corrected to the account's actual JSON.
 */
export async function diagnose(): Promise<Record<string, unknown>> {
  const key = apiKey();
  const out: Record<string, unknown> = { configured: Boolean(key), base: BASE_URL };
  if (!key) return out;

  const schemeResults: unknown[] = [];
  let okScheme = -1;
  for (let i = 0; i < AUTH_SCHEMES.length; i++) {
    try {
      const res = await rcFetch("/properties?limit=1", i, key);
      const text = await res.text();
      schemeResults.push({
        scheme: AUTH_SCHEMES[i]!.name,
        status: res.status,
        ok: res.ok,
        contentType: res.headers.get("content-type"),
        sample: text.slice(0, 400),
      });
      if (res.ok && okScheme < 0) okScheme = i;
    } catch (err) {
      schemeResults.push({ scheme: AUTH_SCHEMES[i]!.name, error: String((err as Error)?.message ?? err) });
    }
  }
  out["schemes"] = schemeResults;

  if (okScheme >= 0) {
    workingScheme = okScheme;
    out["workingScheme"] = AUTH_SCHEMES[okScheme]!.name;
    const probes: Record<string, unknown> = {};
    let firstPropertyId: string | null = null;
    let firstRenterId: string | null = null;
    for (const path of ["/properties", "/tenants", "/leases"]) {
      const body = await rcGet<ListResponse<RawObj>>(`${path}?limit=1`);
      const rows = rowsOf<RawObj>(body);
      if (path === "/properties" && rows[0]) {
        firstPropertyId = String(pick(rows[0], "property_id", "propertyID", "id") ?? "") || null;
      }
      if (path === "/leases" && rows[0]) {
        firstRenterId = str(pick(rows[0], "renter_id", "renterID")) ?? null;
      }
      probes[path] = {
        count: rows.length,
        firstRecordKeys: rows[0] ? Object.keys(rows[0]) : [],
        firstRecord: rows[0] ?? null,
      };
    }
    // Probe /transactions too — the per-property ledger (charges, payments,
    // running balance) depends on these field names, which we can't otherwise
    // see. Rentec accepts exactly ONE filter id, so try property then renter.
    const txFilter = firstPropertyId
      ? `property_id=${encodeURIComponent(firstPropertyId)}`
      : firstRenterId
        ? `renter_id=${encodeURIComponent(firstRenterId)}`
        : null;
    if (txFilter) {
      const body = await rcGet<ListResponse<RawObj>>(`/transactions?${txFilter}&limit=3`);
      const rows = rowsOf<RawObj>(body);
      probes["/transactions"] = {
        filter: txFilter,
        count: rows.length,
        summary: body?.summary ?? null,
        firstRecordKeys: rows[0] ? Object.keys(rows[0]) : [],
        firstRecords: rows.slice(0, 3),
      };
    }
    // The TENANT ledger (renter_id) is what drives the property statement: it
    // should include rent invoices + late fees (charges/debits), not just the
    // bank deposits the property query returns. summary.ending_balance here is
    // the authoritative amount owed (negative). Probe it to confirm the charge
    // record shape and balance sign.
    if (firstRenterId) {
      const body = await rcGet<ListResponse<RawObj>>(
        `/transactions?renter_id=${encodeURIComponent(firstRenterId)}&limit=8`,
      );
      const rows = rowsOf<RawObj>(body);
      probes["/transactions?renter_id"] = {
        renterId: firstRenterId,
        count: rows.length,
        summary: body?.summary ?? null,
        firstRecordKeys: rows[0] ? Object.keys(rows[0]) : [],
        firstRecords: rows.slice(0, 8),
      };
    }
    out["probes"] = probes;
  }
  return out;
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
  monthlyRent?: number;
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
  renterId?: string; // Rentec links a lease to its resident by renter_id.
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
  // Treat empty strings as absent so a later, populated key wins (Rentec often
  // returns "" for an unused field — e.g. tenant.phone — alongside the real one).
  for (const k of keys) {
    const v = o[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

function mapProperty(p: RawObj): DLProperty {
  return {
    // Use the numeric property_id — leases/tenants reference THAT, not the
    // composite "property:NNN" string Rentec returns in the `id` field.
    id: String(pick(p, "property_id", "propertyID", "id") ?? ""),
    name: str(pick(p, "nickname", "name", "property_name", "shortName")),
    address: {
      street1: str(pick(p, "address", "street", "address1", "street1")),
      street2: str(pick(p, "address2", "street2")),
      city: str(pick(p, "city")),
      state: str(pick(p, "state")),
      zip: str(pick(p, "zip", "zipcode", "postal_code")),
    },
    class: str(pick(p, "ptype", "type", "class", "property_type")),
    monthlyRent: num(pick(p, "monthly_rent", "rent", "monthlyRent")),
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
  const first = str(pick(t, "f_name", "firstName", "first_name", "first"));
  const last = str(pick(t, "l_name", "lastName", "last_name", "last"));
  const full =
    str(pick(t, "fullName", "name", "full_name")) ||
    [first, last].filter(Boolean).join(" ") ||
    undefined;
  // mphone is Rentec's mobile field; plain `phone` is often empty.
  const phone = str(pick(t, "mphone", "phone", "mobile", "cell", "phone_number"));
  const email = str(pick(t, "email", "email_address"));
  return {
    // Use the numeric renter_id — leases reference THAT, not the "tenant:NNN" id.
    id: String(pick(t, "renter_id", "tenant_id", "renterID", "id") ?? ""),
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
    // Use the numeric lease_id, not the composite "lease:NNN" id.
    id: String(pick(l, "lease_id", "leaseID", "id") ?? ""),
    name: str(pick(l, "name", "tenant_name", "tenants", "title")),
    property: String(pick(l, "property_id", "propertyID", "property") ?? ""),
    renterId: str(pick(l, "renter_id", "renterID", "tenant_id")),
    units: unitId ? [unitId] : [],
    // Normalize Rentec's status to the "ACTIVE" sentinel the aggregator checks.
    status: rawStatus.startsWith("active") || rawStatus === "current" ? "ACTIVE" : rawStatus.toUpperCase(),
    start: str(pick(l, "lease_begin", "start", "start_date", "lease_start", "move_in")),
    end: str(pick(l, "lease_end", "end", "end_date", "move_out")),
    totalRecurringRent: num(
      pick(l, "rent", "monthly_rent", "rent_amount", "monthlyRent", "lease_rent", "rent_total", "amount"),
    ),
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
    const pid = String(pick(p, "property_id", "propertyID", "id") ?? "");
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

function streetKey(addr: string): string {
  return (addr.split(",")[0] ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

/** Resolve a local address to its Rentec property id by street match. */
export async function findRentecPropertyIdByAddress(address: string): Promise<string | null> {
  const target = streetKey(address);
  if (!target) return null;
  const props = await getProperties();
  for (const p of props) {
    const s = streetKey(formatPropertyAddress(p));
    if (s && (s === target || s.includes(target) || target.includes(s))) return p.id;
  }
  return null;
}

export interface RentecLedgerLine {
  date: string;
  description: string;
  subDescription: string | null;
  reference: string | null;
  debit: number | null;
  credit: number | null;
  /**
   * Card-processing noise (convenience fees and their internal offsets). These
   * still count toward the running balance but are hidden from the statement so
   * it reads as a clean rent ledger (charges + payments), not a payment-processor
   * audit trail.
   */
  hidden?: boolean;
}

// Card-fee / processing chatter we don't want cluttering the rent statement.
// (Convenience fees and their offsets are property-side bank entries; they don't
// belong on the tenant's rent ledger of charges + payments.)
const LEDGER_NOISE_RE =
  /convenience fee|processing fee|cc fee|card fee|merchant fee|service fee|e-?check fee|transaction fee/i;

/** A transaction that's payment-processor noise rather than rent activity. */
function isLedgerNoise(o: RawObj): boolean {
  const text = [pick(o, "notes"), pick(o, "memo"), pick(o, "description")]
    .map((v) => String(v ?? ""))
    .join(" ");
  return LEDGER_NOISE_RE.test(text);
}

/**
 * Normalized ledger lines for one property's Rentec transactions, mapped to the
 * statement layout (date · description · check# · debit · credit). Running
 * balance is computed by the caller.
 *
 * Rentec's /transactions returns a single signed `amount` (positive = money in /
 * payment, negative = fee/expense/charge-out) plus a `summary.ending_balance`.
 * We map the sign straight to the credit/debit columns so the caller's running
 * balance (Σ credit − debit) reproduces Rentec's ending_balance exactly, rather
 * than inferring charge-vs-payment from a (nonexistent) type string.
 * Returns [] when there are no transactions.
 */
/**
 * Map one Rentec transaction row to a statement line. Rentec reports a single
 * signed `amount`: positive reduces what's owed (a payment → credit), negative
 * is a charge/invoice/late fee (→ debit). Σ(credit − debit) over the lines then
 * reproduces Rentec's summary.ending_balance (negative = the tenant owes).
 * Returns null for zero-value rows.
 */
function mapTransactionToLine(o: RawObj): RentecLedgerLine | null {
  const raw = str(pick(o, "transaction_time", "date", "transaction_date", "post_date", "entry_date", "created")) ?? "";
  // transaction_time is a full ISO timestamp; the statement shows yyyy-mm-dd.
  const date = /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : raw;
  const category = str(pick(o, "category_name", "account", "account_name", "gl_account", "gl"));
  // Invoices carry a label ("Invoice #199") in description; payments put their
  // text in notes (description blank). memo is usually a raw ID hash — last.
  const note = str(pick(o, "description", "notes", "memo", "comment", "note", "details"));
  const amount = num(pick(o, "amount", "total", "value", "amount_total"));
  let debit = num(pick(o, "debit", "charge", "charge_amount"));
  let credit = num(pick(o, "credit", "payment", "amount_received", "paid", "payment_amount"));
  if (debit === 0 && credit === 0 && amount !== 0) {
    if (amount > 0) credit = amount;
    else debit = Math.abs(amount);
  }
  if (debit === 0 && credit === 0) return null;
  const desc = note || category || "Transaction";
  // "0000" is Rentec's placeholder check number for electronic (EasyPay) entries.
  const refRaw = str(pick(o, "check_num", "check", "check_number", "reference", "ref"));
  const reference = refRaw && refRaw !== "0000" ? refRaw : null;
  return {
    date,
    description: desc,
    subDescription: note && category ? category : null,
    reference,
    debit: debit || null,
    credit: credit || null,
    hidden: isLedgerNoise(o),
  };
}

export interface RentecLedger {
  lines: RentecLedgerLine[];
  endingBalance: number | null; // authoritative running balance (neg = owes)
}

/**
 * The tenant's full Rentec ledger for one renter: charges (rent invoices, late
 * fees) AND payments, plus the authoritative running balance from
 * summary.ending_balance. This is the per-TENANT view — querying /transactions
 * by renter_id returns the receivable charges, unlike the per-property query
 * which only sees the property's bank deposits (payments).
 */
export async function getTenantLedger(renterId: string): Promise<RentecLedger> {
  const lines: RentecLedgerLine[] = [];
  let endingBalance: number | null = null;
  for (let page = 1; page <= MAX_PAGES; page++) {
    const body = await rcGet<ListResponse<RawObj>>(
      `/transactions?renter_id=${encodeURIComponent(renterId)}&page=${page}&limit=${PAGE_SIZE}`,
    );
    const rows = rowsOf<RawObj>(body);
    for (const r of rows) {
      const line = mapTransactionToLine(r);
      if (line) lines.push(line);
    }
    // The last page's summary carries the ending balance.
    if (typeof body?.summary?.ending_balance === "number") endingBalance = body.summary.ending_balance;
    if (rows.length < PAGE_SIZE) break;
  }
  return { lines, endingBalance };
}

/** Per-property statement lines (bank deposits only — kept for diagnostics). */
export async function getPropertyLedgerLines(propertyId: string): Promise<RentecLedgerLine[]> {
  const txns = await getTransactionsForProperty(propertyId);
  const lines: RentecLedgerLine[] = [];
  for (const tx of txns) {
    const line = mapTransactionToLine(tx as RawObj);
    if (line) lines.push(line);
  }
  return lines;
}

/**
 * The current resident's renter_id for a property — taken from the property's
 * `renters` list (the entry with no move_out), falling back to an active lease.
 */
export async function getCurrentRenterIdForProperty(propertyId: string): Promise<string | null> {
  const raw = await rcList<RawObj>("/properties?include_subunits=true");
  const prop = raw.find((p) => String(pick(p, "property_id", "propertyID", "id") ?? "") === propertyId);
  const renters = prop ? pick(prop, "renters") : undefined;
  if (Array.isArray(renters) && renters.length > 0) {
    const current = (renters as RawObj[]).find((r) => !r["move_out"]) ?? (renters as RawObj[])[0];
    const id = current ? str(pick(current, "renter_id", "renterID")) : undefined;
    if (id) return id;
  }
  const leases = await getLeases();
  const lease =
    leases.find((l) => l.property === propertyId && l.renterId && l.status === "ACTIVE") ??
    leases.find((l) => l.property === propertyId && l.renterId);
  return lease?.renterId ?? null;
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

// Kell Commercial rent cycle: rent is due on the 1st, there is a 10-day grace
// period (through the 10th), late fees begin on the 11th, and any balance left
// unpaid for 30+ days is treated as delinquent (3-day / 10-day notice eligible).
const GRACE_DAYS = 10; // grace period after the 1st; late fees start the day after
const LATE_FEE_DAY = 11; // late fees post on the 11th of the month
const LATE_FEE_AMOUNT = 75; // flat late fee once past the grace period
const DELINQUENT_DAYS = 30; // 30+ days past due → delinquent

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
  // Per-unit rent, used as a fallback when the lease record itself carries no
  // recurring-rent figure (so the dashboard's dollar totals aren't all $0).
  const rentByUnitId = new Map<string, number>();
  for (const u of units) {
    if (u.marketRent && u.marketRent > 0) rentByUnitId.set(u.id, u.marketRent);
  }
  const tenantByPropertyUnit = buildLeaseTenantLookup(tenants);
  const tenantById = new Map(tenants.map((t) => [t.id, t]));

  const now = new Date();
  const isCurrentMonth = now.getMonth() + 1 === month && now.getFullYear() === year;
  const billingStart = new Date(year, month - 1, 1);
  // For the current month, age from today; for a past month, age from its 1st.
  const asOf = isCurrentMonth ? Date.now() : new Date(year, month, 1).getTime();
  const dayOfMonth = isCurrentMonth ? now.getDate() : 31;
  const daysSinceFirst = Math.max(
    0,
    Math.floor((asOf - billingStart.getTime()) / (24 * 60 * 60 * 1000)),
  );
  // Late fees only apply once we are on/after the 11th of the billing month.
  const pastGrace = dayOfMonth > GRACE_DAYS;
  void LATE_FEE_DAY;

  const rows: DLRentRow[] = [];
  const uniqueProps = new Set<string>();

  for (const lease of leases) {
    if (lease.status && lease.status !== "ACTIVE") continue;
    uniqueProps.add(lease.property);

    const prop = propById.get(lease.property);
    const address = prop ? formatPropertyAddress(prop) : lease.name ?? lease.id;

    let tenantName: string | null = null;
    // Primary link: Rentec leases carry the resident's renter_id directly.
    const byRenter = lease.renterId ? tenantById.get(lease.renterId) : undefined;
    const t = byRenter ?? selectPrimaryLeaseTenant(lease, tenantByPropertyUnit);
    if (t) {
      tenantName = t.fullName ?? ([t.firstName, t.lastName].filter(Boolean).join(" ") || null);
    }
    if (!tenantName) {
      // Fall back to any tenant directly associated with this lease.
      const direct = tenants.find((x) => x.leaseId && x.leaseId === lease.id);
      tenantName = direct?.fullName ?? lease.name ?? null;
    }

    // Monthly rent: prefer the lease's recurring rent; otherwise sum the rent
    // of the unit(s) on the lease so dollar totals reflect real amounts.
    let monthlyRent = lease.totalRecurringRent ?? 0;
    if (monthlyRent <= 0) {
      const unitRent = (lease.units ?? []).reduce(
        (sum, uid) => sum + (rentByUnitId.get(uid) ?? 0),
        0,
      );
      if (unitRent > 0) monthlyRent = unitRent;
    }
    // Rentec leases here carry no recurring-rent field; the property's
    // monthly_rent is the authoritative figure.
    if (monthlyRent <= 0 && prop?.monthlyRent && prop.monthlyRent > 0) {
      monthlyRent = prop.monthlyRent;
    }

    const outstanding = lease.outstandingBalance ?? 0; // Rentec lease balance
    const owesNothing = outstanding <= 0;

    const startMatch = lease.start?.match(/^(\d{4})-(\d{2})/);
    const startedThisMonthOrLater = startMatch
      ? (() => {
          const sy = parseInt(startMatch[1], 10);
          const sm = parseInt(startMatch[2], 10);
          return sy > year || (sy === year && sm >= month);
        })()
      : false;

    // How many billing cycles is the balance behind? Used to age the debt so a
    // single missed month is "unpaid" but anything 30+ days old is delinquent.
    const monthsBehind =
      monthlyRent > 0 ? Math.max(1, Math.round(outstanding / monthlyRent)) : 1;
    const oldestUnpaid = new Date(year, month - 1 - (monthsBehind - 1), 1);
    const ageDays = owesNothing
      ? 0
      : Math.max(
          daysSinceFirst,
          Math.floor((asOf - oldestUnpaid.getTime()) / (24 * 60 * 60 * 1000)),
        );

    let status: DLRentRow["status"];
    let daysOverdue = 0;

    if (owesNothing) {
      // Rentec says nothing is owed for this lease (paid, prepaid, or credit).
      status = "paid";
      daysOverdue = 0;
    } else if (startedThisMonthOrLater) {
      // Brand-new lease that owes its first month — unpaid, not yet aged.
      status = "unpaid";
      daysOverdue = daysSinceFirst;
    } else if (ageDays >= DELINQUENT_DAYS) {
      status = "delinquent";
      daysOverdue = ageDays;
    } else {
      // Owes this month but still inside the 30-day window (incl. grace period).
      status = "unpaid";
      daysOverdue = ageDays;
    }

    // What's been paid toward THIS month's rent (so the bar tracks the current
    // cycle and "resets" each month): full rent when current, otherwise rent
    // minus the portion of the balance attributable to this month.
    const thisMonthOwed = Math.min(outstanding, monthlyRent);
    const amountPaid =
      monthlyRent > 0 ? Math.max(0, monthlyRent - thisMonthOwed) : 0;

    // Late fee accrues only once past the 10-day grace period (the 11th onward)
    // and only while the current month's rent is still owed.
    const lateFeeDue =
      pastGrace && status !== "paid" && thisMonthOwed > 0 ? LATE_FEE_AMOUNT : 0;

    rows.push({
      leaseId: lease.id,
      propertyDoorloopId: lease.property,
      address,
      tenantName,
      monthlyRent,
      amountPaid: round2(amountPaid),
      lateFeeDue,
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
  // Resolve the lease's resident via the lease's own renter_id (tenants don't
  // carry a lease id), then pull that renter's transactions.
  const leases = await getLeases();
  const lease = leases.find((l) => l.id === leaseId);
  const renterId = lease?.renterId;
  if (!renterId) return [];
  const txns = await getTransactionsForTenant(renterId);
  return txns
    .filter((tx) => {
      const o = tx as RawObj;
      // Payments are credits: pmt_type "CR" or a positive signed amount.
      const pmtType = String(pick(o, "pmt_type", "type") ?? "").toUpperCase();
      if (pmtType === "CR") return true;
      return num(pick(o, "amount", "credit", "payment")) > 0;
    })
    .map((tx) => {
      const o = tx as RawObj;
      return {
        id: String(pick(o, "transaction_id", "id") ?? ""),
        date: (str(pick(o, "transaction_time", "date", "transaction_date")) ?? "").slice(0, 10),
        lease: leaseId,
        amountReceived: Math.abs(num(pick(o, "amount", "credit", "payment"))),
      };
    });
}
