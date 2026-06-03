import { pgTable, text, serial, timestamp, integer, numeric, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tenantPaymentNotesTable = pgTable("tenant_payment_notes", {
  id: serial("id").primaryKey(),
  propertyAddress: text("property_address").notNull(),
  tenantName: text("tenant_name").notNull(),
  doorloopLeaseId: text("doorloop_lease_id"),
  situation: text("situation").notNull(),
  expectedPaymentDate: date("expected_payment_date"),
  expectedPaymentAmount: numeric("expected_payment_amount", { precision: 10, scale: 2 }),
  status: text("status", { enum: ["open", "missed_promise", "resolved"] }).notNull().default("open"),
  createdBy: text("created_by").notNull().default("jacob"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const tenantNoteCommentsTable = pgTable("tenant_note_comments", {
  id: serial("id").primaryKey(),
  noteId: integer("note_id").notNull().references(() => tenantPaymentNotesTable.id, { onDelete: "cascade" }),
  author: text("author").notNull(),
  comment: text("comment").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTenantNoteSchema = createInsertSchema(tenantPaymentNotesTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  resolvedAt: true,
});

export type InsertTenantNote = z.infer<typeof insertTenantNoteSchema>;
export type TenantPaymentNote = typeof tenantPaymentNotesTable.$inferSelect;
export type TenantNoteComment = typeof tenantNoteCommentsTable.$inferSelect;
