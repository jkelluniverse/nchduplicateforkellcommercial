/**
 * Open Loops — fast task capture (quick-add) + follow-up flags/snooze + the
 * daily nudge settings. Decoupled from the generated tasks API so the capture
 * and nudge slice can evolve independently.
 */
import { Router, type IRouter } from "express";
import { and, eq, ne, desc } from "drizzle-orm";
import { db, tasksTable, taskFollowupTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { logger } from "../lib/logger";
import { getNudgeSettings, setNudgeSettings } from "../lib/followup-nudge";

const router: IRouter = Router();

type Role = "mike" | "jack" | "jacob";

// POST /api/quick-task — frictionless capture of an ask into Jacob's board.
router.post("/quick-task", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const body = (req.body ?? {}) as { title?: string; description?: string; source?: string };
  const title = (body.title ?? "").trim();
  if (!title) {
    res.status(400).json({ error: "title is required" });
    return;
  }
  try {
    const [task] = await db
      .insert(tasksTable)
      .values({
        title: title.slice(0, 200),
        description: body.description?.trim() || null,
        assignedTo: "jacob",
        assignedBy: (req.user?.role as Role) ?? "jacob",
        priority: "normal",
        status: "pending",
        createdBy: req.user?.username ?? req.user?.role ?? "jacob",
      })
      .returning();

    // Quick-added (and auto-captured) tasks default to follow-up ON.
    await db
      .insert(taskFollowupTable)
      .values({ taskId: task.id, needsFollowup: true })
      .onConflictDoNothing();

    res.status(201).json({ id: task.id, title: task.title });
  } catch (err) {
    logger.error({ err }, "POST /quick-task failed");
    res.status(500).json({ error: "Failed to create task" });
  }
});

// PUT /api/tasks/:id/followup — toggle follow-up on/off for a task.
router.put("/tasks/:id/followup", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!id || isNaN(id)) {
    res.status(400).json({ error: "Invalid task id" });
    return;
  }
  const needsFollowup = (req.body ?? {}).needsFollowup !== false;
  try {
    await db
      .insert(taskFollowupTable)
      .values({ taskId: id, needsFollowup })
      .onConflictDoUpdate({
        target: taskFollowupTable.taskId,
        set: { needsFollowup, snoozeUntil: null },
      });
    res.json({ ok: true, needsFollowup });
  } catch (err) {
    logger.error({ err }, "PUT /tasks/:id/followup failed");
    res.status(500).json({ error: "Failed to update follow-up" });
  }
});

// POST /api/tasks/:id/snooze — suppress the nudge until tomorrow.
router.post("/tasks/:id/snooze", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!id || isNaN(id)) {
    res.status(400).json({ error: "Invalid task id" });
    return;
  }
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);
  try {
    await db
      .insert(taskFollowupTable)
      .values({ taskId: id, needsFollowup: true, snoozeUntil: tomorrow })
      .onConflictDoUpdate({
        target: taskFollowupTable.taskId,
        set: { needsFollowup: true, snoozeUntil: tomorrow },
      });
    res.json({ ok: true, snoozeUntil: tomorrow.toISOString() });
  } catch (err) {
    logger.error({ err }, "POST /tasks/:id/snooze failed");
    res.status(500).json({ error: "Failed to snooze" });
  }
});

// GET /api/followups — all of Jacob's open follow-up tasks (for the Open Loops UI).
router.get("/followups", requireAuth, async (_req, res): Promise<void> => {
  try {
    const rows = await db
      .select({
        id: tasksTable.id,
        title: tasksTable.title,
        status: tasksTable.status,
        createdAt: tasksTable.createdAt,
        snoozeUntil: taskFollowupTable.snoozeUntil,
      })
      .from(taskFollowupTable)
      .innerJoin(tasksTable, eq(tasksTable.id, taskFollowupTable.taskId))
      .where(
        and(
          eq(taskFollowupTable.needsFollowup, true),
          eq(tasksTable.assignedTo, "jacob"),
          ne(tasksTable.status, "done"),
        ),
      )
      .orderBy(desc(tasksTable.createdAt));

    const now = Date.now();
    res.json(
      rows.map((r) => ({
        id: r.id,
        title: r.title,
        ageDays: Math.max(0, Math.floor((now - r.createdAt.getTime()) / 86_400_000)),
        snoozedUntil: r.snoozeUntil ? r.snoozeUntil.toISOString() : null,
      })),
    );
  } catch (err) {
    logger.error({ err }, "GET /followups failed");
    res.status(500).json({ error: "Failed to load follow-ups" });
  }
});

// GET/PUT /api/nudge-settings — daily nudge time + digest preference.
router.get("/nudge-settings", requireAuth, async (_req, res): Promise<void> => {
  res.json(await getNudgeSettings());
});

router.put("/nudge-settings", requireAuth, async (req, res): Promise<void> => {
  const body = (req.body ?? {}) as { time?: string; digest?: boolean };
  res.json(await setNudgeSettings({ time: body.time, digest: body.digest }));
});

// POST /api/task-intake/email — forward-to-task webhook (the email fallback for
// auto-capture). PUBLIC but secret-gated (email services can't log in). Point a
// provider that posts JSON/urlencoded (Postmark, a Cloudflare Email Worker, a
// Zapier/Make email-parser, etc.) at this URL with ?key=<TASK_INTAKE_SECRET>.
router.post("/task-intake/email", async (req, res): Promise<void> => {
  const secret = process.env["TASK_INTAKE_SECRET"];
  if (!secret) {
    res.status(503).json({ error: "Task intake not configured (set TASK_INTAKE_SECRET)" });
    return;
  }
  const provided =
    (typeof req.query.key === "string" ? req.query.key : "") ||
    req.get("x-intake-secret") ||
    "";
  if (provided !== secret) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const b = (req.body ?? {}) as Record<string, unknown>;
  const pick = (...keys: string[]): string => {
    for (const k of keys) {
      const v = b[k];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
    return "";
  };
  // Tolerant of common provider field names (Postmark, Mailgun, generic JSON).
  const subject = pick("subject", "Subject");
  const text = pick("text", "TextBody", "plain", "body-plain", "stripped-text", "body");
  const from = pick("from", "From", "sender", "FromFull");

  const title = (subject || text.split("\n")[0] || "Forwarded note").slice(0, 200).trim();
  if (!title) {
    res.status(400).json({ error: "Empty message" });
    return;
  }
  const description =
    [from ? `From: ${from}` : null, text].filter(Boolean).join("\n\n").slice(0, 5000) || null;

  try {
    const [task] = await db
      .insert(tasksTable)
      .values({
        title,
        description,
        assignedTo: "jacob",
        priority: "normal",
        status: "pending",
        createdBy: "email-intake",
      })
      .returning();
    await db
      .insert(taskFollowupTable)
      .values({ taskId: task.id, needsFollowup: true })
      .onConflictDoNothing();
    res.status(201).json({ id: task.id });
  } catch (err) {
    logger.error({ err }, "POST /task-intake/email failed");
    res.status(500).json({ error: "Failed to create task" });
  }
});

export default router;
