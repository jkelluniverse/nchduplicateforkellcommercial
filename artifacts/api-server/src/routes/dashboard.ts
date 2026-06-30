import { Router, type IRouter } from "express";
import { sql, gte } from "drizzle-orm";
import { db, tasksTable, activityTable } from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { getLiveRentStatus } from "../services/rent-source";
import { getOverrideMap } from "../services/rent-overrides";

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

  // Live rent snapshot — Google Sheet ledger (preferred) or Rentec. Falls back
  // to zeros when no source is configured/reachable so the dashboard still loads.
  const now = new Date();
  const live = await getLiveRentStatus(now.getMonth() + 1, now.getFullYear());
  const snapshot = live?.data ?? null;

  // Exclude manually-resolved (override) properties from the headline counts and
  // rent roll, exactly as the Rent Collection widget does, so the two agree.
  const overrides = snapshot
    ? await getOverrideMap(now.getMonth() + 1, now.getFullYear()).catch(() => new Map())
    : new Map();
  const rows = (snapshot?.rows ?? []).filter((r) => !overrides.has(r.address));
  const pastDueRows = rows.filter((r) => r.status === "unpaid" || r.status === "late" || r.status === "partial" || r.status === "delinquent");
  const delinquentRows = rows.filter((r) => r.status === "delinquent");
  const currentRows = rows.filter((r) => r.status === "paid");
  // "Expected" = owes this month's rent but its (custom) due day hasn't arrived
  // yet. Counted separately so it inflates neither paid nor past-due.
  const expectedRows = rows.filter((r) => r.status === "upcoming");
  // Expected = full rent roll of occupied properties. Collected = rent received
  // this month. Remaining starts at the full roll and shrinks as people pay.
  const expectedThisMonth = rows.reduce((sum, r) => sum + (r.monthlyRent || 0), 0);
  const collectedThisMonth = rows.reduce((sum, r) => sum + (r.amountPaid || 0), 0);
  // Use each row's real past-due balance so this ties out to the Ledger.
  const pastDueAmount = pastDueRows.reduce((sum, r) => sum + (r.pastDueAmount || 0), 0);
  const remainingThisMonth = Math.max(0, expectedThisMonth - collectedThisMonth);

  res.json({
    rent: {
      live: snapshot !== null,
      source: live?.source ?? null,
      fetchedAt: snapshot?.fetchedAt ?? null,
      leaseCount: rows.length,
      propertyCount: snapshot?.uniquePropertyCount ?? 0,
      currentCount: currentRows.length,
      pastDueCount: pastDueRows.length,
      delinquentCount: delinquentRows.length,
      expectedCount: expectedRows.length,
      expectedThisMonthAmount: Math.round(expectedRows.reduce((s, r) => s + (r.monthlyRent || 0), 0) * 100) / 100,
      pastDueAmount: Math.round(pastDueAmount * 100) / 100,
      expectedThisMonth: Math.round(expectedThisMonth * 100) / 100,
      collectedThisMonth: Math.round(collectedThisMonth * 100) / 100,
      remainingThisMonth: Math.round(remainingThisMonth * 100) / 100,
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
