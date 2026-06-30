import { pgTable, text, serial, timestamp, numeric, date, integer, boolean } from "drizzle-orm/pg-core";

/** Eviction case file attached to a property; moves through stages. */
export const evictionCasesTable = pgTable("eviction_cases", {
  id: serial("id").primaryKey(),
  propertyAddress: text("property_address").notNull(),
  tenantName: text("tenant_name").notNull(),
  doorloopLeaseId: text("doorloop_lease_id"),
  doorloopPropertyId: text("doorloop_property_id"),
  // Financial
  balanceAtFiling: numeric("balance_at_filing", { precision: 10, scale: 2 }),
  monthlyRent: numeric("monthly_rent", { precision: 10, scale: 2 }),
  balanceWrittenOff: numeric("balance_written_off", { precision: 10, scale: 2 }),
  writtenOffAt: timestamp("written_off_at", { withTimezone: true }),
  writtenOffNotes: text("written_off_notes"),
  // Status: notice_filed | awaiting_court_date | court_date_set | hearing_complete
  //         | judgment_issued | vacated | closed | dismissed
  status: text("status").notNull().default("notice_filed"),
  // Key dates
  noticeFiledDate: date("notice_filed_date"),
  noticeType: text("notice_type"), // '3_day' | '10_day'
  courtDate: date("court_date"),
  courtTime: text("court_time"),
  courtLocation: text("court_location"),
  hearingOutcome: text("hearing_outcome"),
  judgmentDate: date("judgment_date"),
  judgmentNotes: text("judgment_notes"),
  vacatedDate: date("vacated_date"),
  // Notice period (Ohio) + attorney filing
  noticeExpiryDate: date("notice_expiry_date"),
  noticePeriodExpired: boolean("notice_period_expired").default(false),
  attorneySentAt: timestamp("attorney_sent_at", { withTimezone: true }),
  attorneySentBy: text("attorney_sent_by"),
  contractDriveUrl: text("contract_drive_url"),
  contractDriveFileId: text("contract_drive_file_id"),
  contractFoundAt: timestamp("contract_found_at", { withTimezone: true }),
  // Metadata
  createdBy: text("created_by").notNull().default("jacob"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  notes: text("notes"),
});

export const evictionDocumentsTable = pgTable("eviction_documents", {
  id: serial("id").primaryKey(),
  evictionCaseId: integer("eviction_case_id").notNull().references(() => evictionCasesTable.id, { onDelete: "cascade" }),
  documentName: text("document_name").notNull(),
  documentType: text("document_type").notNull(), // notice_3day | notice_10day | account_balance | court_filing | summons | judgment | other
  driveUrl: text("drive_url"),
  driveFileId: text("drive_file_id"),
  // The file's own bytes (base64 data URL) + mime, stored in the DB so the
  // document is never lost and can be previewed/served by the app itself —
  // independent of Google Drive (Drive is a best-effort convenience copy).
  fileData: text("file_data"),
  mimeType: text("mime_type"),
  // Proof-of-service: the exact moment the photo was captured/posted.
  postedAt: timestamp("posted_at", { withTimezone: true }),
  uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  uploadedBy: text("uploaded_by").notNull().default("jacob"),
  notes: text("notes"),
});

export const evictionTimelineTable = pgTable("eviction_timeline", {
  id: serial("id").primaryKey(),
  evictionCaseId: integer("eviction_case_id").notNull().references(() => evictionCasesTable.id, { onDelete: "cascade" }),
  stage: text("stage").notNull(),
  stageDate: timestamp("stage_date", { withTimezone: true }).notNull().defaultNow(),
  notes: text("notes"),
  createdBy: text("created_by").notNull().default("jacob"),
});

export type EvictionCase = typeof evictionCasesTable.$inferSelect;
export type EvictionDocument = typeof evictionDocumentsTable.$inferSelect;
export type EvictionTimelineEntry = typeof evictionTimelineTable.$inferSelect;
