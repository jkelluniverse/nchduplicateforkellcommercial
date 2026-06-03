import { Router, type IRouter } from "express";
import { eq, sql, desc, asc } from "drizzle-orm";
import {
  db,
  tasksTable,
  taskCommentsTable,
  jobsTable,
  usersTable,
  activityTable,
} from "@workspace/db";
import {
  CreateTaskBody,
  UpdateTaskBody,
  CreateTaskCommentBody,
} from "@workspace/api-zod";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { notifyUser } from "../lib/web-push";
import { emit } from "../lib/socket";

const router: IRouter = Router();

function parseId(raw: string | string[]): number {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return parseInt(v, 10);
}

function isOverdue(dueDate: string | null | undefined): boolean {
  if (!dueDate) return false;
  return dueDate < new Date().toISOString().split("T")[0];
}

// Map legacy priority/status values to the new canonical ones for the API
// response. Existing rows in the DB may still have "high"/"medium"/"open".
function normalizePriority(p: string): "urgent" | "normal" | "low" {
  if (p === "urgent" || p === "high") return "urgent";
  if (p === "low") return "low";
  return "normal";
}
function normalizeStatus(s: string): "pending" | "in_progress" | "done" {
  if (s === "in_progress") return "in_progress";
  if (s === "done") return "done";
  return "pending";
}

// Map incoming canonical values back to whatever the DB column accepts.
// Since our schema enum allows both new and legacy values, we just store
// the canonical value going forward.
function dbPriority(p: string): "urgent" | "normal" | "low" {
  return normalizePriority(p);
}
function dbStatus(s: string): "pending" | "in_progress" | "done" {
  return normalizeStatus(s);
}

const ROLE_NAMES: Record<string, string> = {
  mike: "Mike",
  jack: "Jack",
  jacob: "Jacob",
};

interface SerializedTask {
  id: number;
  title: string;
  description: string | null;
  assignedTo: "mike" | "jack" | "jacob";
  assignedBy: "mike" | "jack" | "jacob" | null;
  propertyAddress: string | null;
  dueDate: string | null;
  priority: "urgent" | "normal" | "low";
  status: "pending" | "in_progress" | "done";
  linkedJobId: number | null;
  linkedJobNumber: string | null;
  createdBy: string;
  completedAt: string | null;
  createdAt: string;
  isOverdue: boolean;
  commentCount: number;
}

function serializeTask(
  t: typeof tasksTable.$inferSelect,
  jobNumber: string | null,
  commentCount: number,
): SerializedTask {
  const status = normalizeStatus(t.status);
  return {
    id: t.id,
    title: t.title,
    description: t.description,
    assignedTo: t.assignedTo,
    assignedBy: (t.assignedBy as "mike" | "jack" | "jacob" | null) ?? null,
    propertyAddress: t.propertyAddress,
    dueDate: t.dueDate,
    priority: normalizePriority(t.priority),
    status,
    linkedJobId: t.linkedJobId,
    linkedJobNumber: jobNumber,
    createdBy: t.createdBy,
    completedAt: t.completedAt ? t.completedAt.toISOString() : null,
    createdAt: t.createdAt.toISOString(),
    isOverdue: isOverdue(t.dueDate) && status !== "done",
    commentCount,
  };
}

router.get("/tasks", requireAuth, async (req, res): Promise<void> => {
  // Load the core tasks first with NO joins and NO subqueries — this must
  // always succeed, even if the `jobs` or `task_comments` tables on the
  // production DB have schema drift. Enrichment (linked job number,
  // comment count) is then attempted in separate try/catch blocks so a
  // failure in either degrades gracefully (null / 0) instead of 500'ing
  // the whole board.
  let tasks: (typeof tasksTable.$inferSelect)[];
  try {
    tasks = await db.select().from(tasksTable).orderBy(desc(tasksTable.createdAt));
  } catch (err) {
    req.log.error(
      {
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
        cause: err instanceof Error && "cause" in err ? err.cause : undefined,
      },
      "GET /api/tasks core SELECT failed",
    );
    throw err;
  }

  // Enrichment 1: linked job numbers (best-effort)
  const linkedJobIds = Array.from(
    new Set(tasks.map((t) => t.linkedJobId).filter((id): id is number => id != null)),
  );
  const jobNumberById = new Map<number, string>();
  if (linkedJobIds.length > 0) {
    try {
      const jobRows = await db
        .select({ id: jobsTable.id, jobNumber: jobsTable.jobNumber })
        .from(jobsTable)
        .where(sql`${jobsTable.id} = ANY(${linkedJobIds})`);
      for (const j of jobRows) {
        if (j.jobNumber) jobNumberById.set(j.id, j.jobNumber);
      }
    } catch (err) {
      req.log.error(
        {
          err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
          cause: err instanceof Error && "cause" in err ? err.cause : undefined,
        },
        "GET /api/tasks job-number enrichment failed (degrading to null)",
      );
    }
  }

  // Enrichment 2: comment counts (best-effort)
  const commentCountByTask = new Map<number, number>();
  try {
    const counts = await db
      .select({
        taskId: taskCommentsTable.taskId,
        count: sql<number>`COUNT(*)::int`,
      })
      .from(taskCommentsTable)
      .groupBy(taskCommentsTable.taskId);
    for (const c of counts) {
      commentCountByTask.set(c.taskId, Number(c.count) || 0);
    }
  } catch (err) {
    req.log.error(
      {
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
        cause: err instanceof Error && "cause" in err ? err.cause : undefined,
      },
      "GET /api/tasks comment-count enrichment failed (degrading to 0)",
    );
  }

  let result = tasks.map((t) =>
    serializeTask(
      t,
      t.linkedJobId != null ? (jobNumberById.get(t.linkedJobId) ?? null) : null,
      commentCountByTask.get(t.id) ?? 0,
    ),
  );

  if (req.query.assignedTo) {
    result = result.filter((t) => t.assignedTo === req.query.assignedTo);
  }
  if (req.query.status) {
    result = result.filter((t) => t.status === req.query.status);
  }

  res.json(result);
});

router.post("/tasks", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  req.log.info(
    { body: req.body, user: req.user?.username },
    "POST /api/tasks received",
  );
  const parsed = CreateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    req.log.warn(
      { body: req.body, error: parsed.error.message },
      "POST /api/tasks validation failed",
    );
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const dueDateStr = parsed.data.dueDate
    ? (parsed.data.dueDate instanceof Date
        ? parsed.data.dueDate.toISOString().split("T")[0]
        : String(parsed.data.dueDate))
    : null;

  let task: typeof tasksTable.$inferSelect;
  try {
    [task] = await db
      .insert(tasksTable)
      .values({
        title: parsed.data.title,
        description: parsed.data.description || null,
        assignedTo: parsed.data.assignedTo,
        assignedBy: req.user!.role as "mike" | "jack" | "jacob",
        propertyAddress: parsed.data.propertyAddress || null,
        dueDate: dueDateStr,
        priority: dbPriority(parsed.data.priority),
        status: "pending",
        linkedJobId: parsed.data.linkedJobId || null,
        createdBy: req.user!.username,
      })
      .returning();
  } catch (err) {
    req.log.error(
      { err: err instanceof Error ? { message: err.message, stack: err.stack } : err, body: parsed.data },
      "POST /api/tasks db.insert(tasksTable) failed",
    );
    throw err;
  }

  try {
    await db.insert(activityTable).values({
      type: "task_created",
      description: `Task "${parsed.data.title}" assigned to ${parsed.data.assignedTo}`,
      user: req.user!.username,
      linkedEntity: "task",
      linkedId: task.id,
    });
  } catch (err) {
    // Activity log failure should not fail the whole request — task is
    // already persisted.  Log it so we can investigate separately.
    req.log.error(
      { err: err instanceof Error ? { message: err.message, stack: err.stack } : err, taskId: task.id },
      "POST /api/tasks activity insert failed (task already created)",
    );
  }

  // Push notify the assignee (unless they assigned to themselves)
  if (parsed.data.assignedTo !== req.user!.role) {
    void notifyUser(parsed.data.assignedTo, {
      title: `New task from ${ROLE_NAMES[req.user!.role] ?? req.user!.username}`,
      body: parsed.data.title,
      url: "/tasks",
    });
  }

  // Broadcast to all clients so badges / lists refresh in real time
  emit("task_created", { taskId: task.id, assignedTo: parsed.data.assignedTo });

  res.status(201).json(serializeTask(task, null, 0));
});

router.put("/tasks/:taskId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  await updateTaskHandler(req, res);
});

router.patch("/tasks/:taskId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  await updateTaskHandler(req, res);
});

async function updateTaskHandler(req: AuthRequest, res: Parameters<Parameters<typeof router.patch>[1]>[1]): Promise<void> {
  const taskId = parseId(req.params.taskId);
  if (isNaN(taskId)) {
    res.status(400).json({ error: "Invalid task ID" });
    return;
  }

  const parsed = UpdateTaskBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const update: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) update.title = parsed.data.title;
  if (parsed.data.description !== undefined) update.description = parsed.data.description;
  if (parsed.data.assignedTo !== undefined) update.assignedTo = parsed.data.assignedTo;
  if (parsed.data.propertyAddress !== undefined) update.propertyAddress = parsed.data.propertyAddress;
  if (parsed.data.linkedJobId !== undefined) update.linkedJobId = parsed.data.linkedJobId;
  if (parsed.data.priority !== undefined) update.priority = dbPriority(parsed.data.priority);
  if (parsed.data.dueDate !== undefined) {
    update.dueDate = parsed.data.dueDate
      ? (parsed.data.dueDate instanceof Date
          ? parsed.data.dueDate.toISOString().split("T")[0]
          : String(parsed.data.dueDate))
      : null;
  }
  if (parsed.data.status !== undefined) {
    const newStatus = dbStatus(parsed.data.status);
    update.status = newStatus;
    if (newStatus === "done") update.completedAt = new Date();
    else update.completedAt = null;
  }

  const [task] = await db.update(tasksTable).set(update).where(eq(tasksTable.id, taskId)).returning();
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }

  let linkedJobNumber: string | null = null;
  if (task.linkedJobId) {
    try {
      const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, task.linkedJobId));
      linkedJobNumber = job?.jobNumber ?? null;
    } catch (err) {
      req.log.error({ err, taskId }, "updateTaskHandler: jobs lookup failed (degrading to null)");
    }
  }
  let commentCount = 0;
  try {
    const [{ count }] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(taskCommentsTable)
      .where(eq(taskCommentsTable.taskId, taskId));
    commentCount = Number(count) || 0;
  } catch (err) {
    req.log.error({ err, taskId }, "updateTaskHandler: comment count failed (degrading to 0)");
  }

  emit("task_updated", { taskId: task.id, assignedTo: task.assignedTo });
  res.json(serializeTask(task, linkedJobNumber, commentCount));
}

router.put("/tasks/:taskId/complete", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const taskId = parseId(req.params.taskId);
  if (isNaN(taskId)) {
    res.status(400).json({ error: "Invalid task ID" });
    return;
  }
  const [task] = await db
    .update(tasksTable)
    .set({ status: "done", completedAt: new Date() })
    .where(eq(tasksTable.id, taskId))
    .returning();
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  let linkedJobNumber: string | null = null;
  if (task.linkedJobId) {
    try {
      const [job] = await db.select().from(jobsTable).where(eq(jobsTable.id, task.linkedJobId));
      linkedJobNumber = job?.jobNumber ?? null;
    } catch (err) {
      req.log.error({ err, taskId }, "completeTask: jobs lookup failed (degrading to null)");
    }
  }
  let commentCount = 0;
  try {
    const [{ count }] = await db
      .select({ count: sql<number>`COUNT(*)::int` })
      .from(taskCommentsTable)
      .where(eq(taskCommentsTable.taskId, taskId));
    commentCount = Number(count) || 0;
  } catch (err) {
    req.log.error({ err, taskId }, "completeTask: comment count failed (degrading to 0)");
  }

  try {
    await db.insert(activityTable).values({
      type: "task_completed",
      description: `Task "${task.title}" marked complete`,
      user: req.user!.username,
      linkedEntity: "task",
      linkedId: task.id,
    });
  } catch (err) {
    req.log.error({ err, taskId }, "completeTask: activity insert failed (task already completed)");
  }

  emit("task_updated", { taskId: task.id, assignedTo: task.assignedTo });
  res.json(serializeTask(task, linkedJobNumber, commentCount));
});

router.delete("/tasks/:taskId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const taskId = parseId(req.params.taskId);
  if (isNaN(taskId)) {
    res.status(400).json({ error: "Invalid task ID" });
    return;
  }
  const [task] = await db.delete(tasksTable).where(eq(tasksTable.id, taskId)).returning();
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  emit("task_deleted", { taskId });
  res.json({ success: true });
});

// ---- Comments ----

router.get("/tasks/:taskId/comments", requireAuth, async (req, res): Promise<void> => {
  const taskId = parseId(req.params.taskId);
  if (isNaN(taskId)) {
    res.status(400).json({ error: "Invalid task ID" });
    return;
  }
  try {
    const rows = await db
      .select({
        comment: taskCommentsTable,
        authorName: usersTable.name,
      })
      .from(taskCommentsTable)
      .leftJoin(usersTable, eq(usersTable.role, taskCommentsTable.authorRole))
      .where(eq(taskCommentsTable.taskId, taskId))
      .orderBy(asc(taskCommentsTable.createdAt));

    res.json(
      rows.map((r) => ({
        id: r.comment.id,
        taskId: r.comment.taskId,
        authorRole: r.comment.authorRole,
        authorName: r.authorName ?? ROLE_NAMES[r.comment.authorRole] ?? r.comment.authorRole,
        comment: r.comment.comment,
        createdAt: r.comment.createdAt.toISOString(),
      })),
    );
  } catch (err) {
    req.log.error(
      {
        err: err instanceof Error ? { message: err.message, stack: err.stack } : err,
        cause: err instanceof Error && "cause" in err ? err.cause : undefined,
        taskId,
      },
      "GET /tasks/:taskId/comments failed (returning empty array)",
    );
    // Return empty array instead of 500 so the task sheet still opens.
    // This happens when the task_comments table doesn't exist on Railway yet.
    res.json([]);
  }
});

router.post("/tasks/:taskId/comments", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const taskId = parseId(req.params.taskId);
  if (isNaN(taskId)) {
    res.status(400).json({ error: "Invalid task ID" });
    return;
  }
  const parsed = CreateTaskCommentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [task] = await db.select().from(tasksTable).where(eq(tasksTable.id, taskId));
  if (!task) {
    res.status(404).json({ error: "Task not found" });
    return;
  }
  const [c] = await db
    .insert(taskCommentsTable)
    .values({
      taskId,
      authorRole: req.user!.role as "mike" | "jack" | "jacob",
      comment: parsed.data.comment,
    })
    .returning();

  // Notify the assignee if they're not the commenter
  if (task.assignedTo !== req.user!.role) {
    void notifyUser(task.assignedTo, {
      title: `${ROLE_NAMES[req.user!.role] ?? req.user!.username} commented on a task`,
      body: `"${task.title}": ${parsed.data.comment.slice(0, 80)}`,
      url: "/tasks",
    });
  }

  emit("task_comment_added", { taskId, commentId: c.id });

  res.status(201).json({
    id: c.id,
    taskId: c.taskId,
    authorRole: c.authorRole,
    authorName: ROLE_NAMES[req.user!.role] ?? req.user!.role,
    comment: c.comment,
    createdAt: c.createdAt.toISOString(),
  });
});

export default router;
