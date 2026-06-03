import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import { db, pushSubscriptionsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { getVapidPublicKey } from "../lib/web-push";

const router: IRouter = Router();

router.get("/push/vapid-key", requireAuth, async (_req: AuthRequest, res): Promise<void> => {
  res.json({ publicKey: getVapidPublicKey() });
});

const subscribeBody = z.object({
  subscription: z.object({
    endpoint: z.string().url(),
    keys: z.object({
      p256dh: z.string(),
      auth: z.string(),
    }),
    expirationTime: z.number().nullable().optional(),
  }),
});

router.post("/push/subscribe", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const parsed = subscribeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  const sub = parsed.data.subscription;
  await db
    .insert(pushSubscriptionsTable)
    .values({
      userId: user.id,
      endpoint: sub.endpoint,
      subscription: sub,
    })
    .onConflictDoUpdate({
      target: pushSubscriptionsTable.endpoint,
      set: { subscription: sub, userId: user.id },
    });

  res.json({ success: true });
});

router.delete("/push/subscribe", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const endpoint = (req.query.endpoint as string | undefined) ?? (req.body?.endpoint as string | undefined);
  if (!endpoint) {
    res.status(400).json({ error: "endpoint required" });
    return;
  }
  await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.endpoint, endpoint));
  res.json({ success: true });
});

export default router;
