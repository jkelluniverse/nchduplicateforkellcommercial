import { pgTable, text, serial, timestamp, integer, unique } from "drizzle-orm/pg-core";

/**
 * Monthly communication checklist log. One row per property per month records
 * that Jacob reached out to an unpaid tenant about their payment status. The
 * UNIQUE(property_address, month, year) constraint makes "mark contacted"
 * idempotent within a month; prior months stay as history.
 *
 * The column name `doorloop_lease_id` is intentionally retained for output-shape
 * compatibility — the value is a Rentec lease id in this app.
 */
export const monthlyContactLogTable = pgTable(
  "monthly_contact_log",
  {
    id: serial("id").primaryKey(),
    propertyAddress: text("property_address").notNull(),
    tenantName: text("tenant_name"),
    doorloopLeaseId: text("doorloop_lease_id"),
    month: integer("month").notNull(),
    year: integer("year").notNull(),
    // 'done' (resolved — call/in-person/voicemail/other) or 'awaiting_reply'
    // (a text was sent and we're waiting for the tenant to respond).
    status: text("status").default("done"),
    contactedAt: timestamp("contacted_at", { withTimezone: true }).defaultNow(),
    contactedBy: text("contacted_by").notNull().default("jacob"),
    contactMethod: text("contact_method"),
    notes: text("notes"),
    smsSentAt: timestamp("sms_sent_at", { withTimezone: true }),
  },
  (t) => ({
    uniquePropertyMonth: unique().on(t.propertyAddress, t.month, t.year),
  }),
);

export type MonthlyContactLog = typeof monthlyContactLogTable.$inferSelect;
