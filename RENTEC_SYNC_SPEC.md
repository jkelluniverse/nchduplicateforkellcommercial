# Rentec Direct sync spec (read-only)

Implemented in `artifacts/api-server/src/services/rentec.ts`. This app is
**read-only** against Rentec — it never POSTs/PUTs/writes back.

## Connection

- Base URL: `https://secure.rentecdirect.com/api/v3` (override with `RENTEC_API_BASE`).
- Auth header: `X-API-Key: <RENTEC_API_KEY>` (use a **read-only** key).
- Rate limit: 60 req/min. The client throttles to ~1 req/sec
  (`MIN_REQUEST_GAP_MS = 1050`) and backs off on HTTP 429 (1s, 2s, 4s, 8s).
- The client never throws: every public function returns `null`/`[]` on failure
  so callers fall back to the local `rent_status` table.

## What counts as "owed"

- **Amount owed / past-due come from `Lease.balance` and `Tenant.balance`**,
  which Rentec computes. `Property` has **no** balance field.
- Do **not** sum `/transactions` to derive what's owed.
- `/transactions` takes **exactly one** filter id — `property_id` **OR**
  `renter_id`, never both (Rentec returns 400). Paginated 300/page; the last
  page's `summary.ending_balance` is the running ledger balance.

## Sync order

1. `GET /ping` — health check.
2. `GET /accounts` — cache GL/bank accounts.
3. `GET /properties?include_subunits=true` — properties + their sub-units
   (a commercial building is one property with many sub-units → modeled as units).
4. `GET /tenants` — residents (+ their balances, lease/property/unit links).
5. `GET /leases` — leases with rent + `balance`.
6. Per-property `GET /transactions?property_id=...` — line items (only when
   needed; balances above are the source of truth for delinquency).

## Mapping to the app

The client exposes the same function surface the app already consumed
(`getProperties`, `getUnits`, `getLeases`, `getTenants`, `getRentStatus`,
`getPaymentsForLease`, plus the shared resident-selection helpers), and
normalizes Rentec rows into PM-agnostic shapes. `getRentStatus(month, year)`
returns per-lease rows with a status of
`paid | unpaid | late | partial | delinquent` and `daysOverdue`, aged from the
oldest unpaid cycle when Rentec reports a past-due balance.

## Refresh

- Manual: `POST /api/rentec/sync` clears the 5-minute cache and re-fetches.
  The dashboard's **Refresh** button calls this.
- Scheduled: the server runs a directory sync on boot and every 30 minutes;
  rent-status is recomputed on demand and cached.

## Field-name note

Rentec's exact JSON field names can vary by account/version. The mapping
helpers in `rentec.ts` check several likely keys defensively. If a live probe
with a real key shows different names, adjust the small `map*()` helpers — the
public shapes returned to the app must stay the same.
