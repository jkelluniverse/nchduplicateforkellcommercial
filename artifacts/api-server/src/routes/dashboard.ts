import { Router, type IRouter } from "express";
import { sql, gte } from "drizzle-orm";
import { db, tasksTable, activityTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { getRentStatus } from "../services/rentec";

const router: IRouter = Router();

function isOverdue(dueDate: string | null | undefined): boolean {
  if (!dueDate) return false;
  return dueDate < new Date().toISOString().split("T")[0];
}

/**
 * Payment-focused dashboard summary for Kell Commercial. Surfaces "who is
 * current vs. past due, and by how much" plus the operator's open tasks.
 */
router.get("/dashboard/summary", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userRole = req.user!.role;
  const today = new Date().toISOString().split("T")[0];

  const allTasks = await db.select().from(tasksTable).where(sql`${tasksTable.status} != 'done'`);
  const myTasks = allTasks.filter((t) => t.assignedTo === userRole);
  const todaysTasks = myTasks.filter((t) => t.dueDate && t.dueDate <= today);
  const overdueTasks = myTasks.filter((t) => isOverdue(t.dueDate) && t.status !== "done");

  // Live rent snapshot from Rentec (read-only). Falls back to zeros when the
  // Rentec connection is not configured/reachable so the dashboard still loads.
  const now = new Date();
  const snapshot = await getRentStatus(now.getMonth() + 1, now.getFullYear());

  const rows = snapshot?.rows ?? [];
  const pastDueRows = rows.filter((r) => r.status === "unpaid" || r.status === "late" || r.status === "partial" || r.status === "delinquent");
  const delinquentRows = rows.filter((r) => r.status === "delinquent");
  const currentRows = rows.filter((r) => r.status === "paid");
  const pastDueAmount = pastDueRows.reduce(
    (sum, r) => sum + Math.max(0, (r.monthlyRent || 0) - (r.amountPaid || 0)) + (r.lateFeeDue || 0),
    0,
  );

  res.json({
    rent: {
      live: snapshot !== null,
      fetchedAt: snapshot?.fetchedAt ?? null,
      leaseCount: rows.length,
      propertyCount: snapshot?.uniquePropertyCount ?? 0,
      currentCount: currentRows.length,
      pastDueCount: pastDueRows.length,
      delinquentCount: delinquentRows.length,
      pastDueAmount: Math.round(pastDueAmount * 100) / 100,
    },
    overdueTasksCount: overdueTasks.length,
    todaysTasks: todaysTasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      assignedTo: t.assignedTo,
      dueDate: t.dueDate,
      priority: t.priority,
      status: t.status,
      createdBy: t.createdBy,
      createdAt: t.createdAt,
      isOverdue: isOverdue(t.dueDate) && t.status !== "done",
    })),
  });
});

router.get("/activity", requireAuth, async (req, res): Promise<void> => {
  const limit = Number(req.query.limit) || 20;
  const yesterday = new Date();
  yesterday.setHours(yesterday.getHours() - 24);

  const activity = await db.select().from(activityTable)
    .where(gte(activityTable.createdAt, yesterday))
    .orderBy(sql`${activityTable.createdAt} DESC`)
    .limit(limit);

  res.json(activity);
});

export default router;
