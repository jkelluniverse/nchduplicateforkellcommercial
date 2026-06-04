import { db, propertiesTable, rentStatusTable } from "@workspace/db";
import { eq, notInArray, isNull, and, notLike } from "drizzle-orm";
import { logger } from "./logger";
import {
  getProperties,
  getLeases,
  getTenants,
  hasToken,
  clearCache,
  formatPropertyAddress,
  buildLeaseTenantLookup,
  selectCurrentLeaseTenants,
  type DLTenant,
} from "../services/rentec";

interface SyncStatus {
  lastSyncAt: string | null;
  lastSyncOk: boolean;
  propertyCount: number;
  error: string | null;
}

let lastSyncStatus: SyncStatus = {
  lastSyncAt: null,
  lastSyncOk: false,
  propertyCount: 0,
  error: null,
};

export function getLastSyncStatus(): SyncStatus {
  return lastSyncStatus;
}

interface SyncResult {
  ok: boolean;
  inserted: number;
  updated: number;
  removed: number;
  total: number;
  error?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// DIRECTORY DATA SOURCE: DoorLoop ONLY
// Never read from tenant_applications or any form submission table.
// Form submissions are for Jacob's review only — not for directory population.
// If this function touches any table other than DoorLoop API responses
// and the local properties table, that is a bug.
// ─────────────────────────────────────────────────────────────────────────────
export async function syncDirectory(): Promise<SyncResult> {
  if (!hasToken()) {
    const err = "RENTEC_API_KEY not configured";
    lastSyncStatus = { lastSyncAt: null, lastSyncOk: false, propertyCount: 0, error: err };
    return { ok: false, inserted: 0, updated: 0, removed: 0, total: 0, error: err };
  }

  try {
    clearCache();

    const [dlProperties, dlLeases, dlTenants] = await Promise.all([
      getProperties(),
      getLeases(),
      getTenants(),
    ]);

    if (dlProperties.length === 0 && dlLeases.length === 0) {
      const err = "Rentec returned no data — may be unreachable";
      lastSyncStatus = { ...lastSyncStatus, lastSyncOk: false, error: err };
      return { ok: false, inserted: 0, updated: 0, removed: 0, total: 0, error: err };
    }

    // Build tenant lookup: prospectInfo.interests links tenant to property+unit.
    // Only LEASE_TENANT records (people actually on a lease) are included;
    // PROSPECT_TENANT inquiries are skipped by the shared helper.
    const tenantsByPropertyUnit = buildLeaseTenantLookup(dlTenants);

    // Only care about active leases. DoorLoop sometimes leaves a property
    // with multiple "ACTIVE" leases during transitions (old lease not
    // yet closed). If multiple exist for one property, pick the most
    // recent by start date — that's the current resident.
    // Treat a lease as active unless DoorLoop explicitly marks it ended.
    // DoorLoop currently returns only ACTIVE / INACTIVE for this portfolio,
    // but allow for variants (CURRENT, MONTH_TO_MONTH) so a future status
    // change can never silently drop a property from the directory.
    const endedStatuses = new Set(["INACTIVE", "EXPIRED", "TERMINATED", "ENDED", "CANCELLED", "CANCELED"]);
    const activeLeases = dlLeases.filter(
      (l) => !l.status || !endedStatuses.has(l.status.toUpperCase())
    );
    activeLeases.sort((a, b) => {
      // Most recent start date first; missing start sorts last
      const aT = a.start ? new Date(a.start).getTime() : 0;
      const bT = b.start ? new Date(b.start).getTime() : 0;
      return bT - aT;
    });

    // Build map of property ID -> DL property for address lookup
    const propById = new Map(dlProperties.map((p) => [p.id, p]));

    // For each active lease, build a directory entry
    interface SyncEntry {
      doorloopPropertyId: string;
      doorloopLeaseId: string;
      address: string;
      resident1Name: string | null;
      resident1Phone: string | null;
      resident1Email: string | null;
      resident2Name: string | null;
      resident2Phone: string | null;
      resident2Email: string | null;
    }

    const entries: SyncEntry[] = [];
    const seenPropertyIds = new Set<string>();

    for (const lease of activeLeases) {
      const prop = propById.get(lease.property);
      if (!prop) continue;

      // Skip duplicates — one property can have only one directory entry
      // (use first active lease found)
      if (seenPropertyIds.has(lease.property)) continue;
      seenPropertyIds.add(lease.property);

      const address = formatPropertyAddress(prop);

      function extractTenantInfo(tenant: DLTenant | undefined) {
        if (!tenant) return { name: null, phone: null, email: null };
        const name = tenant.fullName ?? ([tenant.firstName, tenant.lastName].filter(Boolean).join(" ") || null);
        const phone = tenant.e164PhoneMobileNumber ?? tenant.phones?.[0]?.number ?? null;
        const email = tenant.emails?.[0]?.address ?? null;
        return { name, phone, email };
      }

      // Pick the CURRENT tenant(s) via the shared helper, which matches
      // candidates against lease.name (DoorLoop names every lease after its
      // current tenant(s), e.g. "Debra Riley & Linda Rogers"). Prior tenants
      // are not in the name, so current co-tenants added months apart are
      // kept while ended-lease tenants on the same unit are excluded.
      const selected = selectCurrentLeaseTenants(lease, tenantsByPropertyUnit);

      const r1 = extractTenantInfo(selected[0]);
      const r2Raw = extractTenantInfo(selected[1]);
      // DoorLoop sometimes links the same tenant record to multiple units,
      // which produces a duplicate second resident. If r2 has the same name
      // AND phone as r1, treat r2 as empty.
      const isDupe =
        r2Raw.name !== null &&
        r1.name !== null &&
        r2Raw.name === r1.name &&
        r2Raw.phone === r1.phone;
      const r2 = isDupe ? { name: null, phone: null, email: null } : r2Raw;

      entries.push({
        doorloopPropertyId: lease.property,
        doorloopLeaseId: lease.id,
        address,
        resident1Name: r1.name,
        resident1Phone: r1.phone,
        resident1Email: r1.email,
        resident2Name: r2.name,
        resident2Phone: r2.phone,
        resident2Email: r2.email,
      });
    }

    // Perform upsert logic against local DB
    let inserted = 0;
    let updated = 0;
    const now = new Date();
    const syncedPropertyIds: string[] = [];

    for (const entry of entries) {
      syncedPropertyIds.push(entry.doorloopPropertyId);

      const [existing] = await db
        .select()
        .from(propertiesTable)
        .where(eq(propertiesTable.doorloopPropertyId, entry.doorloopPropertyId))
        .limit(1);

      if (existing) {
        await db
          .update(propertiesTable)
          .set({
            doorloopLeaseId: entry.doorloopLeaseId,
            address: entry.address,
            resident1Name: entry.resident1Name,
            resident1Phone: entry.resident1Phone,
            resident1Email: entry.resident1Email,
            resident2Name: entry.resident2Name,
            resident2Phone: entry.resident2Phone,
            resident2Email: entry.resident2Email,
            lastSyncedAt: now,
          })
          .where(eq(propertiesTable.id, existing.id));
        updated++;
      } else {
        await db.insert(propertiesTable).values({
          doorloopPropertyId: entry.doorloopPropertyId,
          doorloopLeaseId: entry.doorloopLeaseId,
          address: entry.address,
          resident1Name: entry.resident1Name,
          resident1Phone: entry.resident1Phone,
          resident1Email: entry.resident1Email,
          resident2Name: entry.resident2Name,
          resident2Phone: entry.resident2Phone,
          resident2Email: entry.resident2Email,
          lastSyncedAt: now,
        });
        inserted++;
      }
    }

    // Remove properties with no matching active DoorLoop lease — but never
    // touch curated `seed:` rows from the contact sheet (Rentec only manages
    // its own rows).
    let removed = 0;
    if (syncedPropertyIds.length > 0) {
      const staleRows = await db
        .select({ id: propertiesTable.id })
        .from(propertiesTable)
        .where(
          and(
            notInArray(propertiesTable.doorloopPropertyId, syncedPropertyIds),
            notLike(propertiesTable.doorloopPropertyId, "seed:%"),
          )!,
        );
      for (const row of staleRows) {
        await db.delete(rentStatusTable).where(eq(rentStatusTable.propertyId, row.id));
        await db.delete(propertiesTable).where(eq(propertiesTable.id, row.id));
        removed++;
      }
    }
    // Also remove rows with null doorloopPropertyId (manually added orphans)
    const orphanRows = await db
      .select({ id: propertiesTable.id })
      .from(propertiesTable)
      .where(isNull(propertiesTable.doorloopPropertyId));
    for (const row of orphanRows) {
      await db.delete(rentStatusTable).where(eq(rentStatusTable.propertyId, row.id));
      await db.delete(propertiesTable).where(eq(propertiesTable.id, row.id));
      removed++;
    }

    const total = entries.length;
    lastSyncStatus = {
      lastSyncAt: now.toISOString(),
      lastSyncOk: true,
      propertyCount: total,
      error: null,
    };

    logger.info({ inserted, updated, removed, total }, "Directory sync complete");
    return { ok: true, inserted, updated, removed, total };
  } catch (err: any) {
    const errMsg = err?.message ?? "Unknown sync error";
    lastSyncStatus = { ...lastSyncStatus, lastSyncOk: false, error: errMsg };
    logger.error({ err }, "Directory sync failed");
    return { ok: false, inserted: 0, updated: 0, removed: 0, total: 0, error: errMsg };
  }
}
