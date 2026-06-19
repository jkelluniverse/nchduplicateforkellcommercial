import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Drawer, DrawerContent, DrawerTitle } from "@/components/ui/drawer";
import { SheetButtonRow } from "@/components/sheet-button-row";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Phone, Mail, FileText, DollarSign } from "lucide-react";
import { formatPhone } from "@/lib/utils";
import { fetchPropertyHistory, fmtMoney2, rentKeys } from "./api";
import type { RentRow, RentStatusValue } from "./types";
import { LogPaymentForm } from "./log-payment-form";
import { useAuth } from "@/lib/auth";

interface Props {
  propertyId: number | null;
  currentMonth: number;
  currentYear: number;
  onClose: () => void;
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

const STATUS_COLOR: Record<RentStatusValue, string> = {
  paid: "text-green-700 bg-green-50",
  unpaid: "text-red-700 bg-red-50",
  late: "text-amber-700 bg-amber-50",
  delinquent: "text-[#B23A2E] bg-red-100",
  partial: "text-amber-700 bg-amber-50",
  upcoming: "text-blue-700 bg-blue-50",
  returned_payment: "text-amber-800 bg-amber-100",
};

export function DetailSheet({ propertyId, currentMonth, currentYear, onClose }: Props) {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const [showLogPayment, setShowLogPayment] = useState(false);

  const open = propertyId !== null;
  const isJacob = user?.role === "jacob";

  const { data, isLoading } = useQuery({
    queryKey: propertyId ? rentKeys.property(propertyId) : ["rent-status", "property", "none"],
    queryFn: () => fetchPropertyHistory(propertyId!),
    enabled: open,
  });

  const currentMonthRow: RentRow | undefined = useMemo(() => {
    return data?.history.find((h) => h.month === currentMonth && h.year === currentYear);
  }, [data, currentMonth, currentYear]);

  const lastThree = useMemo(() => (data?.history ?? []).slice(0, 3), [data]);

  const handleSendNotice = () => {
    if (!data || !currentMonthRow) return;
    const days = currentMonthRow.daysOverdue;
    // 30+ days overdue (a full missed rent cycle) escalates to Notice of
    // Default; anything less uses the 10-day notice.
    const docType: "ten_day_notice" | "notice_of_default" =
      days >= 30 ? "notice_of_default" : "ten_day_notice";

    const periodLabel = new Date(currentYear, currentMonth - 1, 1).toLocaleString("en-US", {
      month: "long",
      year: "numeric",
    });

    const totalDue = currentMonthRow.monthlyRent + currentMonthRow.lateFeeDue;

    const prefill: Record<string, string | number> = {
      tenant_name: data.property.tenantName ?? data.contact.residentName ?? "",
      property_address: data.property.address,
      past_rent_amount: currentMonthRow.monthlyRent,
      rent_period: periodLabel,
      late_fees: currentMonthRow.lateFeeDue,
      default_amount: totalDue,
      seller_signatory: "",
    };

    sessionStorage.setItem(
      "nch_doc_prefill",
      JSON.stringify({ doc_type: docType, prefill }),
    );
    onClose();
    setLocation("/docs");
  };

  const handleCallTenant = () => {
    if (data?.contact.phone) {
      window.location.href = `tel:${data.contact.phone.replace(/[^\d+]/g, "")}`;
    }
  };

  return (
    <Drawer open={open} onOpenChange={(o) => { if (!o) { onClose(); setShowLogPayment(false); } }}>
      <DrawerContent className="px-4 pb-6 max-h-[90vh] overflow-y-auto">
        <DrawerTitle className="sr-only">Property rent detail</DrawerTitle>

        {isLoading || !data ? (
          <div className="py-6 space-y-3">
            <Skeleton className="h-6 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-32 w-full" />
          </div>
        ) : showLogPayment && currentMonthRow ? (
          <div className="pt-2">
            <h2 className="text-lg font-bold mb-1">Log Payment</h2>
            <p className="text-sm text-muted-foreground mb-4 truncate">{data.property.address}</p>
            <LogPaymentForm
              propertyId={data.property.id}
              month={currentMonth}
              year={currentYear}
              defaultAmount={currentMonthRow.monthlyRent}
              lateFeeDue={currentMonthRow.lateFeeDue}
              onSaved={() => { setShowLogPayment(false); onClose(); }}
              onCancel={() => setShowLogPayment(false)}
            />
          </div>
        ) : (
          <>
            <div className="pt-2">
              <h2 className="text-lg font-bold leading-tight">{data.property.address}</h2>
              <p className="text-sm text-muted-foreground mt-0.5">
                {data.property.tenantName ?? data.contact.residentName ?? "No tenant on file"}
              </p>
            </div>

            {/* Contact actions */}
            <div className="grid grid-cols-2 gap-2 mt-4">
              <a
                href={data.contact.phone ? `tel:${data.contact.phone.replace(/[^\d+]/g, "")}` : undefined}
                className={`flex items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-sm font-medium ${
                  data.contact.phone ? "hover:bg-muted" : "opacity-50 pointer-events-none"
                }`}
              >
                <Phone className="w-4 h-4 text-primary shrink-0" />
                <span className="truncate">{data.contact.phone ? formatPhone(data.contact.phone) : "No phone"}</span>
              </a>
              <a
                href={data.contact.email ? `mailto:${data.contact.email}` : undefined}
                className={`flex items-center gap-2 rounded-lg border border-border px-3 py-2.5 text-sm font-medium ${
                  data.contact.email ? "hover:bg-muted" : "opacity-50 pointer-events-none"
                }`}
              >
                <Mail className="w-4 h-4 text-primary shrink-0" />
                <span className="truncate">{data.contact.email ?? "No email"}</span>
              </a>
            </div>

            {/* Current month */}
            {currentMonthRow && (
              <div className="mt-4 rounded-xl border border-border p-4">
                <div className="flex items-center justify-between">
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {new Date(currentYear, currentMonth - 1, 1).toLocaleString("en-US", { month: "long", year: "numeric" })}
                  </p>
                  <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${STATUS_COLOR[currentMonthRow.status]}`}>
                    {STATUS_LABEL[currentMonthRow.status]}
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-3">
                  <div>
                    <p className="text-xs text-muted-foreground">Monthly Rent</p>
                    <p className="text-base font-bold">{fmtMoney2(currentMonthRow.monthlyRent)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-muted-foreground">Amount Paid</p>
                    <p className="text-base font-bold">{fmtMoney2(currentMonthRow.amountPaid)}</p>
                  </div>
                  {currentMonthRow.lateFeeDue > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground">Late Fee Due</p>
                      <p className="text-base font-bold text-amber-700">
                        {fmtMoney2(currentMonthRow.lateFeeDue)}
                      </p>
                    </div>
                  )}
                  {currentMonthRow.daysOverdue > 0 && (
                    <div>
                      <p className="text-xs text-muted-foreground">Days Overdue</p>
                      <p className="text-base font-bold text-[#B23A2E]">{currentMonthRow.daysOverdue}</p>
                    </div>
                  )}
                </div>
                {currentMonthRow.paymentDate && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Paid on {currentMonthRow.paymentDate}
                  </p>
                )}
              </div>
            )}

            {/* Last 3 months */}
            {lastThree.length > 0 && (
              <div className="mt-4">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 px-1">
                  Recent Payment History
                </p>
                <div className="space-y-1.5">
                  {lastThree.map((h) => (
                    <div
                      key={h.id}
                      className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2"
                    >
                      <div>
                        <p className="text-sm font-medium">
                          {new Date(h.year, h.month - 1, 1).toLocaleString("en-US", { month: "short", year: "numeric" })}
                        </p>
                        {h.paymentDate && (
                          <p className="text-xs text-muted-foreground">Paid {h.paymentDate}</p>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold">{fmtMoney2(h.amountPaid)}</p>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${STATUS_COLOR[h.status]}`}>
                          {STATUS_LABEL[h.status]}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Action buttons */}
            <div className="sticky bottom-0 bg-background pt-3 mt-5" style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 80px)" }}>
            <div className="grid grid-cols-3 gap-2">
              {isJacob ? (
                <Button
                  variant="default"
                  size="sm"
                  className="flex-col h-auto py-3"
                  onClick={() => setShowLogPayment(true)}
                  disabled={!currentMonthRow}
                >
                  <DollarSign className="w-4 h-4 mb-1" />
                  <span className="text-xs">Log Payment</span>
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  className="flex-col h-auto py-3 opacity-50"
                  disabled
                  title="Jacob only"
                >
                  <DollarSign className="w-4 h-4 mb-1" />
                  <span className="text-xs">Log Payment</span>
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                className="flex-col h-auto py-3"
                onClick={handleSendNotice}
                disabled={!currentMonthRow}
              >
                <FileText className="w-4 h-4 mb-1" />
                <span className="text-xs">Send Notice</span>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="flex-col h-auto py-3"
                onClick={handleCallTenant}
                disabled={!data.contact.phone}
              >
                <Phone className="w-4 h-4 mb-1" />
                <span className="text-xs">Call Tenant</span>
              </Button>
            </div>
            </div>
          </>
        )}
      </DrawerContent>
    </Drawer>
  );
}
