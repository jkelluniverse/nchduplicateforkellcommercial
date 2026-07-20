import { pgTable, text, serial, timestamp, numeric, date, integer, boolean } from "drizzle-orm/pg-core";
import { evictionCasesTable } from "./evictions";

/**
 * Court Payment Agreement — a magistrate-approved installment plan signed after
 * an eviction hearing. The case parks in 'payment_plan' status while the plan
 * is tracked; if the tenant misses one installment the landlord may file for a
 * set-out immediately (no new hearing/notice).
 */
export const paymentAgreementsTable = pgTable("payment_agreements", {
  id: serial("id").primaryKey(),
  evictionCaseId: integer("eviction_case_id").notNull().references(() => evictionCasesTable.id, { onDelete: "cascade" }),
  propertyAddress: text("property_address").notNull(),
  tenantName: text("tenant_name").notNull(),
  agreementDate: date("agreement_date"),
  courtRef: text("court_ref"),
  notes: text("notes"),
  // 'active' | 'completed' | 'defaulted' | 'cancelled'
  status: text("status").notNull().default("active"),
  setoutFiledAt: timestamp("setout_filed_at", { withTimezone: true }),
  createdBy: text("created_by").default("jacob"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow(),
});

export const paymentInstallmentsTable = pgTable("payment_installments", {
  id: serial("id").primaryKey(),
  agreementId: integer("agreement_id").notNull().references(() => paymentAgreementsTable.id, { onDelete: "cascade" }),
  dueDate: date("due_date").notNull(),
  amount: numeric("amount", { precision: 10, scale: 2 }).notNull(),
  // 'pending' | 'paid' | 'missed'
  status: text("status").notNull().default("pending"),
  paidDate: date("paid_date"),
  paidAmount: numeric("paid_amount", { precision: 10, scale: 2 }),
  // True when Jacob marked it paid by hand (e.g. cash) — the auto-check never
  // reverses a manual mark.
  manuallyMarked: boolean("manually_marked").default(false),
  notes: text("notes"),
});

export type PaymentAgreement = typeof paymentAgreementsTable.$inferSelect;
export type PaymentInstallment = typeof paymentInstallmentsTable.$inferSelect;
