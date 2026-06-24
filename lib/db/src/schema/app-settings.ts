import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Simple key/value app settings (e.g. the daily follow-up nudge time). */
export const appSettingsTable = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AppSetting = typeof appSettingsTable.$inferSelect;
