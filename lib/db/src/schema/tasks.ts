import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tasksTable = pgTable("tasks", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  assignedTo: text("assigned_to", { enum: ["mike", "jack", "jacob"] }).notNull(),
  assignedBy: text("assigned_by", { enum: ["mike", "jack", "jacob"] }),
  propertyAddress: text("property_address"),
  dueDate: text("due_date"),
  // Expanded enum: urgent/normal/low are the new canonical values; high/medium
  // are kept for backward-compat with existing rows.
  priority: text("priority", { enum: ["urgent", "high", "normal", "medium", "low"] }).notNull().default("normal"),
  // Expanded enum: pending/in_progress/done are the new canonical values; open
  // is kept for backward-compat with existing rows (treated as "pending").
  status: text("status", { enum: ["pending", "open", "in_progress", "done"] }).notNull().default("pending"),
  createdBy: text("created_by").notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const taskCommentsTable = pgTable("task_comments", {
  id: serial("id").primaryKey(),
  taskId: integer("task_id").notNull().references(() => tasksTable.id, { onDelete: "cascade" }),
  authorRole: text("author_role", { enum: ["mike", "jack", "jacob"] }).notNull(),
  comment: text("comment").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTaskSchema = createInsertSchema(tasksTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Task = typeof tasksTable.$inferSelect;
export type TaskComment = typeof taskCommentsTable.$inferSelect;
