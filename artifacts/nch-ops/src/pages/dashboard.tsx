import { useAuth } from "@/lib/auth";
import { useGetDashboardSummary, useGetActivity, getGetDashboardSummaryQueryKey, getGetActivityQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { format } from "date-fns";
import { Link } from "wouter";
import { Skeleton } from "@/components/ui/skeleton";
import { CheckSquare, ChevronRight, Clock, CheckCircle2, AlertTriangle, DollarSign, RefreshCw } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { RentStatusWidget } from "@/features/rent-status/widget";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function authHeaders(): HeadersInit {
  const token = localStorage.getItem("kc_token");
  return { Authorization: `Bearer ${token}` };
}

interface RentecStatus {
  ok: boolean;
  hasToken: boolean;
  reachable?: boolean;
  propertyCount?: number;
  leaseCount?: number;
  message?: string;
  fetchedAt?: string;
}

function useRentecStatus() {
  return useQuery({
    queryKey: ["rentec-status"],
    queryFn: async () => {
      const res = await fetch(`${API_BASE}/api/rentec/status`, { headers: authHeaders() });
      if (!res.ok) throw new Error("Failed to fetch Rentec status");
      return res.json() as Promise<RentecStatus>;
    },
    refetchInterval: 5 * 60 * 1000,
  });
}

function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
}

function RentecStatusBar() {
  const { data, isLoading } = useRentecStatus();
  const qc = useQueryClient();
  const refresh = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${API_BASE}/api/rentec/sync`, { method: "POST", headers: authHeaders() });
      if (!res.ok) throw new Error("Refresh failed");
      return res.json();
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ["rentec-status"] });
      qc.invalidateQueries();
    },
  });

  if (isLoading || !data) return null;
  const healthy = data.ok && data.hasToken;
  const color = healthy ? "text-emerald-700 bg-emerald-100" : data.hasToken ? "text-amber-700 bg-amber-100" : "text-red-700 bg-red-100";
  const dot = healthy ? "bg-emerald-500 animate-pulse" : data.hasToken ? "bg-amber-500" : "bg-red-500";
  const label = healthy
    ? `Rentec · ${data.leaseCount ?? 0} leases`
    : data.hasToken
      ? "Rentec unreachable"
      : "Rentec · API key not set";

  return (
    <Card className="border-0 shadow-sm overflow-hidden">
      <CardContent className="p-3">
        <div className="flex items-center justify-between text-xs">
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded font-bold uppercase tracking-wider ${color}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
            {label}
          </span>
          <button
            type="button"
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending}
            className="inline-flex items-center gap-1 px-2 py-1 rounded hover:bg-muted text-muted-foreground font-medium"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refresh.isPending ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function Dashboard() {
  const { user } = useAuth();

  const { data: summaryRaw, isLoading: isSummaryLoading } = useGetDashboardSummary({
    query: { enabled: !!user, queryKey: getGetDashboardSummaryQueryKey() },
  });
  const summary = summaryRaw as unknown as {
    rent?: { live: boolean; source?: string | null; leaseCount: number; propertyCount: number; currentCount: number; pastDueCount: number; delinquentCount: number; pastDueAmount: number; expectedThisMonth?: number; collectedThisMonth?: number; remainingThisMonth?: number };
    overdueTasksCount?: number;
    todaysTasks?: Array<{ id: number; title: string; status: string; priority: string }>;
  } | undefined;

  const { data: activity, isLoading: isActivityLoading } = useGetActivity(
    { limit: 5 },
    { query: { enabled: !!user, queryKey: getGetActivityQueryKey({ limit: 5 }) } },
  );

  if (!user) return null;

  const rent = summary?.rent;

  return (
    <div className="pb-8">
      {/* Brand header — centered logo on a clean cream bar with a red→gold rule */}
      <div className="bg-cream px-4 pt-10 pb-4 rounded-b-3xl shadow-sm border-b border-border">
        <img
          src={`${import.meta.env.BASE_URL}assets/kellcommercial-logo.svg`}
          alt="Kell Commercial Leasing"
          className="h-16 w-auto mx-auto block"
        />
        <div className="mt-3 h-1 w-full rounded-full bg-gradient-to-r from-transparent via-gold to-transparent" />
        <p className="text-sm text-muted-foreground mt-2 font-medium text-center">
          {format(new Date(), "EEEE, MMMM do")}
        </p>

        {/* Monthly collection headline — expected this month, shrinking as rent comes in */}
        <div className="mt-4 bg-primary text-primary-foreground rounded-2xl p-4 shadow-md">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-primary-foreground/80 text-sm font-medium">
              <DollarSign className="w-4 h-4" /> Remaining to collect
            </div>
            <span className="text-xs text-primary-foreground/70 font-medium">{format(new Date(), "MMMM")}</span>
          </div>
          <p className="text-4xl font-extrabold mt-1 tabular-nums">
            {isSummaryLoading ? "—" : fmtMoney(rent?.remainingThisMonth ?? rent?.pastDueAmount ?? 0)}
          </p>
          <p className="text-primary-foreground/80 text-sm mt-1">
            {isSummaryLoading
              ? " "
              : `${fmtMoney(rent?.collectedThisMonth ?? 0)} collected of ${fmtMoney(rent?.expectedThisMonth ?? 0)} expected`}
          </p>
          {/* Collection progress */}
          {!isSummaryLoading && (rent?.expectedThisMonth ?? 0) > 0 && (
            <div className="mt-3 h-2 w-full rounded-full bg-primary-foreground/20 overflow-hidden">
              <div
                className="h-full bg-gold transition-all"
                style={{
                  width: `${Math.min(100, Math.max(0, ((rent?.collectedThisMonth ?? 0) / (rent?.expectedThisMonth || 1)) * 100))}%`,
                }}
              />
            </div>
          )}
          <p className="text-primary-foreground/70 text-xs mt-2">
            {isSummaryLoading ? " " : `${rent?.currentCount ?? 0} paid · ${rent?.pastDueCount ?? 0} outstanding`}
          </p>
        </div>
      </div>

      <div className="p-4 space-y-6">
        {/* Rentec connection + manual Refresh */}
        <RentecStatusBar />

        {/* Live rent collection */}
        <RentStatusWidget />

        {/* Stats row */}
        <div className="grid grid-cols-2 gap-3">
          <Card className="border-0 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-muted-foreground">Delinquent</p>
                <AlertTriangle className="w-4 h-4 text-primary" />
              </div>
              <p className="text-2xl font-bold mt-2">
                {isSummaryLoading ? <Skeleton className="h-8 w-8" /> : rent?.delinquentCount ?? 0}
              </p>
              <p className="text-xs text-muted-foreground mt-1">30+ days overdue</p>
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
              {summary.todaysTasks.map((task) => (
                <div key={task.id} className="bg-card rounded-xl p-3 shadow-sm border border-border flex items-start gap-3">
                  <div className="mt-0.5">
                    {task.status === "done" ? (
                      <CheckCircle2 className="w-5 h-5 text-green-500" />
                    ) : (
                      <div className="w-5 h-5 rounded-full border-2 border-muted-foreground"></div>
                    )}
                  </div>
                  <div className="flex-1">
                    <p className={`font-medium ${task.status === "done" ? "text-muted-foreground line-through" : ""}`}>
                      {task.title}
                    </p>
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

        {/* Activity Feed */}
        <div>
          <div className="flex items-center justify-between mb-3 px-1">
            <h2 className="text-lg font-bold">Recent Activity</h2>
          </div>

          <Card className="border-0 shadow-sm overflow-hidden">
            {isActivityLoading ? (
              <div className="p-4 space-y-4">
                {[1, 2, 3].map((i) => (
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
                {activity.map((item) => (
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
