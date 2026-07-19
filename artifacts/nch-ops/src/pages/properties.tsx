import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Search, ChevronRight, RefreshCw, ArrowUpDown, X, FileWarning } from "lucide-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem("kc_token")}`, "Content-Type": "application/json" };
}

type LedgerListStatus = "paid" | "unpaid" | "delinquent" | "expected";

interface LedgerProperty {
  id: number;
  address: string;
  resident1Name: string | null;
  resident2Name: string | null;
  currentBalance: number; // negative = owes, positive = credit
  pastDue: number;
  status: LedgerListStatus;
  daysLate: number;
  hasSituation: boolean;
  // For an "expected" row: ISO due date + the expected payment amount (this
  // month's rent). The live balance may be $0 if the charge hasn't posted yet.
  expectedDate?: string | null;
  expectedAmount?: number | null;
}

interface LedgerLine {
  date: string;
  description: string;
  subDescription: string | null;
  reference: string | null;
  debit: number | null;
  credit: number | null;
  balance: number;
}

interface LedgerStatement {
  source: "rentec" | "ledger" | "none";
  address: string;
  tenantName: string | null;
  currentBalance: number;
  lines: LedgerLine[];
  fetchedAt: string;
}

function fmtMoney(n: number | null): string {
  if (n === null) return "";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function fmtDate(iso: string): string {
  // The backend sends a plain yyyy-mm-dd calendar date (Rentec's own local
  // date). Format it directly — going through Date.parse treats it as UTC
  // midnight, which rolls back a day in negative-offset timezones (e.g. an
  // Eastern user would see 06/01 as 05/31).
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (m) return `${m[2]}/${m[3]}/${m[1]}`;
  const t = Date.parse(iso);
  if (!t) return iso;
  return new Date(t).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
}

// ─── Past Due Notice: fillable form (auto-filled from the ledger) ────────────
/** Local-date ISO (YYYY-MM-DD) so date inputs don't roll back a day in the UTC. */
function isoDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function downloadPdf(filename: string, base64: string): void {
  const bytes = atob(base64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([arr], { type: "application/pdf" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function PastDueNoticeForm({
  property,
  currentBalance,
  onClose,
}: {
  property: LedgerProperty;
  currentBalance: number;
  onClose: () => void;
}) {
  const recipient = [property.resident1Name, property.resident2Name]
    .filter(Boolean)
    .join(" & ");
  const today = new Date();
  const payBy = new Date();
  payBy.setDate(payBy.getDate() + 10);

  const [form, setForm] = useState({
    recipient_name: recipient,
    property_address: property.address,
    notice_date: isoDate(today),
    pay_by_date: isoDate(payBy),
    period_covered: "",
    account_ref: "",
    amount_past_due: Math.max(0, -currentBalance),
    late_fees: 0,
    other_charges: 0,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (k: keyof typeof form, v: string | number) =>
    setForm((f) => ({ ...f, [k]: v }));

  const total =
    (Number(form.amount_past_due) || 0) +
    (Number(form.late_fees) || 0) +
    (Number(form.other_charges) || 0);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`${API_BASE}/api/documents/past-due-notice`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          ...form,
          amount_past_due: Number(form.amount_past_due) || 0,
          late_fees: Number(form.late_fees) || 0,
          other_charges: Number(form.other_charges) || 0,
        }),
      });
      if (!r.ok) {
        throw new Error((await r.json().catch(() => ({}))).error || `Request failed (${r.status})`);
      }
      const { filename, pdfBase64 } = (await r.json()) as { filename: string; pdfBase64: string };
      downloadPdf(filename, pdfBase64);
      onClose();
    } catch (e: any) {
      setError(e.message || "Failed to generate the notice");
    } finally {
      setBusy(false);
    }
  };

  const field = "w-full rounded-lg border bg-background px-3 py-2 text-sm";
  const label = "block text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-1";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50">
      <div className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-card shadow-xl">
        <div className="sticky top-0 bg-[#B23A2E] text-white px-4 py-3 flex items-center justify-between">
          <h2 className="font-bold text-base">Past Due Notice</h2>
          <button type="button" onClick={onClose} className="text-white/80 hover:text-white">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <label className={label}>Recipient</label>
            <Input value={form.recipient_name} onChange={(e) => set("recipient_name", e.target.value)} className={field} />
          </div>
          <div>
            <label className={label}>Property address</label>
            <Input value={form.property_address} onChange={(e) => set("property_address", e.target.value)} className={field} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Notice date</label>
              <input type="date" value={form.notice_date} onChange={(e) => set("notice_date", e.target.value)} className={field} />
            </div>
            <div>
              <label className={label}>Pay by date</label>
              <input type="date" value={form.pay_by_date} onChange={(e) => set("pay_by_date", e.target.value)} className={field} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={label}>Period covered</label>
              <Input value={form.period_covered} onChange={(e) => set("period_covered", e.target.value)} placeholder="optional" className={field} />
            </div>
            <div>
              <label className={label}>Account / Ref</label>
              <Input value={form.account_ref} onChange={(e) => set("account_ref", e.target.value)} placeholder="optional" className={field} />
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={label}>Past due</label>
              <input type="number" step="0.01" value={form.amount_past_due} onChange={(e) => set("amount_past_due", e.target.value === "" ? 0 : Number(e.target.value))} className={field} />
            </div>
            <div>
              <label className={label}>Late fees</label>
              <input type="number" step="0.01" value={form.late_fees} onChange={(e) => set("late_fees", e.target.value === "" ? 0 : Number(e.target.value))} className={field} />
            </div>
            <div>
              <label className={label}>Other</label>
              <input type="number" step="0.01" value={form.other_charges} onChange={(e) => set("other_charges", e.target.value === "" ? 0 : Number(e.target.value))} className={field} />
            </div>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-muted/50 px-3 py-2">
            <span className="text-sm font-semibold text-muted-foreground">Total amount due</span>
            <span className="text-lg font-extrabold tabular-nums">{fmtMoney(total)}</span>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 rounded-lg border px-4 py-2 text-sm font-semibold hover:bg-muted">
              Cancel
            </button>
            <button
              type="button"
              onClick={generate}
              disabled={busy || !form.recipient_name.trim() || !form.property_address.trim()}
              className="flex-1 rounded-lg bg-[#B23A2E] px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-[#9c3227] disabled:opacity-50"
            >
              {busy ? "Generating…" : "Generate PDF"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function LedgerView({ property, onBack }: { property: LedgerProperty; onBack: () => void }) {
  const { data, isLoading, isError } = useQuery<LedgerStatement>({
    queryKey: ["ledger", property.id],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/properties/${property.id}/ledger`, { headers: authHeaders() });
      if (!r.ok) throw new Error("Failed to load ledger");
      return r.json();
    },
  });

  const balance = data?.currentBalance ?? property.currentBalance ?? 0;
  const owes = balance < 0;

  const [noticeOpen, setNoticeOpen] = useState(false);

  return (
    <div className="pb-24">
      {noticeOpen && (
        <PastDueNoticeForm
          property={property}
          currentBalance={balance}
          onClose={() => setNoticeOpen(false)}
        />
      )}
      <div className="bg-primary text-primary-foreground px-4 pt-4 pb-3 sticky top-0 z-10 shadow-md">
        <button type="button" onClick={onBack} className="text-primary-foreground/70 text-sm mb-2 hover:text-primary-foreground">
          &larr; Back to properties
        </button>
        <h1 className="text-xl font-bold leading-tight">{property.address}</h1>
        <div className="flex items-center gap-2 mt-1 text-sm text-primary-foreground/80">
          {property.resident1Name && <span>{property.resident1Name}</span>}
          {data && data.source !== "none" && (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-primary-foreground/15 px-1.5 py-0.5 rounded">
              {data.source === "rentec" ? "Live · Rentec" : "Master Ledger"}
            </span>
          )}
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Balance summary */}
        <div className="rounded-2xl border bg-card p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Account Balance</p>
          <p className={`text-3xl font-extrabold tabular-nums mt-1 ${owes ? "text-destructive" : "text-emerald-600"}`}>
            {fmtMoney(Math.abs(balance))}
          </p>
          <p className="text-sm text-muted-foreground mt-0.5">
            {balance === 0 ? "Paid in full" : owes ? "Balance owed" : "Credit on account"}
          </p>
          <button
            type="button"
            onClick={() => setNoticeOpen(true)}
            className="mt-3 w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-lg bg-[#B23A2E] px-4 py-2 text-sm font-bold text-white shadow-sm hover:bg-[#9c3227] active:opacity-90"
          >
            <FileWarning className="w-4 h-4" />
            Past Due Notice
          </button>
        </div>

        {/* Statement */}
        <div className="rounded-2xl border bg-card shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b font-bold text-sm">Ledger</div>
          {isLoading ? (
            <div className="p-4 space-y-2">
              {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : isError ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              <RefreshCw className="w-6 h-6 mx-auto mb-2 opacity-40" />Couldn't load the statement.
            </div>
          ) : !data || data.lines.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">No transactions on record.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-muted/50 text-muted-foreground text-xs uppercase tracking-wide">
                    <th className="text-left font-semibold px-3 py-2">Date</th>
                    <th className="text-left font-semibold px-3 py-2">Description</th>
                    <th className="text-right font-semibold px-3 py-2">Debit</th>
                    <th className="text-right font-semibold px-3 py-2">Credit</th>
                    <th className="text-right font-semibold px-3 py-2">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {data.lines.map((l, i) => (
                    <tr key={i} className="border-t align-top">
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">{fmtDate(l.date)}</td>
                      <td className="px-3 py-2">
                        <div className="font-medium leading-tight">{l.description}</div>
                        {l.subDescription && <div className="text-xs text-muted-foreground">{l.subDescription}</div>}
                        {l.reference && <div className="text-xs text-muted-foreground">{l.reference}</div>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-destructive whitespace-nowrap">
                        {l.debit ? fmtMoney(l.debit) : ""}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-600 whitespace-nowrap">
                        {l.credit ? fmtMoney(l.credit) : ""}
                      </td>
                      <td className={`px-3 py-2 text-right tabular-nums font-semibold whitespace-nowrap ${l.balance < 0 ? "text-destructive" : ""}`}>
                        {fmtMoney(l.balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        {data && data.source === "ledger" && (
          <p className="text-xs text-muted-foreground px-1">
            Showing the Master Ledger statement (Rentec live data unavailable).
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Ledger list: sort + filter ─────────────────────────────────────────────
// Main filter = the month's payment-verified status (resets on the 1st):
// Paid / Unpaid / Delinquent. Balance-type views (has balance, credit,
// expected) remain as secondary filters.
type StatusFilter = "all" | "paid" | "unpaid" | "delinquent";
type TypeFilter = "any" | "owing" | "credit" | "expected";
type SortKey = "balance_desc" | "balance_asc" | "address" | "tenant" | "days_late";
type Delinquency = "all" | "current" | "1_30" | "30_plus";
type Tri = "all" | "yes" | "no";

/** Initial status filter from the URL (?filter=paid|unpaid|delinquent) so the
 *  dashboard's PAID / UNPAID / DELINQUENT counters can deep-link here. */
function statusFilterFromUrl(): StatusFilter {
  const f = new URLSearchParams(window.location.search).get("filter");
  return f === "paid" || f === "unpaid" || f === "delinquent" ? f : "all";
}

const EPS = 0.005;
const owed = (p: LedgerProperty) => -p.currentBalance; // positive = owes

const SORT_LABEL: Record<SortKey, string> = {
  balance_desc: "Balance: high → low",
  balance_asc: "Balance: low → high",
  address: "Property A–Z",
  tenant: "Tenant A–Z",
  days_late: "Most delinquent",
};

const STATUS_STYLE: Record<LedgerListStatus, { label: string; cls: string }> = {
  paid: { label: "Paid", cls: "bg-emerald-100 text-emerald-700" },
  unpaid: { label: "Unpaid", cls: "bg-amber-100 text-amber-700" },
  delinquent: { label: "Delinquent", cls: "bg-destructive/15 text-destructive" },
  expected: { label: "Expected", cls: "bg-blue-100 text-blue-700" },
};

/** "2026-06-20" → "Jun 20" for the expected-payment date chip. */
function fmtExpectedDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${months[Number(m[2]) - 1] ?? ""} ${Number(m[3])}`;
}

export default function Properties() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<LedgerProperty | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(statusFilterFromUrl);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("any");
  const [sort, setSort] = useState<SortKey>("balance_desc");
  const [delinquency, setDelinquency] = useState<Delinquency>("all");
  const [situation, setSituation] = useState<Tri>("all");

  const { data: properties = [], isLoading } = useQuery<LedgerProperty[]>({
    queryKey: ["ledger-list"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/properties/ledger-list`, { headers: authHeaders() });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
  });

  const counts = useMemo(() => {
    let all = 0, paid = 0, unpaid = 0, delinquent = 0, owing = 0, credit = 0, expected = 0;
    for (const p of properties) {
      all++;
      // Main buckets: has this month's rent actually been received?
      // "Unpaid" includes expected (scheduled later this month, still unpaid).
      if (p.status === "paid") paid++;
      else if (p.status === "delinquent") delinquent++;
      else unpaid++;
      // Secondary balance-type buckets.
      if (p.status === "expected") expected++;
      else if (owed(p) > EPS) owing++;
      else if (p.currentBalance > EPS) credit++;
    }
    return { all, paid, unpaid, delinquent, owing, credit, expected };
  }, [properties]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matchStatus = (p: LedgerProperty) =>
      statusFilter === "all" ||
      (statusFilter === "paid" && p.status === "paid") ||
      (statusFilter === "delinquent" && p.status === "delinquent") ||
      (statusFilter === "unpaid" && (p.status === "unpaid" || p.status === "expected"));
    const matchType = (p: LedgerProperty) =>
      typeFilter === "any" ||
      (typeFilter === "owing" && p.status !== "expected" && owed(p) > EPS) ||
      (typeFilter === "credit" && p.status !== "expected" && p.currentBalance > EPS) ||
      (typeFilter === "expected" && p.status === "expected");
    const matchDelinq = (p: LedgerProperty) =>
      delinquency === "all" ||
      (delinquency === "current" && p.daysLate === 0) ||
      (delinquency === "1_30" && p.daysLate >= 1 && p.daysLate <= 30) ||
      (delinquency === "30_plus" && p.daysLate > 30);
    const matchSit = (p: LedgerProperty) =>
      situation === "all" || (situation === "yes" ? p.hasSituation : !p.hasSituation);
    const matchSearch = (p: LedgerProperty) =>
      !q ||
      p.address.toLowerCase().includes(q) ||
      (p.resident1Name?.toLowerCase().includes(q) ?? false) ||
      (p.resident2Name?.toLowerCase().includes(q) ?? false);

    const out = properties.filter(
      (p) => matchStatus(p) && matchType(p) && matchDelinq(p) && matchSit(p) && matchSearch(p),
    );

    out.sort((a, b) => {
      switch (sort) {
        case "balance_desc": return owed(b) - owed(a);
        case "balance_asc": return owed(a) - owed(b);
        case "address": return a.address.localeCompare(b.address);
        case "tenant": return (a.resident1Name ?? "~").localeCompare(b.resident1Name ?? "~");
        case "days_late": return b.daysLate - a.daysLate;
        default: return 0;
      }
    });
    return out;
  }, [properties, search, statusFilter, typeFilter, sort, delinquency, situation]);

  const chips: { label: string; clear: () => void }[] = [];
  if (typeFilter !== "any")
    chips.push({ label: { owing: "Has balance", credit: "Credit", expected: "Expected" }[typeFilter], clear: () => setTypeFilter("any") });
  if (delinquency !== "all")
    chips.push({ label: { current: "Current", "1_30": "1–30 days", "30_plus": "30+ days" }[delinquency], clear: () => setDelinquency("all") });
  if (situation !== "all")
    chips.push({ label: situation === "yes" ? "Has situation" : "No situation", clear: () => setSituation("all") });

  const clearAll = () => {
    setStatusFilter("all");
    setTypeFilter("any");
    setDelinquency("all");
    setSituation("all");
    setSearch("");
  };

  if (selected) {
    return <LedgerView property={selected} onBack={() => setSelected(null)} />;
  }

  // Main month-status segments: Paid / Unpaid / Delinquent — the counts add up
  // to All and reset naturally when the month rolls over.
  const segments: { key: StatusFilter; label: string; count: number }[] = [
    { key: "paid", label: "Paid", count: counts.paid },
    { key: "unpaid", label: "Unpaid", count: counts.unpaid },
    { key: "delinquent", label: "Delinquent", count: counts.delinquent },
    { key: "all", label: "All", count: counts.all },
  ];

  return (
    <div className="pb-20">
      <div className="bg-primary text-primary-foreground p-4 sticky top-0 z-10 shadow-md space-y-3">
        <h1 className="text-2xl font-bold">Ledger</h1>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <Input
            className="pl-10 bg-primary-foreground text-foreground border-0 h-12 rounded-xl"
            placeholder="Search address or tenant..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Month-status segmented toggle (Paid / Unpaid / Delinquent) with live counts */}
        <div className="grid grid-cols-4 gap-1 bg-primary-foreground/15 rounded-xl p-1 text-xs">
          {segments.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setStatusFilter(s.key)}
              className={`rounded-lg py-1.5 font-semibold transition-colors ${
                statusFilter === s.key ? "bg-primary-foreground text-primary" : "text-primary-foreground/80"
              }`}
            >
              <div className="leading-tight">{s.label}</div>
              <div className="tabular-nums opacity-80">{s.count}</div>
            </button>
          ))}
        </div>

        {/* Sort + secondary filters */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <div className="relative inline-flex items-center gap-1 bg-primary-foreground/15 rounded-lg pl-2 pr-1 h-8">
            <ArrowUpDown className="w-3.5 h-3.5 opacity-80" />
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as SortKey)}
              className="bg-transparent text-primary-foreground font-semibold outline-none h-8 pr-1 [&>option]:text-foreground"
            >
              {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
                <option key={k} value={k}>{SORT_LABEL[k]}</option>
              ))}
            </select>
          </div>

          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as TypeFilter)}
            className="bg-primary-foreground/15 text-primary-foreground font-semibold rounded-lg h-8 px-2 outline-none [&>option]:text-foreground"
          >
            <option value="any">Any type</option>
            <option value="owing">Has balance ({counts.owing})</option>
            <option value="credit">Credit ({counts.credit})</option>
            <option value="expected">Expected ({counts.expected})</option>
          </select>

          <select
            value={delinquency}
            onChange={(e) => setDelinquency(e.target.value as Delinquency)}
            className="bg-primary-foreground/15 text-primary-foreground font-semibold rounded-lg h-8 px-2 outline-none [&>option]:text-foreground"
          >
            <option value="all">Any age</option>
            <option value="current">Current (0d)</option>
            <option value="1_30">1–30 days</option>
            <option value="30_plus">30+ days</option>
          </select>

          <select
            value={situation}
            onChange={(e) => setSituation(e.target.value as Tri)}
            className="bg-primary-foreground/15 text-primary-foreground font-semibold rounded-lg h-8 px-2 outline-none [&>option]:text-foreground"
          >
            <option value="all">Any situation</option>
            <option value="yes">Has situation</option>
            <option value="no">No situation</option>
          </select>
        </div>

        {/* Removable chips + count */}
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {chips.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={c.clear}
              className="inline-flex items-center gap-1 bg-primary-foreground/20 rounded-full pl-2.5 pr-1.5 py-1 font-medium"
            >
              {c.label}<X className="w-3 h-3" />
            </button>
          ))}
          {(chips.length > 0 || statusFilter !== "all" || search) && (
            <button type="button" onClick={clearAll} className="underline opacity-80 hover:opacity-100">
              Clear filters
            </button>
          )}
          <span className="ml-auto opacity-80 tabular-nums">
            Showing {filtered.length} of {properties.length}
          </span>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)
        ) : filtered.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">No properties match these filters.</div>
        ) : (
          filtered.map((prop) => {
            const o = owed(prop);
            const st = STATUS_STYLE[prop.status];
            const isExpected = prop.status === "expected";
            return (
              <Card
                key={prop.id}
                className="hover:shadow-md transition-shadow cursor-pointer active:bg-muted/50"
                onClick={() => setSelected(prop)}
              >
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-sm truncate">{prop.address}</h3>
                    {prop.resident1Name && (
                      <p className="text-xs text-muted-foreground mt-1 truncate">{prop.resident1Name}</p>
                    )}
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      <span className={`text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded ${st.cls}`}>
                        {st.label}
                      </span>
                      {isExpected && prop.expectedDate && (
                        <span className="text-[10px] font-semibold text-blue-700">
                          due {fmtExpectedDate(prop.expectedDate)}
                        </span>
                      )}
                      {prop.daysLate > 0 && (
                        <span className="text-[10px] font-semibold text-destructive">{prop.daysLate}d late</span>
                      )}
                      {prop.hasSituation && (
                        <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded bg-primary/10 text-primary">
                          Situation
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <div className="text-right">
                      {isExpected ? (
                        <div className="text-sm font-bold tabular-nums text-blue-700">
                          {fmtMoney((prop.expectedAmount ?? 0) > EPS ? prop.expectedAmount! : o)}
                        </div>
                      ) : o > EPS ? (
                        <div className="text-sm font-bold tabular-nums text-destructive">{fmtMoney(o)}</div>
                      ) : prop.currentBalance > EPS ? (
                        <div className="text-sm font-bold tabular-nums text-emerald-600">{fmtMoney(prop.currentBalance)}</div>
                      ) : (
                        <div className="text-sm font-bold tabular-nums text-emerald-600">$0</div>
                      )}
                      <div className="text-[10px] text-muted-foreground">
                        {isExpected ? "expected" : o > EPS ? "owed" : prop.currentBalance > EPS ? "credit" : "paid"}
                      </div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </CardContent>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
}
