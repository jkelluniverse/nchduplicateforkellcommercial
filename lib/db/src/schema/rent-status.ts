import { pgTable, text, serial, integer, timestamp, numeric, uniqueIndex, index, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { propertiesTable } from "./properties";

export const rentStatusTable = pgTable(
  "rent_status",
  {
    id: serial("id").primaryKey(),
    // 'restrict' so a property cannot be deleted while it has rent history —
    // the spec requires we never delete prior month data.
    propertyId: integer("property_id").notNull().references(() => propertiesTable.id, { onDelete: "restrict" }),
    address: text("address").notNull(),
    tenantName: text("tenant_name"),
    monthlyRent: numeric("monthly_rent", { precision: 12, scale: 2 }).notNull().default("0"),
    month: integer("month").notNull(),
    year: integer("year").notNull(),
    status: text("status", { enum: ["paid", "unpaid", "late", "delinquent", "partial"] }).notNull().default("unpaid"),
    amountPaid: numeric("amount_paid", { precision: 12, scale: 2 }).notNull().default("0"),
    lateFeeDue: numeric("late_fee_due", { precision: 12, scale: 2 }).notNull().default("0"),
    lateFeePaid: numeric("late_fee_paid", { precision: 12, scale: 2 }).notNull().default("0"),
    paymentDate: text("payment_date"),
    daysOverdue: integer("days_overdue").notNull().default(0),
    notes: text("notes"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex("rent_status_property_month_year_unique").on(t.propertyId, t.month, t.year),
    index("rent_status_month_year_idx").on(t.month, t.year),
    check("rent_status_month_range", sql`${t.month} BETWEEN 1 AND 12`),
    check("rent_status_year_range", sql`${t.year} BETWEEN 2000 AND 9999`),
    check("rent_status_amount_paid_nonneg", sql`${t.amountPaid} >= 0`),
    check("rent_status_late_fee_due_nonneg", sql`${t.lateFeeDue} >= 0`),
    check("rent_status_late_fee_paid_nonneg", sql`${t.lateFeePaid} >= 0`),
    check("rent_status_monthly_rent_nonneg", sql`${t.monthlyRent} >= 0`),
    check("rent_status_days_overdue_nonneg", sql`${t.daysOverdue} >= 0`),
  ],
);

export type RentStatus = typeof rentStatusTable.$inferSelect;
export type InsertRentStatus = typeof rentStatusTable.$inferInsert;
