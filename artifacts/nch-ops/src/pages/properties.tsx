import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Search, ChevronRight, RefreshCw, ArrowUpDown, X } from "lucide-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem("kc_token")}`, "Content-Type": "application/json" };
}

type LedgerListStatus = "paid" | "current" | "past_due" | "expected";

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
  // For an "expected" row: ISO date this month's rent is due (custom due day).
  expectedDate?: string | null;
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

function LedgerView({ property, onBack }: { property: LedgerProperty; onBack: () => void }) {
  const { data, isLoading, isError } = useQuery<LedgerStatement>({
    queryKey: ["ledger", property.id],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/properties/${property.id}/ledger`, { headers: authHeaders() });
      if (!r.ok) throw new Error("Failed to load ledger");
      return r.json();
    },
  });

  const balance = data?.currentBalance ?? 0;
  const owes = balance < 0;

  return (
    <div className="pb-24">
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
type BalanceFilter = "all" | "owing" | "paid" | "credit" | "expected";
type SortKey = "balance_desc" | "balance_asc" | "address" | "tenant" | "days_late";
type Delinquency = "all" | "current" | "1_30" | "30_plus";
type Tri = "all" | "yes" | "no";

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
  current: { label: "Owes", cls: "bg-amber-100 text-amber-700" },
  past_due: { label: "Past due", cls: "bg-destructive/15 text-destructive" },
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
  const [balance, setBalance] = useState<BalanceFilter>("owing");
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

  const balanceCounts = useMemo(() => {
    let all = 0, owing = 0, paid = 0, credit = 0, expected = 0;
    for (const p of properties) {
      all++;
      // Expected (not-yet-due) is its own category — never "has balance".
      if (p.status === "expected") expected++;
      else if (owed(p) > EPS) owing++;
      else if (p.currentBalance > EPS) credit++;
      else paid++;
    }
    return { all, owing, paid, credit, expected };
  }, [properties]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const matchBalance = (p: LedgerProperty) =>
      balance === "all" ||
      (balance === "owing" && p.status !== "expected" && owed(p) > EPS) ||
      (balance === "paid" && p.status !== "expected" && Math.abs(p.currentBalance) <= EPS) ||
      (balance === "credit" && p.status !== "expected" && p.currentBalance > EPS) ||
      (balance === "expected" && p.status === "expected");
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
      (p) => matchBalance(p) && matchDelinq(p) && matchSit(p) && matchSearch(p),
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
  }, [properties, search, balance, sort, delinquency, situation]);

  const chips: { label: string; clear: () => void }[] = [];
  if (delinquency !== "all")
    chips.push({ label: { current: "Current", "1_30": "1–30 days", "30_plus": "30+ days" }[delinquency], clear: () => setDelinquency("all") });
  if (situation !== "all")
    chips.push({ label: situation === "yes" ? "Has situation" : "No situation", clear: () => setSituation("all") });

  const clearAll = () => {
    setBalance("all");
    setDelinquency("all");
    setSituation("all");
    setSearch("");
  };

  if (selected) {
    return <LedgerView property={selected} onBack={() => setSelected(null)} />;
  }

  const segments: { key: BalanceFilter; label: string; count: number }[] = [
    { key: "owing", label: "Has balance", count: balanceCounts.owing },
    { key: "paid", label: "Paid up", count: balanceCounts.paid },
    { key: "credit", label: "Credit", count: balanceCounts.credit },
    // Only surface the Expected tab when something is actually upcoming.
    ...(balanceCounts.expected > 0
      ? [{ key: "expected" as BalanceFilter, label: "Expected", count: balanceCounts.expected }]
      : []),
    { key: "all", label: "All", count: balanceCounts.all },
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

        {/* Balance segmented toggle with live counts */}
        <div
          className={`grid gap-1 bg-primary-foreground/15 rounded-xl p-1 text-xs ${
            segments.length === 5 ? "grid-cols-5" : "grid-cols-4"
          }`}
        >
          {segments.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setBalance(s.key)}
              className={`rounded-lg py-1.5 font-semibold transition-colors ${
                balance === s.key ? "bg-primary-foreground text-primary" : "text-primary-foreground/80"
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
          {(chips.length > 0 || balance !== "all" || search) && (
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
                        <div className="text-sm font-bold tabular-nums text-blue-700">{fmtMoney(o)}</div>
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
