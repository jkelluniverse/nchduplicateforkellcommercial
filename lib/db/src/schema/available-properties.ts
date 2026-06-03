import { pgTable, text, serial, integer, timestamp, boolean, check, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const availablePropertiesTable = pgTable(
  "available_properties",
  {
    id: serial("id").primaryKey(),
    number: text("number"),
    address: text("address").notNull(),
    cityStateZip: text("city_state_zip").notNull(),
    beds: integer("beds"),
    baths: integer("baths"),
    notes: text("notes"),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("available_properties_active_sort_idx").on(t.active, t.sortOrder),
    check("available_properties_beds_nonneg", sql`${t.beds} IS NULL OR ${t.beds} >= 0`),
    check("available_properties_baths_nonneg", sql`${t.baths} IS NULL OR ${t.baths} >= 0`),
  ],
);

export type AvailableProperty = typeof availablePropertiesTable.$inferSelect;
export type InsertAvailableProperty = typeof availablePropertiesTable.$inferInsert;
