import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

export const propertiesTable = pgTable("properties", {
  id: serial("id").primaryKey(),
  doorloopPropertyId: text("doorloop_property_id").unique(),
  doorloopLeaseId: text("doorloop_lease_id"),
  address: text("address").notNull(),
  resident1Name: text("resident1_name"),
  resident1Phone: text("resident1_phone"),
  resident1Email: text("resident1_email"),
  resident2Name: text("resident2_name"),
  resident2Phone: text("resident2_phone"),
  resident2Email: text("resident2_email"),
  notes: text("notes"),
  lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
});

export type Property = typeof propertiesTable.$inferSelect;
export type InsertProperty = typeof propertiesTable.$inferInsert;
