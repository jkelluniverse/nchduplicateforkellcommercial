import { pgTable, text, serial, timestamp, integer } from "drizzle-orm/pg-core";

export const syncQueueTable = pgTable("sync_queue", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  triggerName: text("trigger_name").notNull(),
  spreadsheetId: text("spreadsheet_id").notNull(),
  tabName: text("tab_name").notNull(),
  operation: text("operation", { enum: ["append", "update"] }).notNull(),
  rowData: text("row_data").notNull(),
  matchColumn: text("match_column"),
  matchValue: text("match_value"),
  retryCount: integer("retry_count").notNull().default(0),
  status: text("status", { enum: ["pending", "failed"] }).notNull().default("pending"),
});

export const sheetWriteLogTable = pgTable("sheet_write_log", {
  id: serial("id").primaryKey(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  triggerName: text("trigger_name").notNull(),
  spreadsheetId: text("spreadsheet_id").notNull(),
  tabName: text("tab_name").notNull(),
  operation: text("operation").notNull(),
  rowData: text("row_data").notNull(),
  status: text("status").notNull(),
  errorMessage: text("error_message"),
});

export type SyncQueueItem = typeof syncQueueTable.$inferSelect;
export type SheetWriteLog = typeof sheetWriteLogTable.$inferSelect;
