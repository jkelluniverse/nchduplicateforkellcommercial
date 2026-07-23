/**
 * Shared helpers for manual rent-status overrides, used by both the rent-status
 * dashboard and the communication checklist so a "resolved" property is treated
 * consistently everywhere (off the delinquent list and out of follow-ups).
 *
 * Backed by the rent_status_overrides table. The `doorloop_lease_id` column
 * name is intentionally retained — its value is a Rentec lease id in this app.
 */
import { and, eq } from "drizzle-orm";
import { db, rentStatusOverridesTable, type RentStatusOverride } from "@workspace/db";

export const OVERRIDE_STATUSES = [
  "vacated",
  "written_off",
  "arrangement",
  "paid_cash",
  "other",
  // Force a property INTO delinquency (e.g. tenant said outright they won't
  // pay). Unlike the others this does NOT resolve the row — it surfaces it.
  "manual_delinquent",
] as const;

export type OverrideStatus = (typeof OVERRIDE_STATUSES)[number];

export function isOverrideStatus(v: unknown): v is OverrideStatus {
  return typeof v === "string" && (OVERRIDE_STATUSES as readonly string[]).includes(v);
}

/** All overrides for a month, keyed by property address. */
export async function getOverrideMap(
  month: number,
  year: number,
): Promise<Map<string, RentStatusOverride>> {
  const rows = await db
    .select()
    .from(rentStatusOverridesTable)
    .where(
      and(eq(rentStatusOverridesTable.month, month), eq(rentStatusOverridesTable.year, year)),
    );
  return new Map(rows.map((o) => [o.propertyAddress, o]));
}
