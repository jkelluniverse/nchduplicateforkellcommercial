import { Router, type IRouter } from "express";
import { eq, sql, and, gte } from "drizzle-orm";
import {
  db, jobsTable, tasksTable, appointmentsTable, messagesTable, messageReadsTable,
  expensesTable, invoicesTable, activityTable, placementsTable
} from "@workspace/db";
import { requireAuth, type AuthRequest } from "../middlewares/auth";

const router: IRouter = Router();

function isOverdue(dueDate: string | null | undefined): boolean {
  if (!dueDate) return false;
  return dueDate < new Date().toISOString().split("T")[0];
}

router.get("/dashboard/summary", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userRole = req.user!.role;
  const today = new Date().toISOString().split("T")[0];

  const activeJobs = await db.select().from(jobsTable)
    .where(sql`${jobsTable.status} IN ('estimate', 'deposit_received', 'in_progress', 'invoiced')`);

  let taskQuery = db.select().from(tasksTable)
    .where(sql`${tasksTable.status} != 'done'`);

  const allTasks = await taskQuery;
  const myTasks = allTasks.filter((t) => t.assignedTo === userRole);
  const todaysTasks = myTasks.filter((t) => {
    if (!t.dueDate) return false;
    return t.dueDate <= today;
  });

  const allAppointments = await db.select().from(appointmentsTable)
    .where(sql`date(${appointmentsTable.startTime}) = ${today}::date`);

  const totalMessages = await db.select({ count: sql<number>`count(*)` }).from(messagesTable)
    .where(sql`${messagesTable.authorRole} != ${userRole}`);

  const readMessages = await db.select({ count: sql<number>`count(*)` }).from(messageReadsTable)
    .where(eq(messageReadsTable.userRole, userRole as "mike" | "jack" | "jacob"));

  const unreadMessages = Math.max(0, (Number(totalMessages[0]?.count) || 0) - (Number(readMessages[0]?.count) || 0));

  const overdueTasks = myTasks.filter((t) => isOverdue(t.dueDate) && t.status !== "done");
  const overBudgetJobs = activeJobs.filter((j) => j.isOverBudget);

  const unsortedExpenses = await db.select({ count: sql<number>`count(*)` }).from(expensesTable)
    .where(eq(expensesTable.status, "unsorted"));

  const unpaidInvoices = await db.select({ count: sql<number>`count(*)` }).from(invoicesTable)
    .where(eq(invoicesTable.status, "unpaid"));

  const recentJobs = activeJobs.slice(0, 5);

  res.json({
    activeJobsCount: activeJobs.length,
    todaysTasks: todaysTasks.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      assignedTo: t.assignedTo,
      dueDate: t.dueDate,
      priority: t.priority,
      status: t.status,
      linkedJobId: t.linkedJobId,
      linkedJobNumber: null,
      createdBy: t.createdBy,
      createdAt: t.createdAt,
      isOverdue: isOverdue(t.dueDate) && t.status !== "done",
    })),
    todaysAppointments: allAppointments.map((a) => ({
      id: a.id,
      title: a.title,
      startTime: a.startTime,
      endTime: a.endTime,
      location: a.location,
      notes: a.notes,
      attendees: a.attendees,
      linkedJobId: a.linkedJobId,
      linkedJobNumber: null,
      createdBy: a.createdBy,
      ownerRole: a.ownerRole,
      createdAt: a.createdAt,
    })),
    unreadMessages,
    overdueTasksCount: overdueTasks.length,
    overBudgetJobsCount: overBudgetJobs.length,
    unsortedExpensesCount: Number(unsortedExpenses[0]?.count) || 0,
    unpaidInvoicesCount: Number(unpaidInvoices[0]?.count) || 0,
    recentJobs: recentJobs.map((j) => ({
      id: j.id,
      jobNumber: j.jobNumber,
      client: j.client,
      address: j.address,
      description: j.description,
      status: j.status,
      estimateAmount: Number(j.estimateAmount),
      depositAmount: Number(j.depositAmount),
      totalCosts: Number(j.totalCosts),
      marginPercent: Number(j.estimateAmount) > 0
        ? Math.round(((Number(j.estimateAmount) - Number(j.totalCosts)) / Number(j.estimateAmount)) * 100)
        : 0,
      isOverBudget: j.isOverBudget,
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
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

router.get("/financial/summary", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userRole = req.user!.role;
  const isFullAccess = userRole === "jacob";

  const year = new Date().getFullYear();
  const month = new Date().getMonth() + 1;
  const monthStart = `${year}-${String(month).padStart(2, "0")}-01`;

  const activeJobs = await db.select({ count: sql<number>`count(*)` }).from(jobsTable)
    .where(sql`${jobsTable.status} IN ('estimate', 'deposit_received', 'in_progress', 'invoiced')`);

  const unpaidInvoices = await db.select().from(invoicesTable)
    .where(eq(invoicesTable.status, "unpaid"));
  const outstandingTotal = unpaidInvoices.reduce((sum, inv) => sum + Number(inv.balanceDue), 0);

  const ytdPlacements = await db.select().from(placementsTable)
    .where(sql`${placementsTable.placementDate} >= ${year + '-01-01'}`);
  const ytdIconnRevenue = ytdPlacements.reduce((sum, p) => sum + Number(p.amount), 0);

  const healthStatus = outstandingTotal > 10000 ? "attention_needed" : "healthy";

  if (!isFullAccess) {
    res.json({
      healthStatus,
      isFullAccess: false,
      monthlyRevenue: null,
      monthlyExpenses: null,
      netCashPosition: null,
      outstandingInvoicesTotal: null,
      activeJobsCount: Number(activeJobs[0]?.count) || 0,
      ytdIconnPlacements: ytdPlacements.length,
      ytdIconnRevenue,
    });
    return;
  }

  const completedJobs = await db.select().from(jobsTable)
    .where(sql`${jobsTable.status} IN ('paid', 'complete', 'closed') AND ${jobsTable.updatedAt} >= ${monthStart}::timestamp`);
  const monthlyRevenue = completedJobs.reduce((sum, j) => sum + Number(j.totalCosts), 0);

  const monthExpenses = await db.select().from(expensesTable)
    .where(sql`${expensesTable.createdAt} >= ${monthStart}::timestamp`);
  const monthlyExpenses = monthExpenses.reduce((sum, e) => sum + Number(e.amount), 0);

  res.json({
    healthStatus,
    isFullAccess: true,
    monthlyRevenue,
    monthlyExpenses,
    netCashPosition: monthlyRevenue - monthlyExpenses,
    outstandingInvoicesTotal: outstandingTotal,
    activeJobsCount: Number(activeJobs[0]?.count) || 0,
    ytdIconnPlacements: ytdPlacements.length,
    ytdIconnRevenue,
  });
});

export default router;
