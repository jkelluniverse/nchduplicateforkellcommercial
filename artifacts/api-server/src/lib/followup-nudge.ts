/**
 * Daily "open loops" follow-up nudge for Jacob.
 *
 * While a task is flagged needs_followup, still open, and not snoozed, it
 * generates one push per day at the configured time (default 08:00 server
 * time). Digest mode (default on) groups them into a single push to avoid
 * notification fatigue. The nudge stops the moment the task is completed.
 */
import { and, eq, ne, or, lte, isNull, sql } from "drizzle-orm";
import { db, tasksTable, taskFollowupTable, appSettingsTable } from "@workspace/db";
import { notifyUser } from "./web-push";
import { logger } from "./logger";

const KEY_TIME = "nudge_time";
const KEY_DIGEST = "nudge_digest";
const KEY_LAST_SENT = "nudge_last_sent";

const FOLLOWUP_URL = `${process.env.APP_URL || "https://app.kellcommercial.com"}/tasks?filter=followup`;

export interface NudgeSettings {
  time: string; // "HH:MM" (server local)
  digest: boolean;
}

export async function getSetting(key: string): Promise<string | null> {
  const [row] = await db.select().from(appSettingsTable).where(eq(appSettingsTable.key, key));
  return row?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(appSettingsTable)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: appSettingsTable.key, set: { value, updatedAt: new Date() } });
}

export async function getNudgeSettings(): Promise<NudgeSettings> {
  const [time, digest] = await Promise.all([getSetting(KEY_TIME), getSetting(KEY_DIGEST)]);
  return { time: time ?? "08:00", digest: digest == null ? true : digest === "true" };
}

export async function setNudgeSettings(s: Partial<NudgeSettings>): Promise<NudgeSettings> {
  if (s.time !== undefined && /^\d{2}:\d{2}$/.test(s.time)) await setSetting(KEY_TIME, s.time);
  if (s.digest !== undefined) await setSetting(KEY_DIGEST, s.digest ? "true" : "false");
  return getNudgeSettings();
}

export interface ActiveFollowup {
  id: number;
  title: string;
  ageDays: number;
}

/** Jacob's open, un-snoozed follow-up tasks, oldest first. */
export async function getActiveFollowups(): Promise<ActiveFollowup[]> {
  const rows = await db
    .select({ id: tasksTable.id, title: tasksTable.title, createdAt: tasksTable.createdAt })
    .from(taskFollowupTable)
    .innerJoin(tasksTable, eq(tasksTable.id, taskFollowupTable.taskId))
    .where(
      and(
        eq(taskFollowupTable.needsFollowup, true),
        eq(tasksTable.assignedTo, "jacob"),
        ne(tasksTable.status, "done"),
        or(isNull(taskFollowupTable.snoozeUntil), lte(taskFollowupTable.snoozeUntil, sql`NOW()`)),
      ),
    )
    .orderBy(tasksTable.createdAt);

  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    ageDays: Math.max(0, Math.floor((now - r.createdAt.getTime()) / 86_400_000)),
  }));
}

function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Called every minute; fires the nudge once when the clock hits the set time. */
export async function runFollowupNudgeIfDue(): Promise<void> {
  try {
    const { time, digest } = await getNudgeSettings();
    const m = /^(\d{2}):(\d{2})$/.exec(time);
    if (!m) return;
    const now = new Date();
    if (now.getHours() !== parseInt(m[1], 10) || now.getMinutes() !== parseInt(m[2], 10)) return;

    const today = localDateStr(now);
    if ((await getSetting(KEY_LAST_SENT)) === today) return;
    await setSetting(KEY_LAST_SENT, today); // claim the slot before doing work

    const active = await getActiveFollowups();
    if (active.length === 0) return;

    if (digest) {
      const titles = active.slice(0, 3).map((t) => t.title);
      const more = active.length > 3 ? ` +${active.length - 3} more` : "";
      const label = active.length === 1 ? "open follow-up" : "open follow-ups";
      await notifyUser("jacob", {
        title: `${active.length} ${label}`,
        body: `${titles.join(", ")}${more}`,
        url: FOLLOWUP_URL,
      });
    } else {
      for (const t of active) {
        await notifyUser("jacob", {
          title: "Still open",
          body: `${t.title} — opened ${t.ageDays} day${t.ageDays === 1 ? "" : "s"} ago`,
          url: FOLLOWUP_URL,
        });
      }
    }
    logger.info({ count: active.length, digest }, "Follow-up nudge sent");
  } catch (err) {
    logger.error({ err }, "runFollowupNudgeIfDue failed");
  }
}
