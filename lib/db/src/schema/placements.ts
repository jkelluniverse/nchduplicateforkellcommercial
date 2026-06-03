import { pgTable, text, serial, timestamp, numeric } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const placementsTable = pgTable("placements", {
  id: serial("id").primaryKey(),
  invoiceNumber: text("invoice_number").notNull().unique(),
  address: text("address").notNull(),
  residentName: text("resident_name").notNull(),
  placementDate: text("placement_date").notNull(),
  paymentStatus: text("payment_status", { enum: ["paid", "unpaid"] }).notNull().default("unpaid"),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull().default("2500"),
  submittedBy: text("submitted_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertPlacementSchema = createInsertSchema(placementsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertPlacement = z.infer<typeof insertPlacementSchema>;
export type Placement = typeof placementsTable.$inferSelect;
