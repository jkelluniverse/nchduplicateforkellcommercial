import { useEffect, useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronLeft, Plus, Scale, ChevronRight, X } from "lucide-react";
import { listEvictions, createEviction, evictionsKey, type EvictionCase } from "@/features/evictions/api";
import { fetchRentDetail } from "@/features/rent-status/api";
import type { RentRow } from "@/features/rent-status/types";

const fmtDate = (iso: string | null) => {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
};
const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

function CaseCard({ c }: { c: EvictionCase }) {
  const sub = c.courtDate
    ? `Court: ${fmtDate(c.courtDate)}${c.courtTime ? ` ${c.courtTime}` : ""}`
    : c.noticeFiledDate ? `Notice filed ${fmtDate(c.noticeFiledDate)}` : "";
  const onPlan = c.status === "payment_plan";
  const planDefaulted = c.paymentPlanStatus === "defaulted";
  return (
    <Link href={`/evictions/${c.id}`}>
      <div className="flex items-center gap-3 rounded-xl border border-border p-3 hover:bg-muted/50 cursor-pointer">
        <Scale className="w-5 h-5 text-[#B23A2E] shrink-0" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">{c.propertyAddress}</p>
          <p className="text-xs text-muted-foreground truncate">{c.tenantName}{sub ? ` · ${sub}` : ""}</p>
          <div className="flex flex-wrap items-center gap-1.5 mt-0.5">
            {!onPlan && <p className="text-[11px] font-semibold text-[#B23A2E]">Stage: {c.statusLabel}{c.writtenOffAt ? " · Written off" : ""}</p>}
            {onPlan && (
              <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-violet-100 text-violet-700">Payment Plan</span>
            )}
            {onPlan && planDefaulted && (
              <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-red-600 text-white">Plan Defaulted</span>
            )}
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
      </div>
    </Link>
  );
}

export default function Evictions() {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const { data, isLoading } = useQuery({ queryKey: evictionsKey, queryFn: listEvictions });
  const [showNew, setShowNew] = useState(false);
  const [showClosed, setShowClosed] = useState(false);

  const [address, setAddress] = useState("");
  const [tenant, setTenant] = useState("");
  const [leaseId, setLeaseId] = useState("");
  const [propDoorloopId, setPropDoorloopId] = useState("");
  const [monthlyRent, setMonthlyRent] = useState("");
  const [noticeType, setNoticeType] = useState("3_day");
  const [filed, setFiled] = useState(todayISO());
  const [balance, setBalance] = useState("");
  const [notes, setNotes] = useState("");

  // Property list (with tenant + lease) sourced from the rent ledger.
  const { data: rentRows = [] } = useQuery({ queryKey: ["evict-properties"], queryFn: fetchRentDetail });
  const properties = useMemo(
    () => rentRows.slice().sort((a, b) => a.address.localeCompare(b.address)),
    [rentRows],
  );

  // Fill address/tenant/lease + the past-due ledger balance for a property.
  const applyProperty = (row: RentRow) => {
    setAddress(row.address);
    setTenant(row.tenantName ?? "");
    setLeaseId(row.doorloopLeaseId ?? "");
    setPropDoorloopId(row.propertyDoorloopId ?? "");
    setMonthlyRent(String(row.monthlyRent ?? ""));
    if (row.pastDueAmount != null) setBalance(String(row.pastDueAmount));
  };

  // Pre-fill from the property detail sheet's "Begin Eviction Process".
  useEffect(() => {
    const raw = sessionStorage.getItem("nch_eviction_prefill");
    if (!raw) return;
    sessionStorage.removeItem("nch_eviction_prefill");
    try {
      const p = JSON.parse(raw);
      if (p.propertyAddress) setAddress(String(p.propertyAddress));
      if (p.tenantName) setTenant(String(p.tenantName));
      if (p.doorloopLeaseId) setLeaseId(String(p.doorloopLeaseId));
      if (p.doorloopPropertyId) setPropDoorloopId(String(p.doorloopPropertyId));
      if (p.balanceAtFiling) setBalance(String(p.balanceAtFiling));
      if (p.monthlyRent) setMonthlyRent(String(p.monthlyRent));
      setShowNew(true);
    } catch { /* ignore */ }
  }, []);

  const create = useMutation({
    mutationFn: () => createEviction({
      propertyAddress: address.trim(), tenantName: tenant.trim(),
      doorloopLeaseId: leaseId || undefined, doorloopPropertyId: propDoorloopId || undefined,
      monthlyRent: monthlyRent ? Number(monthlyRent) : undefined,
      noticeType, noticeFiledDate: filed,
      balanceAtFiling: balance ? Number(balance) : undefined, notes: notes.trim() || undefined,
    }),
    onSuccess: (r) => { void qc.invalidateQueries({ queryKey: evictionsKey }); toast.success("Case created"); navigate(`/evictions/${r.id}`); },
    onError: (e: Error) => toast.error(e.message),
  });

  const active = data?.active ?? [];
  const closed = data?.closed ?? [];

  return (
    <div className="pb-28">
      <div className="bg-primary text-primary-foreground p-4 sticky top-0 z-10 flex items-center gap-2 shadow-md">
        <Link href="/more"><ChevronLeft className="w-6 h-6" /></Link>
        <h1 className="text-xl font-bold flex-1">Evictions</h1>
        <button type="button" onClick={() => setShowNew(true)} className="flex items-center gap-1 text-sm font-semibold bg-white/15 rounded-lg px-3 py-1.5"><Plus className="w-4 h-4" /> New Case</button>
      </div>

      <div className="p-4 space-y-2">
        <p className="text-xs font-bold text-muted-foreground uppercase tracking-wide">Active Evictions ({active.length})</p>
        {isLoading ? <p className="text-center text-muted-foreground py-6">Loading…</p>
          : active.length === 0 ? <p className="text-center text-muted-foreground py-6">No active eviction cases.</p>
          : active.map((c) => <CaseCard key={c.id} c={c} />)}

        {closed.length > 0 && (
          <div className="pt-3">
            <button type="button" onClick={() => setShowClosed((v) => !v)} className="text-xs font-medium text-muted-foreground">
              {showClosed ? "▾" : "▸"} Closed Evictions ({closed.length})
            </button>
            {showClosed && <div className="space-y-2 mt-2 opacity-70">{closed.map((c) => <CaseCard key={c.id} c={c} />)}</div>}
          </div>
        )}
      </div>

      {showNew && (
        <div className="fixed inset-0 z-[80] flex flex-col justify-end" onClick={() => setShowNew(false)}>
          <div className="absolute inset-0 bg-black/50" />
          <div className="relative bg-background text-foreground rounded-t-2xl max-h-[92vh] overflow-y-auto p-4 space-y-3" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold">New Eviction Case</h3>
              <button type="button" onClick={() => setShowNew(false)}><X className="w-5 h-5" /></button>
            </div>
            <div>
              <label className="text-xs font-semibold">Property</label>
              <select
                value={address}
                onChange={(e) => { const row = properties.find((p) => p.address === e.target.value); if (row) applyProperty(row); else setAddress(e.target.value); }}
                className="w-full mt-0.5 border border-border rounded-lg px-3 py-2.5 text-sm bg-background"
              >
                <option value="">— select a property —</option>
                {properties.map((p, i) => (
                  <option key={i} value={p.address}>{p.address}{p.tenantName ? ` — ${p.tenantName}` : ""}</option>
                ))}
              </select>
            </div>
            <label className="text-xs font-semibold block">Tenant name
              <input value={tenant} onChange={(e) => setTenant(e.target.value)} placeholder="auto-filled — edit for legal name" className="w-full mt-0.5 border border-border rounded-lg px-3 py-2 text-sm bg-background font-normal" />
            </label>
            <div className="flex gap-2">
              {[["3_day", "3-Day Notice"], ["10_day", "10-Day Notice"]].map(([k, label]) => (
                <button key={k} type="button" onClick={() => setNoticeType(k)}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm font-semibold border ${noticeType === k ? "bg-primary text-primary-foreground border-primary" : "border-border bg-background"}`}>{label}</button>
              ))}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs font-semibold">Notice filed<input type="date" value={filed} onChange={(e) => setFiled(e.target.value)} className="w-full mt-0.5 border border-border rounded-lg px-2 py-2 text-sm bg-background font-normal" /></label>
              <label className="text-xs font-semibold">Balance at filing ($)<input type="number" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="from ledger / edit" className="w-full mt-0.5 border border-border rounded-lg px-2 py-2 text-sm bg-background font-normal" /></label>
            </div>
            <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Notes (optional)" className="w-full border border-border rounded-lg px-3 py-2 text-sm bg-background" />
            <button type="button" onClick={() => address.trim() && tenant.trim() && create.mutate()} disabled={create.isPending || !address.trim() || !tenant.trim()}
              className="w-full rounded-xl py-3 text-sm font-bold text-white disabled:opacity-50" style={{ backgroundColor: "#B23A2E" }}>{create.isPending ? "Creating…" : "Create Case"}</button>
            <div className="h-6" />
          </div>
        </div>
      )}
    </div>
  );
}
