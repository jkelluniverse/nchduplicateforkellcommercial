import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { RefreshCw, History, ChevronRight, CircleAlert as AlertCircle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { fetchRentSummary, fetchRentDetail, fmtMoney, rentKeys } from "./api";
import type { RentRow, RentSummary } from "./types";
import { DetailSheet } from "./detail-sheet";
import { HistoryModal } from "./history-modal";
import { PaymentSituationsSection } from "./payment-notes";

const NEEDS_ATTENTION_LIMIT = 6;

export function RentStatusWidget() {
  const qc = useQueryClient();
  const [selectedPropertyId, setSelectedPropertyId] = useState<number | null>(null);
  const [showAll, setShowAll] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const summaryQ = useQuery({
    queryKey: rentKeys.summary(),
    queryFn: fetchRentSummary,
    refetchInterval: 5 * 60 * 1000,
  });

  const detailQ = useQuery({
    queryKey: rentKeys.detail(),
    queryFn: fetchRentDetail,
    refetchInterval: 5 * 60 * 1000,
  });

  const summary = summaryQ.data;
  const rows = detailQ.data ?? [];

  const needsAttention = useMemo<RentRow[]>(
    () => rows.filter((r) => r.status === "delinquent" && r.daysOverdue >= 30),
    [rows],
  );
  const visibleAttention = showAll
    ? needsAttention
    : needsAttention.slice(0, NEEDS_ATTENTION_LIMIT);
  const hiddenCount = needsAttention.length - visibleAttention.length;

  const handleRefresh = () => {
    void qc.invalidateQueries({ queryKey: rentKeys.all });
  };

  if (summaryQ.isLoading || !summary) {
    return (
      <Card className="border-0 shadow-sm">
        <CardContent className="p-4 space-y-3">
          <Skeleton className="h-6 w-1/2" />
          <div className="grid grid-cols-3 gap-2">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
          <Skeleton className="h-10 w-full" />
        </CardContent>
      </Card>
    );
  }

  // "Late" = paid in full but after the 10-day grace period. The money is
  // collected, so we roll it into the PAID card for the dashboard view.
  const paidCount = summary.paid.count + summary.late.count;
  const paidCollected = summary.paid.total_collected + summary.late.total_collected;
  const lateFeesCollected = summary.late.late_fees_collected;

  return (
    <>
      <Card className="border-0 shadow-sm overflow-hidden">
        <CardContent className="p-4 space-y-4">
          {/* Header */}
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold">Rent Collection</h2>
                {summary.source === "rentec" && (
                  <span
                    className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-100 px-1.5 py-0.5 rounded"
                    title="Live data pulled from Rentec Direct"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    Live · Rentec
                  </span>
                )}
              </div>
              <span className="text-sm text-muted-foreground font-medium">{summary.month}</span>
            </div>
            <div className="flex items-center justify-between mt-0.5">
              <p className="text-xs text-muted-foreground">
                Updated {formatDistanceToNow(new Date(summary.last_updated_at), { addSuffix: true })}
              </p>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setHistoryOpen(true)}
                  className="text-xs font-medium text-primary flex items-center gap-1"
                >
                  <History className="w-3 h-3" />
                  History
                </button>
                <button
                  type="button"
                  onClick={handleRefresh}
                  className="text-xs font-medium text-muted-foreground flex items-center gap-1 hover:text-foreground"
                  aria-label="Refresh"
                >
                  <RefreshCw className={`w-3 h-3 ${summaryQ.isFetching ? "animate-spin" : ""}`} />
                  Refresh
                </button>
              </div>
            </div>
          </div>

          {/* 3-column stat grid */}
          <div className="grid grid-cols-3 gap-2">
            <StatCard
              borderColor="border-l-green-500"
              icon="✅"
              label="PAID"
              countColor="text-green-600"
              count={paidCount}
              line1={`${fmtMoney(paidCollected)} collected`}
              line2={lateFeesCollected > 0 ? `${fmtMoney(lateFeesCollected)} fees paid` : undefined}
            />
            <StatCard
              borderColor="border-l-red-500"
              icon="❌"
              label="UNPAID"
              countColor="text-red-600"
              count={summary.unpaid.count}
              line1={`${fmtMoney(summary.unpaid.total_outstanding)} outstanding`}
              line2={summary.unpaid.late_fees_outstanding > 0 ? `${fmtMoney(summary.unpaid.late_fees_outstanding)} fees due` : undefined}
            />
            <StatCard
              borderColor="border-l-[#B23A2E]"
              icon="🔴"
              label="DELINQUENT"
              countColor="text-[#B23A2E]"
              count={summary.delinquent.count}
              line1={`${fmtMoney(summary.delinquent.total_outstanding)} outstanding`}
              line2={summary.delinquent.avg_days_overdue > 0 ? `Avg ${summary.delinquent.avg_days_overdue} days over` : undefined}
            />
          </div>

          {/* Collection rate */}
          <CollectionRate summary={summary} />

          {/* Late-fee empty state — Late-fee charges, when present, post on the
              11th, so before then we show a small note to explain the zero. */}
          {summary.source === "rentec" &&
            summary.unpaid.late_fees_outstanding === 0 &&
            summary.late.late_fees_collected === 0 &&
            new Date().getDate() < 11 && (
              <p className="text-[11px] text-muted-foreground italic px-0.5 -mt-1">
                Late fees post on the 11th of each month
              </p>
            )}

          {/* Needs Attention */}
          <div className="border-t border-border pt-3" id="needs-attention">
            <div className="flex items-center gap-1.5 mb-0.5 px-0.5">
              <AlertCircle className="w-4 h-4 text-[#B23A2E]" />
              <h3 className="text-sm font-bold text-[#B23A2E]">Needs Attention</h3>
            </div>
            <p className="text-[11px] text-muted-foreground px-0.5 mb-2">
              30+ days past due — notice eligible
            </p>
            {needsAttention.length === 0 ? (
              <p className="text-sm text-green-600 px-0.5 py-2">
                No properties currently 30+ days past due
              </p>
            ) : (
              <>
                <div className="space-y-1">
                  {visibleAttention.map((r) => (
                    <button
                      key={r.id}
                      type="button"
                      onClick={() => setSelectedPropertyId(r.propertyId)}
                      className="w-full flex items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-muted/60 active:bg-muted transition-colors"
                    >
                      <span className="w-2 h-2 rounded-full shrink-0 bg-[#B23A2E]" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{r.address}</p>
                        <p className="text-xs text-muted-foreground truncate">
                          {r.tenantName ?? "Unknown tenant"}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold">
                          {fmtMoney(r.monthlyRent + r.lateFeeDue)}
                        </p>
                        <p className="text-[10px] font-bold text-[#B23A2E]">
                          {r.daysOverdue}d over
                        </p>
                      </div>
                      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    </button>
                  ))}
                </div>
                {hiddenCount > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowAll(true)}
                    className="text-xs font-medium text-primary mt-2 px-0.5"
                  >
                    View all {needsAttention.length} →
                  </button>
                )}
              </>
            )}
          </div>
          {/* Payment Situations */}
          <PaymentSituationsSection />
        </CardContent>
      </Card>

      <DetailSheet
        propertyId={selectedPropertyId}
        currentMonth={summary.monthNum}
        currentYear={summary.year}
        onClose={() => setSelectedPropertyId(null)}
      />

      <HistoryModal
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        initialMonth={summary.monthNum}
        initialYear={summary.year}
      />
    </>
  );
}

function StatCard({
  borderColor,
  icon,
  label,
  countColor,
  count,
  line1,
  line2,
}: {
  borderColor: string;
  icon: string;
  label: string;
  countColor: string;
  count: number;
  line1: string;
  line2?: string;
}) {
  return (
    <div className={`bg-card rounded-lg border border-border border-l-4 ${borderColor} p-2.5 min-w-0`}>
      <div className="flex items-center gap-1">
        <span aria-hidden className="text-xs">{icon}</span>
        <p className="text-[9px] font-bold text-muted-foreground tracking-wider">{label}</p>
      </div>
      <p className={`text-2xl font-bold mt-0.5 leading-tight ${countColor}`}>{count}</p>
      <p className="text-[10px] text-muted-foreground leading-tight mt-0.5">
        {count === 1 ? "property" : "properties"}
      </p>
      <p className="text-[10px] font-medium text-foreground leading-tight mt-1 truncate">{line1}</p>
      {line2 && <p className="text-[10px] text-muted-foreground leading-tight truncate">{line2}</p>}
    </div>
  );
}

function CollectionRate({ summary }: { summary: RentSummary }) {
  const rate = summary.collection_rate;
  const color =
    rate > 80 ? "bg-green-500" : rate >= 50 ? "bg-amber-500" : "bg-red-500";
  const labelColor =
    rate > 80 ? "text-green-700" : rate >= 50 ? "text-amber-700" : "text-red-700";
  return (
    <div>
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Collection Rate — Month to Date
        </p>
        <p className={`text-xs font-bold ${labelColor}`}>{rate}%</p>
      </div>
      <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full transition-all ${color}`}
          style={{ width: `${Math.min(100, Math.max(0, rate))}%` }}
        />
      </div>
      <p className="text-xs text-muted-foreground mt-1">
        {fmtMoney(summary.total_collected_mtd)} of {fmtMoney(summary.total_expected)} expected
      </p>
    </div>
  );
}
