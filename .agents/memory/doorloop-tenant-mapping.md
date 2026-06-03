---
name: DoorLoop tenant → directory mapping
description: How to reliably map DoorLoop tenants to the current lease for the NCH directory sync
---

# DoorLoop tenant → directory mapping

DoorLoop's `/api/tenants` records link to a property+unit via
`prospectInfo.interests`, NOT to a specific lease. This link is **never
expired**, so a property+unit accumulates every tenant who ever showed
interest or leased it.

To populate the directory correctly you must filter twice:

1. **Exclude non-residents.** Keep only `tenant.type === "LEASE_TENANT"`.
   `PROSPECT_TENANT` records are listing-site inquiries (apartments.com etc.)
   that never moved in — they must never appear in the directory.

2. **Pick the CURRENT lease's tenants via `lease.name`.** DoorLoop names every
   lease after its current tenant(s) (a single name, or two names joined by
   "&" / "|" for co-tenants). Match candidate tenant names against `lease.name`
   (full name, first+last, or both tokens present, with word-boundary matching
   so a short token can't match a longer name). Prior tenants are NOT in the
   name, so this cleanly separates current co-tenants from ended-lease tenants
   on the same unit. Order results by appearance position in `lease.name`.

**Why not `createdAt` proximity:** an earlier fix grouped co-tenants by
createdAt within a 14-day window. This FAILED for legit co-tenants added
months apart (one co-tenant created ~65 days before the other), silently
dropping one from the directory. `lease.name` matching is the robust signal;
keep createdAt-DESC (sliced to the single freshest) only as a fallback when
`lease.name` matches nothing, so a prior tenant can't sneak in as a co-resident.

**Active-lease filter:** treat a lease as active unless its status is an
explicit ended state (INACTIVE/EXPIRED/TERMINATED/ENDED/CANCELLED). DoorLoop
currently returns only ACTIVE/INACTIVE for this portfolio, but a property can
have multiple ACTIVE leases during a transition — pick the one with the latest
`start` date.

**Single source of truth:** the selection logic lives in shared helpers in
`services/doorloop.ts` (`buildLeaseTenantLookup`, `tenantMatchesLeaseName`,
`selectCurrentLeaseTenants`, `selectPrimaryLeaseTenant`) and is reused by the
directory sync, rent-status, and the docs picker so all three agree on the
current tenant. Do not reintroduce "first interest match wins" in any of them.

**Directory data source rule:** the directory sync reads ONLY from the DoorLoop
API + the local `properties` table. It must never read `tenant_applications`,
`utility_submissions`, or any form-submission table.
