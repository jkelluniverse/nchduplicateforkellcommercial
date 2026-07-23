import { pgTable, text, serial, integer, timestamp, unique } from "drizzle-orm/pg-core";

/**
 * Manual overrides for a property's rent-collection status. Lets Jacob resolve
 * a delinquent property (evicted/vacated, written off, arrangement made, paid
 * in cash, or other) so it stops counting as delinquent for the month. One row
 * per property per month; prior months persist as history.
 *
 * The column name `doorloop_lease_id` is intentionally retained for output-shape
 * compatibility — the value is a Rentec lease id in this app.
 */
export const rentStatusOverridesTable = pgTable(
  "rent_status_overrides",
  {
    id: serial("id").primaryKey(),
    propertyAddress: text("property_address").notNull(),
    doorloopLeaseId: text("doorloop_lease_id"),
    month: integer("month").notNull(),
    year: integer("year").notNull(),
    // vacated | written_off | arrangement | paid_cash | other
    overrideStatus: text("override_status").notNull(),
    reason: text("reason").notNull(),
    notes: text("notes"),
    createdBy: text("created_by").notNull().default("jacob"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  },
  (t) => ({
    uniquePropertyMonth: unique().on(t.propertyAddress, t.month, t.year),
  }),
);

export type RentStatusOverride = typeof rentStatusOverridesTable.$inferSelect;
