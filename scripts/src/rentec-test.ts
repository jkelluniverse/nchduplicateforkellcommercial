/**
 * Standalone Rentec Direct probe for a specific set of addresses.
 *
 * Self-contained (no app imports / no extra deps) so it can be run against a
 * live read-only RENTEC_API_KEY to confirm the connection works and to see, per
 * address: the matched property, the current resident, the lease, and the
 * authoritative ending balance + recent ledger lines.
 *
 * Usage:
 *   RENTEC_API_KEY=xxxx pnpm --filter @workspace/scripts exec tsx ./src/rentec-test.ts
 *   RENTEC_API_KEY=xxxx tsx scripts/src/rentec-test.ts "2227 40th St NW" "1026 Arlington ave sw"
 */

const BASE_URL = process.env["RENTEC_API_BASE"] || "https://secure.rentecdirect.com/api/v3";
const KEY = process.env["RENTEC_API_KEY"] || "";

const DEFAULT_ADDRESSES = ["2227 40th St NW", "1026 Arlington ave sw"];
const addresses = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT_ADDRESSES;

type RawObj = Record<string, unknown>;

const AUTH_SCHEMES: Array<{ name: string; headers: (k: string) => Record<string, string> }> = [
  { name: "bearer", headers: (k) => ({ Authorization: `Bearer ${k}` }) },
  { name: "x-api-key", headers: (k) => ({ "X-API-Key": k }) },
  { name: "apikey-header", headers: (k) => ({ apikey: k }) },
  { name: "authorization-raw", headers: (k) => ({ Authorization: k }) },
];
let workingScheme = -1;

let lastRequestAt = 0;
async function throttle(): Promise<void> {
  const wait = lastRequestAt + 1050 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

async function rawFetch(path: string, schemeIdx: number): Promise<Response> {
  await throttle();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15_000);
  try {
    return await fetch(`${BASE_URL}${path}`, {
      method: "GET",
      headers: { ...AUTH_SCHEMES[schemeIdx]!.headers(KEY), Accept: "application/json" },
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function get<T>(path: string, attempt = 0): Promise<T | null> {
  const schemes = workingScheme >= 0 ? [workingScheme] : AUTH_SCHEMES.map((_, i) => i);
  for (const idx of schemes) {
    let res: Response;
    try {
      res = await rawFetch(path, idx);
    } catch (err) {
      console.error(`  request error (${AUTH_SCHEMES[idx]!.name}): ${String((err as Error)?.message ?? err)}`);
      continue;
    }
    if (res.status === 429 && attempt < 4) {
      const backoff = 1000 * Math.pow(2, attempt);
      await new Promise((r) => setTimeout(r, backoff));
      return get<T>(path, attempt + 1);
    }
    if (res.status === 401 || res.status === 403) {
      if (workingScheme >= 0) workingScheme = -1;
      continue;
    }
    if (!res.ok) {
      console.error(`  ${path} -> HTTP ${res.status}`);
      return null;
    }
    if (workingScheme < 0) {
      workingScheme = idx;
      console.log(`Auth scheme accepted: ${AUTH_SCHEMES[idx]!.name}`);
    }
    const ctype = res.headers.get("content-type") ?? "";
    if (!ctype.includes("application/json")) return null;
    return (await res.json()) as T;
  }
  return null;
}

function rowsOf<T>(body: unknown): T[] {
  if (!body) return [];
  if (Array.isArray(body)) return body as T[];
  for (const k of ["data", "results", "records", "items", "rows", "properties", "tenants", "leases", "transactions"]) {
    const v = (body as RawObj)[k];
    if (Array.isArray(v)) return v as T[];
  }
  return [];
}

function pick(o: RawObj, ...keys: string[]): unknown {
  for (const k of keys) {
    const v = o[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}
function str(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === "string" && v.trim() !== "") return v;
    if (typeof v === "number") return String(v);
  }
  return undefined;
}
function num(...vals: unknown[]): number {
  for (const v of vals) {
    if (typeof v === "number" && !Number.isNaN(v)) return v;
    if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  }
  return 0;
}

function propAddress(p: RawObj): string {
  const street = [str(pick(p, "address", "street", "address1", "street1")), str(pick(p, "address2", "street2"))]
    .filter(Boolean)
    .join(" ");
  const tail = [str(pick(p, "city")), str(pick(p, "state")), str(pick(p, "zip", "zipcode", "postal_code"))]
    .filter(Boolean)
    .join(", ");
  return [street, tail].filter(Boolean).join(", ");
}
function streetKey(addr: string): string {
  return (addr.split(",")[0] ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

async function getAllProperties(): Promise<RawObj[]> {
  const all: RawObj[] = [];
  for (let page = 1; page <= 50; page++) {
    const body = await get<RawObj>(`/properties?include_subunits=true&page=${page}&limit=300`);
    const rows = rowsOf<RawObj>(body);
    all.push(...rows);
    if (rows.length < 300) break;
  }
  return all;
}

async function currentRenterId(prop: RawObj, propertyId: string): Promise<string | null> {
  const renters = pick(prop, "renters");
  if (Array.isArray(renters) && renters.length > 0) {
    const current = (renters as RawObj[]).find((r) => !r["move_out"]) ?? (renters as RawObj[])[0];
    const id = current ? str(pick(current, "renter_id", "renterID")) : undefined;
    if (id) return id;
  }
  // Fall back to leases.
  const body = await get<RawObj>(`/leases?property_id=${encodeURIComponent(propertyId)}&limit=50`);
  const leases = rowsOf<RawObj>(body);
  const lease =
    leases.find((l) => str(pick(l, "renter_id", "renterID")) && /active|current/i.test(String(pick(l, "status") ?? ""))) ??
    leases.find((l) => str(pick(l, "renter_id", "renterID")));
  return lease ? (str(pick(lease, "renter_id", "renterID")) ?? null) : null;
}

async function tenantLedger(renterId: string): Promise<{ endingBalance: number | null; lines: RawObj[] }> {
  const lines: RawObj[] = [];
  let endingBalance: number | null = null;
  for (let page = 1; page <= 50; page++) {
    const body = await get<RawObj>(`/transactions?renter_id=${encodeURIComponent(renterId)}&page=${page}&limit=300`);
    const rows = rowsOf<RawObj>(body);
    lines.push(...rows);
    const summary = (body as RawObj)?.["summary"] as RawObj | undefined;
    if (summary && typeof summary["ending_balance"] === "number") endingBalance = summary["ending_balance"] as number;
    if (rows.length < 300) break;
  }
  return { endingBalance, lines };
}

async function main(): Promise<void> {
  if (!KEY) {
    console.error("RENTEC_API_KEY is not set. Run with: RENTEC_API_KEY=xxxx tsx scripts/src/rentec-test.ts");
    process.exit(1);
  }
  console.log(`Base: ${BASE_URL}`);
  console.log(`Testing ${addresses.length} address(es):`);
  addresses.forEach((a) => console.log(`  - ${a}`));
  console.log("");

  // 1. Connection / ping.
  const ping = await get<RawObj>("/ping");
  console.log(`Ping: ${ping !== null ? "OK" : "no response (auth may have failed)"}\n`);

  // 2. Pull the property directory once.
  const props = await getAllProperties();
  console.log(`Fetched ${props.length} properties from Rentec.\n`);
  if (props.length === 0) {
    console.error("No properties returned — check the key's permissions/account.");
    process.exit(1);
  }

  for (const address of addresses) {
    console.log("=".repeat(72));
    console.log(`ADDRESS: ${address}`);
    const target = streetKey(address);
    const match = props.find((p) => {
      const s = streetKey(propAddress(p));
      return s && (s === target || s.includes(target) || target.includes(s));
    });
    if (!match) {
      console.log("  No matching property found in Rentec.\n");
      continue;
    }
    const propertyId = String(pick(match, "property_id", "propertyID", "id") ?? "");
    console.log(`  Matched property: ${str(pick(match, "nickname", "name", "property_name")) ?? "(no name)"} (id ${propertyId})`);
    console.log(`  Rentec address:   ${propAddress(match)}`);
    console.log(`  Monthly rent:     ${num(pick(match, "monthly_rent", "rent")) || "n/a"}`);

    const renterId = await currentRenterId(match, propertyId);
    if (!renterId) {
      console.log("  Current resident: none found.\n");
      continue;
    }

    // Resolve the tenant's name/balance from /tenants is heavier; use the
    // ledger's authoritative ending balance + the renter record on the property.
    const renters = pick(match, "renters");
    let name: string | undefined;
    if (Array.isArray(renters)) {
      const r = (renters as RawObj[]).find((x) => str(pick(x, "renter_id", "renterID")) === renterId);
      if (r) name = str(pick(r, "name", "fullName", "full_name")) ||
        [str(pick(r, "f_name", "first_name")), str(pick(r, "l_name", "last_name"))].filter(Boolean).join(" ");
    }
    console.log(`  Current resident: ${name ?? "(name not on property record)"} (renter_id ${renterId})`);

    const { endingBalance, lines } = await tenantLedger(renterId);
    console.log(`  Ending balance:   ${endingBalance === null ? "n/a" : endingBalance} ${endingBalance !== null && endingBalance < 0 ? "(owes)" : ""}`);
    console.log(`  Ledger lines:     ${lines.length}`);
    const recent = lines.slice(-5);
    for (const l of recent) {
      const date = (str(pick(l, "transaction_time", "date", "transaction_date")) ?? "").slice(0, 10);
      const amt = num(pick(l, "amount", "total", "value"));
      const desc = str(pick(l, "description", "notes", "memo", "category_name")) ?? "";
      console.log(`      ${date}  ${String(amt).padStart(10)}  ${desc}`);
    }
    console.log("");
  }
  console.log("=".repeat(72));
  console.log("Done.");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
