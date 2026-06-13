import { pgTable, text, serial, timestamp, integer, numeric } from "drizzle-orm/pg-core";

/**
 * Contact log — records each time outreach is made to an unpaid property
 * (a logged call, or a text reminder). The unpaid "back-check" uses this to
 * drop a property from the "Needs Contacted" list once it has been contacted.
 */
export const contactLogTable = pgTable("contact_log", {
  id: serial("id").primaryKey(),
  propertyAddress: text("property_address").notNull(),
  tenantName: text("tenant_name"),
  // "call" | "text" | "email" | "other"
  method: text("method").notNull().default("other"),
  note: text("note"),
  contactedBy: text("contacted_by").notNull().default("jacob"),
  contactedAt: timestamp("contacted_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Reminder log — records each per-stage text reminder sent. The native Messages
 * composer can't confirm an actual send, so we log on tap (timestamp + user +
 * stage) and surface a "sent" tag / history on the UI.
 */
export const reminderLogTable = pgTable("reminder_log", {
  id: serial("id").primaryKey(),
  // Optional link to a payment situation; reminders can also fire from the
  // "Needs Contacted" list where no situation exists yet.
  noteId: integer("note_id"),
  propertyAddress: text("property_address").notNull(),
  tenantName: text("tenant_name"),
  // ReminderStage from config/reminder-templates.ts
  stage: text("stage").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }),
  sentBy: text("sent_by").notNull().default("jacob"),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ContactLog = typeof contactLogTable.$inferSelect;
export type ReminderLog = typeof reminderLogTable.$inferSelect;
