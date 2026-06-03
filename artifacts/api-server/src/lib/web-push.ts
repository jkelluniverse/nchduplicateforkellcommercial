import webpush from "web-push";
import { db, pushSubscriptionsTable, usersTable } from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { logger } from "./logger";
import { isUserOnline } from "./socket";

let configured = false;

function ensureConfigured(): boolean {
  if (configured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY;
  const priv = process.env.VAPID_PRIVATE_KEY;
  const subj = process.env.VAPID_SUBJECT || "mailto:admin@kellcommercial.com";
  if (!pub || !priv) {
    logger.warn("VAPID keys not configured; push notifications disabled");
    return false;
  }
  webpush.setVapidDetails(subj, pub, priv);
  configured = true;
  return true;
}

export function getVapidPublicKey(): string {
  return process.env.VAPID_PUBLIC_KEY ?? "";
}

export interface NotifyPayload {
  title: string;
  body: string;
  icon?: string;
  url?: string;
  messageId?: number;
}

/**
 * Send a push notification to all currently-OFFLINE users in the team
 * (everyone except the sender).
 */
export async function notifyOfflineUsers(
  senderRole: string,
  payload: NotifyPayload,
): Promise<void> {
  if (!ensureConfigured()) return;

  const team: Array<"mike" | "jack" | "jacob"> = ["mike", "jack", "jacob"];
  const offline = team.filter((r) => r !== senderRole && !isUserOnline(r));
  if (offline.length === 0) return;

  const users = await db.select().from(usersTable).where(inArray(usersTable.role, offline));
  if (users.length === 0) return;

  const subs = await db
    .select()
    .from(pushSubscriptionsTable)
    .where(inArray(pushSubscriptionsTable.userId, users.map((u) => u.id)));

  const json = JSON.stringify(payload);

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(s.subscription as webpush.PushSubscription, json);
      } catch (err: any) {
        const status = err?.statusCode;
        if (status === 404 || status === 410) {
          await db
            .delete(pushSubscriptionsTable)
            .where(eq(pushSubscriptionsTable.id, s.id))
            .catch(() => {});
        } else {
          logger.warn({ err, status }, "Push send failed");
        }
      }
    }),
  );
}

/**
 * Send a push notification to a specific user by role, regardless of
 * online/offline state. Used for task assignments where we always want
 * to notify the assignee.
 */
export async function notifyUser(
  role: "mike" | "jack" | "jacob",
  payload: NotifyPayload,
): Promise<void> {
  if (!ensureConfigured()) return;

  const [user] = await db.select().from(usersTable).where(eq(usersTable.role, role));
  if (!user) return;

  const subs = await db
    .select()
    .from(pushSubscriptionsTable)
    .where(eq(pushSubscriptionsTable.userId, user.id));

  if (subs.length === 0) return;
  const json = JSON.stringify(payload);

  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(s.subscription as webpush.PushSubscription, json);
      } catch (err: any) {
        const status = err?.statusCode;
        if (status === 404 || status === 410) {
          await db
            .delete(pushSubscriptionsTable)
            .where(eq(pushSubscriptionsTable.id, s.id))
            .catch(() => {});
        } else {
          logger.warn({ err, status }, "Push send failed");
        }
      }
    }),
  );
}
