import { pgTable, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { tasksTable } from "./tasks";

/**
 * Follow-up ("open loop") state for a task — kept in a side table so the
 * existing generated tasks API is untouched. A row exists when follow-up has
 * been turned on for the task; the daily nudge re-pings while needsFollowup is
 * true, the task is still open, and any snooze has elapsed.
 */
export const taskFollowupTable = pgTable("task_followup", {
  taskId: integer("task_id")
    .primaryKey()
    .references(() => tasksTable.id, { onDelete: "cascade" }),
  needsFollowup: boolean("needs_followup").notNull().default(true),
  snoozeUntil: timestamp("snooze_until", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TaskFollowup = typeof taskFollowupTable.$inferSelect;
