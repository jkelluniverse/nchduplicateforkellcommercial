import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";

export const tenantApplicationsTable = pgTable("tenant_applications", {
  id: serial("id").primaryKey(),
  loginEmail: text("login_email").notNull(),
  propertyAddress: text("property_address").notNull(),
  viewedProperty: text("viewed_property", { enum: ["yes", "no"] }).notNull(),
  moveInDate: text("move_in_date").notNull(),
  fullLegalName: text("full_legal_name").notNull(),
  phone: text("phone").notNull(),
  contactEmail: text("contact_email").notNull(),
  employer: text("employer").notNull(),
  monthlyIncome: text("monthly_income").notNull(),
  occupants: text("occupants").notNull(),
  pets: text("pets").notNull().default(""),
  secondContact: text("second_contact").notNull().default(""),
  idFileUrl: text("id_file_url"),
  proofFileUrl: text("proof_file_url"),
  driveFolderUrl: text("drive_folder_url"),
  status: text("status", { enum: ["new", "approved", "declined", "pending"] }).notNull().default("new"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TenantApplication = typeof tenantApplicationsTable.$inferSelect;
