import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { fetchRentMonths, fetchRentMonthHistory, fmtMoney, rentKeys } from "./api";
import type { RentStatusValue } from "./types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialMonth: number;
  initialYear: number;
}

const STATUS_LABEL: Record<RentStatusValue, string> = {
  paid: "Paid",
  unpaid: "Unpaid",
  late: "Late",
  delinquent: "Delinquent",
  partial: "Partial",
  upcoming: "Expected",
  returned_payment: "Returned",
};

const STATUS_DOT: Record<RentStatusValue, string> = {
  paid: "bg-green-500",
  unpaid: "bg-red-500",
  late: "bg-amber-500",
  delinquent: "bg-[#B23A2E]",
  partial: "bg-amber-400",
  upcoming: "bg-blue-500",
  returned_payment: "bg-amber-500",
};

export function HistoryModal({ open, onOpenChange, initialMonth, initialYear }: Props) {
  const [month, setMonth] = useState(initialMonth);
  const [year, setYear] = useState(initialYear);

  useEffect(() => {
    if (open) {
      setMonth(initialMonth);
      setYear(initialYear);
    }
  }, [open, initialMonth, initialYear]);

  const { data: months } = useQuery({
    queryKey: rentKeys.months(),
    queryFn: fetchRentMonths,
    enabled: open,
  });

  const { data, isLoading } = useQuery({
    queryKey: rentKeys.history(month, year),
    queryFn: () => fetchRentMonthHistory(month, year),
    enabled: open,
  });

  const summary = data?.summary;
  const collectionColor = summary
    ? summary.collection_rate > 80
      ? "bg-green-500"
      : summary.collection_rate >= 50
        ? "bg-amber-500"
        : "bg-red-500"
    : "bg-muted";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto p-0">
        <DialogHeader className="p-4 pb-2 border-b border-border sticky top-0 bg-background z-10">
          <DialogTitle className="text-base font-bold">Rent Collection History</DialogTitle>
          <div className="mt-2">
            <Select
              value={`${month}-${year}`}
              onValueChange={(v) => {
                const [m, y] = v.split("-").map((s) => parseInt(s, 10));
                if (m && y) { setMonth(m); setYear(y); }
              }}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(months ?? []).map((opt) => (
                  <SelectItem key={`${opt.month}-${opt.year}`} value={`${opt.month}-${opt.year}`}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </DialogHeader>

        <div className="p-4 space-y-4">
          {isLoading || !summary ? (
            <>
              <Skeleton className="h-32 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-48 w-full" />
            </>
          ) : (
            <>
              {/* 2x2 stat grid (compact) */}
              <div className="grid grid-cols-2 gap-2">
                <StatCard
                  borderColor="border-l-green-500"
                  label="PAID"
                  countColor="text-green-600"
                  count={summary.paid.count}
                  line1={`${fmtMoney(summary.paid.total_collected)} collected`}
                />
                <StatCard
                  borderColor="border-l-amber-500"
                  label="LATE"
                  countColor="text-amber-600"
                  count={summary.late.count}
                  line1={`${fmtMoney(summary.late.total_collected)} collected`}
                  line2={`${fmtMoney(summary.late.late_fees_collected)} fees`}
                />
                <StatCard
                  borderColor="border-l-red-500"
                  label="UNPAID"
                  countColor="text-red-600"
                  count={summary.unpaid.count}
                  line1={`${fmtMoney(summary.unpaid.total_outstanding)} due`}
                  line2={summary.unpaid.late_fees_outstanding > 0 ? `${fmtMoney(summary.unpaid.late_fees_outstanding)} fees` : undefined}
                />
                <StatCard
                  borderColor="border-l-[#B23A2E]"
                  label="DELINQUENT"
                  countColor="text-[#B23A2E]"
                  count={summary.delinquent.count}
                  line1={`${fmtMoney(summary.delinquent.total_outstanding)} due`}
                  line2={summary.delinquent.avg_days_overdue > 0 ? `Avg ${summary.delinquent.avg_days_overdue}d over` : undefined}
                />
              </div>

              {/* Collection rate */}
              <div>
                <div className="flex items-center justify-between mb-1.5">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Collection Rate
                  </p>
                  <p className="text-xs font-bold">{summary.collection_rate}%</p>
                </div>
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className={`h-full transition-all ${collectionColor}`}
                    style={{ width: `${Math.min(100, Math.max(0, summary.collection_rate))}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {fmtMoney(summary.total_collected_mtd)} of {fmtMoney(summary.total_expected)} expected
                </p>
              </div>

              {/* Property list */}
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                  All Properties
                </p>
                <div className="rounded-xl border border-border divide-y divide-border overflow-hidden">
                  {data!.rows.map((r) => (
                    <div key={r.id} className="flex items-center gap-3 px-3 py-2.5">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[r.status]}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{r.address}</p>
                        {r.tenantName && (
                          <p className="text-xs text-muted-foreground truncate">{r.tenantName}</p>
                        )}
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-semibold">{fmtMoney(r.amountPaid)}</p>
                        <p className="text-[10px] text-muted-foreground">{STATUS_LABEL[r.status]}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StatCard({
  borderColor,
  label,
  countColor,
  count,
  line1,
  line2,
}: {
  borderColor: string;
  label: string;
  countColor: string;
  count: number;
  line1: string;
  line2?: string;
}) {
  return (
    <div className={`bg-card rounded-lg border border-border border-l-4 ${borderColor} p-2.5`}>
      <p className="text-[10px] font-bold text-muted-foreground tracking-wide">{label}</p>
      <p className={`text-lg font-bold mt-0.5 ${countColor}`}>{count}</p>
      <p className="text-[10px] text-muted-foreground leading-tight">{line1}</p>
      {line2 && <p className="text-[10px] text-muted-foreground leading-tight">{line2}</p>}
    </div>
  );
}
