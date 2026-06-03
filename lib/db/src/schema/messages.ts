import { pgTable, text, serial, timestamp, integer, boolean, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { jobsTable } from "./jobs";
import { usersTable } from "./users";

export const messagesTable = pgTable(
  "messages",
  {
    id: serial("id").primaryKey(),
    content: text("content"),
    author: text("author").notNull(),
    authorRole: text("author_role", { enum: ["mike", "jack", "jacob"] }).notNull(),
    messageType: text("message_type", {
      enum: ["text", "image", "file", "link", "voice", "audio"],
    })
      .notNull()
      .default("text"),
    mentions: text("mentions").array().notNull().default([]),
    linkedJobId: integer("linked_job_id").references(() => jobsTable.id),
    attachmentUrl: text("attachment_url"),
    attachmentName: text("attachment_name"),
    attachmentSize: integer("attachment_size"),
    attachmentMime: text("attachment_mime"),
    attachmentMeta: jsonb("attachment_meta"),
    driveSaved: boolean("drive_saved").notNull().default(false),
    driveUrl: text("drive_url"),
    replyToId: integer("reply_to_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => [
    index("messages_created_at_idx").on(t.createdAt),
  ],
);

export const messageReadsTable = pgTable(
  "message_reads",
  {
    id: serial("id").primaryKey(),
    messageId: integer("message_id").notNull().references(() => messagesTable.id, { onDelete: "cascade" }),
    userRole: text("user_role", { enum: ["mike", "jack", "jacob"] }).notNull(),
    readAt: timestamp("read_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("message_reads_unique").on(t.messageId, t.userRole),
  ],
);

export const messageReactionsTable = pgTable(
  "message_reactions",
  {
    id: serial("id").primaryKey(),
    messageId: integer("message_id").notNull().references(() => messagesTable.id, { onDelete: "cascade" }),
    userRole: text("user_role", { enum: ["mike", "jack", "jacob"] }).notNull(),
    emoji: text("emoji").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("message_reactions_message_idx").on(t.messageId),
    uniqueIndex("message_reactions_unique").on(t.messageId, t.userRole, t.emoji),
  ],
);

export const pushSubscriptionsTable = pgTable("push_subscriptions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  endpoint: text("endpoint").notNull().unique(),
  subscription: jsonb("subscription").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertMessageSchema = createInsertSchema(messagesTable).omit({ id: true, createdAt: true });
export type InsertMessage = z.infer<typeof insertMessageSchema>;
export type Message = typeof messagesTable.$inferSelect;
export type MessageReaction = typeof messageReactionsTable.$inferSelect;
export type PushSubscription = typeof pushSubscriptionsTable.$inferSelect;
