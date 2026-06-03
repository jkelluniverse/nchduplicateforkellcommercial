import { pgTable, text, serial, timestamp, numeric, integer } from "drizzle-orm/pg-core";

export const expensesTable = pgTable("expenses", {
  id: serial("id").primaryKey(),
  description: text("description").notNull(),
  category: text("category").notNull(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  status: text("status", { enum: ["unsorted", "sorted"] }).notNull().default("unsorted"),
  photoUrl: text("photo_url"),
  submittedBy: text("submitted_by").notNull(),
  expenseType: text("expense_type"),
  payeeEntity: text("payee_entity"),
  propertyAddress: text("property_address"),
  propertyGroup: text("property_group"),
  paymentMethod: text("payment_method"),
  taxYear: integer("tax_year"),
  notes: text("notes"),
  extraDataJson: text("extra_data_json"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export type Expense = typeof expensesTable.$inferSelect;
