import { useAuth } from "@/lib/auth";
import { useGetDashboardSummary, useGetActivity, getGetDashboardSummaryQueryKey, getGetActivityQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format, formatDistanceToNow } from "date-fns";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { Briefcase, CheckSquare, Plus, Receipt, Search, FileText, ChevronRight, AlertCircle, Clock, CheckCircle2, CheckCircle, AlertTriangle, XCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { RentStatusWidget } from "@/features/rent-status/widget";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function useSyncStatus() {
  return useQuery({
    queryKey: ["sync-status"],
    queryFn: async () => {
      const token = localStorage.getItem("nch_token");
      const res = await fetch(`${API_BASE}/api/sync-status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch sync status");
      return res.json() as Promise<{
        lastSyncAt: string | null;
        pendingCount: number;
        recentLogs: Array<{ id: number; triggerName: string; tabName: string; status: string; createdAt: string; errorMessage: string | null }>;
      }>;
    },
    refetchInterval: 60_000,
  });
}

function useDoorLoopStatus() {
  return useQuery({
    queryKey: ["doorloop-status"],
    queryFn: async () => {
      const token = localStorage.getItem("nch_token");
      const res = await fetch(`${API_BASE}/api/doorloop/status`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to fetch DoorLoop status");
      return res.json() as Promise<{
        ok: boolean;
        enabled: boolean;
        hasToken: boolean;
        propertyCount?: number;
        leaseCount?: number;
        paymentsThisMonth?: number;
        message?: string;
        fetchedAt?: string;
      }>;
    },
    refetchInterval: 5 * 60 * 1000,
  });
}

function DoorLoopStatusBadge() {
  const { data, isLoading } = useDoorLoopStatus();
  if (isLoading) return null;
  if (!data) return null;
  const healthy = data.ok && data.enabled && data.hasToken;
  const partial = data.hasToken && data.ok && !data.enabled;
  const color = healthy ? "text-emerald-600 bg-emerald-100" : partial ? "text-amber-700 bg-amber-100" : "text-red-700 bg-red-100";
  const label = healthy
    ? `DoorLoop · ${data.leaseCount ?? 0} leases`
    : partial
      ? "DoorLoop reachable (USE_DOORLOOP=false)"
      : data.hasToken
        ? "DoorLoop unreachable"
        : "DoorLoop · token not set";
  return (
    <Card className="border-0 shadow-sm overflow-hidden">
      <CardContent className="p-3">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-bold uppercase tracking-wider ${color}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${healthy ? "bg-emerald-500 animate-pulse" : partial ? "bg-amber-500" : "bg-red-500"}`} />
              {label}
            </span>
          </div>
          {healthy && data.paymentsThisMonth !== undefined && (
            <span className="text-muted-foreground">{data.paymentsThisMonth} payments this month</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function SyncStatusWidget() {
  const { data, isLoading, refetch } = useSyncStatus();
  const [expanded, setExpanded] = useState(false);

  if (isLoading) return <Skeleton className="h-16 w-full rounded-xl" />;

  const lastSync = data?.lastSyncAt ? new Date(data.lastSyncAt) : null;
  const minutesAgo = lastSync ? (Date.now() - lastSync.getTime()) / 60_000 : Infinity;
  const pending = data?.pendingCount ?? 0;

  const color =
    minutesAgo < 5 ? "text-green-600" :
    minutesAgo < 30 ? "text-amber-600" :
    "text-red-600";

  const Icon =
    minutesAgo < 5 ? CheckCircle :
    minutesAgo < 30 ? AlertTriangle :
    XCircle;

  return (
    <Card className="border-0 shadow-sm overflow-hidden">
      <CardContent className="p-4">
        <div
          role="button"
          tabIndex={0}
          className="w-full flex items-center justify-between cursor-pointer"
          onClick={() => setExpanded(!expanded)}
          onKeyDown={(e) => e.key === "Enter" && setExpanded(!expanded)}
        >
          <div className="flex items-center gap-2">
            <Icon className={`w-4 h-4 ${color}`} />
            <span className="text-sm font-medium">
              {lastSync
                ? `Sheets synced ${formatDistanceToNow(lastSync, { addSuffix: true })}`
                : "No sync yet today"}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {pending > 0 && (
              <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                {pending} pending
              </span>
            )}
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); refetch(); }}
              className="p-1 rounded hover:bg-muted"
            >
              <RefreshCw className="w-3.5 h-3.5 text-muted-foreground" />
            </button>
          </div>
        </div>

        {expanded && data?.recentLogs && data.recentLogs.length > 0 && (
          <div className="mt-3 space-y-1 border-t pt-3">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Last 10 writes</p>
            {data.recentLogs.map((log) => (
              <div key={log.id} className="flex items-center justify-between text-xs py-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${log.status === "success" ? "bg-green-500" : "bg-red-500"}`} />
                  <span className="truncate text-muted-foreground">{log.tabName}</span>
                </div>
                <span className="text-muted-foreground shrink-0 ml-2">
                  {formatDistanceToNow(new Date(log.createdAt), { addSuffix: true })}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { user } = useAuth();
  
  const { data: summary, isLoading: isSummaryLoading } = useGetDashboardSummary({
    query: { enabled: !!user, queryKey: getGetDashboardSummaryQueryKey() },
  });

  const { data: activity, isLoading: isActivityLoading } = useGetActivity(
    { limit: 5 },
    { query: { enabled: !!user, queryKey: getGetActivityQueryKey({ limit: 5 }) } },
  );

  if (!user) return null;

  return (
    <div className="pb-8">
      {/* Header */}
      <div className="bg-primary text-primary-foreground pt-12 pb-6 px-4 rounded-b-3xl shadow-md">
        <h1 className="text-3xl font-bold tracking-tight">Good morning, {user.name}</h1>
        <p className="text-primary-foreground/80 mt-1 font-medium">{format(new Date(), "EEEE, MMMM do")}</p>
        
        {/* Quick Actions */}
        <div className="grid grid-cols-2 gap-3 mt-6">
          {user.role === "jack" && (
            <>
              <Link href="/jobs/new" className="bg-white/10 hover:bg-white/20 active:bg-white/30 transition-colors p-3 rounded-xl flex items-center gap-3 border border-white/10 backdrop-blur-sm">
                <div className="bg-white/20 p-2 rounded-lg"><Plus className="w-5 h-5 text-white" /></div>
                <span className="font-semibold">New Job</span>
              </Link>
              <Link href="/jobs" className="bg-white/10 hover:bg-white/20 active:bg-white/30 transition-colors p-3 rounded-xl flex items-center gap-3 border border-white/10 backdrop-blur-sm">
                <div className="bg-white/20 p-2 rounded-lg"><Receipt className="w-5 h-5 text-white" /></div>
                <span className="font-semibold">Log Receipt</span>
              </Link>
            </>
          )}
          
          {user.role === "mike" && (
            <>
              <Link href="/properties" className="bg-white/10 hover:bg-white/20 active:bg-white/30 transition-colors p-3 rounded-xl flex items-center gap-3 border border-white/10 backdrop-blur-sm">
                <div className="bg-white/20 p-2 rounded-lg"><Search className="w-5 h-5 text-white" /></div>
                <span className="font-semibold">Properties</span>
              </Link>
            </>
          )}
          
          {user.role === "jacob" && (
            <>
              <Link href="/expenses" className="bg-white/10 hover:bg-white/20 active:bg-white/30 transition-colors p-3 rounded-xl flex items-center gap-3 border border-white/10 backdrop-blur-sm">
                <div className="bg-white/20 p-2 rounded-lg relative shrink-0">
                  <FileText className="w-5 h-5 text-white" />
                  {summary?.unsortedExpensesCount ? (
                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-amber-500 rounded-full border border-primary"></span>
                  ) : null}
                </div>
                <div>
                  <p className="font-semibold leading-tight">General Operating Expenses</p>
                  <p className="text-xs text-white/70 leading-tight mt-0.5">View &amp; Log general expenses. This is NOT for Job expenses</p>
                </div>
              </Link>
              <Link href="/invoices" className="bg-white/10 hover:bg-white/20 active:bg-white/30 transition-colors p-3 rounded-xl flex items-center gap-3 border border-white/10 backdrop-blur-sm">
                <div className="bg-white/20 p-2 rounded-lg relative shrink-0">
                  <Receipt className="w-5 h-5 text-white" />
                  {summary?.unpaidInvoicesCount ? (
                    <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-amber-500 rounded-full border border-primary"></span>
                  ) : null}
                </div>
                <div>
                  <p className="font-semibold leading-tight">Contractor Jobs</p>
                  <p className="text-xs text-white/70 leading-tight mt-0.5">Invoices &amp; Estimates</p>
                </div>
              </Link>
            </>
          )}
        </div>
      </div>

      <div className="p-4 space-y-6 -mt-2">
        {/* Rent Collection — visible to all roles */}
        <RentStatusWidget />

        {/* Stats row */}
        <div className="grid grid-cols-2 gap-3">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-muted-foreground">Active Jobs</p>
                <Briefcase className="w-4 h-4 text-primary" />
              </div>
              <p className="text-2xl font-bold mt-2">
                {isSummaryLoading ? <Skeleton className="h-8 w-8" /> : summary?.activeJobsCount || 0}
              </p>
              {summary?.overBudgetJobsCount ? (
                <p className="text-xs text-destructive font-medium mt-1 flex items-center">
                  <AlertCircle className="w-3 h-3 mr-1" />
                  {summary.overBudgetJobsCount} over budget
                </p>
              ) : null}
            </CardContent>
          </Card>
          
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-muted-foreground">Today's Tasks</p>
                <CheckSquare className="w-4 h-4 text-primary" />
              </div>
              <p className="text-2xl font-bold mt-2">
                {isSummaryLoading ? <Skeleton className="h-8 w-8" /> : (summary?.todaysTasks?.length || 0)}
              </p>
              {summary?.overdueTasksCount ? (
                <p className="text-xs text-amber-600 font-medium mt-1 flex items-center">
                  <Clock className="w-3 h-3 mr-1" />
                  {summary.overdueTasksCount} overdue
                </p>
              ) : null}
            </CardContent>
          </Card>
        </div>

        {/* Tasks Section */}
        <div>
          <div className="flex items-center justify-between mb-3 px-1">
            <h2 className="text-lg font-bold">Tasks for Today</h2>
            <Link href="/tasks" className="text-sm font-medium text-primary flex items-center">
              View all <ChevronRight className="w-4 h-4" />
            </Link>
          </div>
          
          {isSummaryLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-16 w-full rounded-xl" />
              <Skeleton className="h-16 w-full rounded-xl" />
            </div>
          ) : summary?.todaysTasks && summary.todaysTasks.length > 0 ? (
            <div className="space-y-3">
              {summary.todaysTasks.map(task => (
                <div key={task.id} className="bg-card rounded-xl p-3 shadow-sm border border-border flex items-start gap-3">
                  <div className="mt-0.5">
                    {task.status === "done" ? (
                      <CheckCircle2 className="w-5 h-5 text-green-500" />
                    ) : (
                      <div className="w-5 h-5 rounded-full border-2 border-muted-foreground"></div>
                    )}
                  </div>
                  <div className="flex-1">
                    <p className={`font-medium ${task.status === 'done' ? 'text-muted-foreground line-through' : ''}`}>
                      {task.title}
                    </p>
                    {task.linkedJobNumber && (
                      <p className="text-xs text-muted-foreground mt-1">Job #{task.linkedJobNumber}</p>
                    )}
                  </div>
                  {task.priority === "urgent" && (
                    <span className="w-2 h-2 rounded-full bg-destructive mt-1.5"></span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <Card className="border-dashed bg-muted/50">
              <CardContent className="p-6 text-center text-muted-foreground">
                <CheckSquare className="w-8 h-8 mx-auto mb-2 opacity-50" />
                <p>No tasks scheduled for today.</p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Sheets Sync Status — Jacob only */}
        {user.role === "jacob" && (
          <div>
            <div className="flex items-center justify-between mb-3 px-1">
              <h2 className="text-lg font-bold">System Status</h2>
            </div>
            <div className="space-y-2">
              <DoorLoopStatusBadge />
              <SyncStatusWidget />
            </div>
          </div>
        )}

        {/* Activity Feed */}
        <div>
          <div className="flex items-center justify-between mb-3 px-1">
            <h2 className="text-lg font-bold">Recent Activity</h2>
          </div>
          
          <Card className="border-0 shadow-sm overflow-hidden">
            {isActivityLoading ? (
              <div className="p-4 space-y-4">
                {[1, 2, 3].map(i => (
                  <div key={i} className="flex gap-3">
                    <Skeleton className="w-8 h-8 rounded-full shrink-0" />
                    <div className="space-y-2 flex-1">
                      <Skeleton className="h-4 w-3/4" />
                      <Skeleton className="h-3 w-1/4" />
                    </div>
                  </div>
                ))}
              </div>
            ) : activity && activity.length > 0 ? (
              <div className="divide-y divide-border">
                {activity.map(item => (
                  <div key={item.id} className="p-4 flex gap-3">
                    <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 font-bold text-xs">
                      {item.user.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm">
                        <span className="font-semibold">{item.user}</span> {item.description}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">
                        {format(new Date(item.createdAt), "MMM d, h:mm a")}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 text-center text-muted-foreground">
                <p>No recent activity.</p>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
