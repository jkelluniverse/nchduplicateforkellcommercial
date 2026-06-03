import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

export const utilitySubmissionsTable = pgTable("utility_submissions", {
  id: serial("id").primaryKey(),
  email: text("email").notNull(),
  accountHolder: text("account_holder").notNull(),
  propertyAddress: text("property_address").notNull(),
  electricProvider: text("electric_provider").notNull(),
  electricAccount: text("electric_account").notNull(),
  gasProvider: text("gas_provider").notNull(),
  gasAccount: text("gas_account").notNull(),
  waterProvider: text("water_provider").notNull(),
  waterAccount: text("water_account").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type UtilitySubmission = typeof utilitySubmissionsTable.$inferSelect;
