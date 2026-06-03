import { pgTable, serial, varchar, timestamp, json, text } from "drizzle-orm/pg-core";

export const docHistoryTable = pgTable("doc_history", {
  id: serial("id").primaryKey(),
  docType: varchar("doc_type", { length: 100 }).notNull(),
  docTitle: varchar("doc_title", { length: 255 }).notNull(),
  generatedBy: varchar("generated_by", { length: 50 }).notNull(),
  fieldData: json("field_data").notNull(),
  filename: varchar("filename", { length: 255 }).notNull(),
  driveUrl: varchar("drive_url", { length: 500 }),
  driveFileId: varchar("drive_file_id", { length: 255 }),
  driveFolder: varchar("drive_folder", { length: 500 }),
  generatedAt: timestamp("generated_at").defaultNow().notNull(),
});
