import { pgTable, text, serial, timestamp, numeric, boolean, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const jobsTable = pgTable("jobs", {
  id: serial("id").primaryKey(),
  jobNumber: text("job_number").notNull().unique(),
  client: text("client").notNull(),
  address: text("address").notNull(),
  description: text("description").notNull(),
  status: text("status", { enum: ["estimate", "deposit_received", "in_progress", "invoiced", "paid", "complete", "closed"] }).notNull().default("estimate"),
  estimateAmount: numeric("estimate_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  depositAmount: numeric("deposit_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  totalCosts: numeric("total_costs", { precision: 12, scale: 2 }).notNull().default("0"),
  isOverBudget: boolean("is_over_budget").notNull().default(false),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const receiptsTable = pgTable("receipts", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobsTable.id),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  category: text("category", { enum: ["materials", "labor", "subcontractor", "equipment_tools", "vehicle_fuel", "other"] }).notNull(),
  vendorName: text("vendor_name"),
  notes: text("notes"),
  photoUrl: text("photo_url"),
  driveFileId: text("drive_file_id"),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const jobNotesTable = pgTable("job_notes", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobsTable.id),
  note: text("note").notNull(),
  author: text("author").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const statusHistoryTable = pgTable("status_history", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => jobsTable.id),
  fromStatus: text("from_status"),
  toStatus: text("to_status").notNull(),
  changedBy: text("changed_by").notNull(),
  note: text("note"),
  changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertJobSchema = createInsertSchema(jobsTable).omit({ id: true, createdAt: true, updatedAt: true });
export const insertReceiptSchema = createInsertSchema(receiptsTable).omit({ id: true, createdAt: true });
export const insertJobNoteSchema = createInsertSchema(jobNotesTable).omit({ id: true, createdAt: true });

export type InsertJob = z.infer<typeof insertJobSchema>;
export type Job = typeof jobsTable.$inferSelect;
export type Receipt = typeof receiptsTable.$inferSelect;
export type JobNote = typeof jobNotesTable.$inferSelect;
export type StatusHistory = typeof statusHistoryTable.$inferSelect;
