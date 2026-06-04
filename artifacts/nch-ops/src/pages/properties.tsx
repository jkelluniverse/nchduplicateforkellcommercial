import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Search, ChevronRight, RefreshCw } from "lucide-react";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem("kc_token")}`, "Content-Type": "application/json" };
}

interface Property {
  id: number;
  address: string;
  resident1Name: string | null;
  resident1Phone: string | null;
  resident1Email: string | null;
  resident2Name: string | null;
  resident2Phone: string | null;
  resident2Email: string | null;
  notes: string | null;
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
  const t = Date.parse(iso);
  if (!t) return iso;
  return new Date(t).toLocaleDateString("en-US", { month: "2-digit", day: "2-digit", year: "numeric" });
}

function LedgerView({ property, onBack }: { property: Property; onBack: () => void }) {
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

export default function Properties() {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Property | null>(null);

  const { data: properties = [], isLoading } = useQuery<Property[]>({
    queryKey: ["properties", search],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (search) params.set("q", search);
      const r = await fetch(`${API_BASE}/api/properties?${params}`, { headers: authHeaders() });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
  });

  if (selected) {
    return <LedgerView property={selected} onBack={() => setSelected(null)} />;
  }

  return (
    <div className="pb-20">
      <div className="bg-primary text-primary-foreground p-4 sticky top-0 z-10 shadow-md">
        <h1 className="text-2xl font-bold mb-3">Properties</h1>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <Input
            className="pl-10 bg-primary-foreground text-foreground border-0 h-12 rounded-xl"
            placeholder="Search address or tenant..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="p-4 space-y-3">
        {isLoading ? (
          Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)
        ) : properties.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground">No properties found.</div>
        ) : (
          properties.map((prop) => (
            <Card
              key={prop.id}
              className="hover:shadow-md transition-shadow cursor-pointer active:bg-muted/50"
              onClick={() => setSelected(prop)}
            >
              <CardContent className="p-4 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="font-semibold text-sm">{prop.address}</h3>
                  {prop.resident1Name && (
                    <p className="text-xs text-muted-foreground mt-1">{prop.resident1Name}</p>
                  )}
                  {prop.resident2Name && (
                    <p className="text-xs text-muted-foreground">{prop.resident2Name}</p>
                  )}
                </div>
                <div className="flex items-center gap-1 text-primary text-xs font-medium shrink-0">
                  Statement <ChevronRight className="w-4 h-4" />
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
