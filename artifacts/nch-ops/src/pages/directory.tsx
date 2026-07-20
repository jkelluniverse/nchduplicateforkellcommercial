import { useState, useMemo, useEffect, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Search, Phone, Mail, RefreshCw, FileText, Clock, TriangleAlert as AlertTriangle, Pencil, X } from "lucide-react";
import { formatPhone } from "@/lib/utils";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem("kc_token")}`, "Content-Type": "application/json" };
}

interface Property {
  id: number;
  doorloopPropertyId: string | null;
  doorloopLeaseId: string | null;
  address: string;
  resident1Name: string | null;
  resident1Phone: string | null;
  resident1Email: string | null;
  resident2Name: string | null;
  resident2Phone: string | null;
  resident2Email: string | null;
  notes: string | null;
  lastSyncedAt: string | null;
}

interface SyncStatus {
  lastSyncAt: string | null;
  lastSyncOk: boolean;
  propertyCount: number;
  error: string | null;
}

interface DirectoryResponse {
  entries: Property[];
  syncStatus: SyncStatus;
}

function formatTimeAgo(isoDate: string | null): string {
  if (!isoDate) return "Never";
  const diff = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function isSyncStale(isoDate: string | null): boolean {
  if (!isoDate) return true;
  return Date.now() - new Date(isoDate).getTime() > 60 * 60 * 1000;
}

export default function Directory() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editingNotes, setEditingNotes] = useState<string>("");

  const { data, isLoading } = useQuery<DirectoryResponse>({
    queryKey: ["directory"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/directory`, { headers: authHeaders() });
      if (!r.ok) throw new Error("Failed to load");
      return r.json();
    },
    refetchInterval: 30 * 60 * 1000,
  });

  const entries = data?.entries ?? [];
  const syncStatus = data?.syncStatus ?? { lastSyncAt: null, lastSyncOk: false, propertyCount: 0, error: null };

  const filtered = useMemo(() => {
    if (!search.trim()) return entries;
    const q = search.toLowerCase();
    return entries.filter(e =>
      e.address.toLowerCase().includes(q) ||
      e.resident1Name?.toLowerCase().includes(q) ||
      e.resident1Phone?.includes(q) ||
      e.resident2Name?.toLowerCase().includes(q) ||
      e.resident2Phone?.includes(q)
    );
  }, [entries, search]);

  const selected = useMemo(() => {
    if (selectedId === null) return null;
    return entries.find(e => e.id === selectedId) ?? null;
  }, [entries, selectedId]);

  useEffect(() => {
    if (selected) {
      setEditingNotes(selected.notes ?? "");
    }
  }, [selected]);

  const syncMutation = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${API_BASE}/api/directory/sync`, { method: "POST", headers: authHeaders() });
      if (!r.ok) throw new Error("Sync failed");
      return r.json();
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["directory"] });
      toast({ title: `Synced ${result.total} properties` });
    },
    onError: () => toast({ title: "Sync failed", variant: "destructive" }),
  });

  const notesMutation = useMutation({
    mutationFn: async ({ id, notes }: { id: number; notes: string }) => {
      const r = await fetch(`${API_BASE}/api/directory/${id}/notes`, {
        method: "PATCH", headers: authHeaders(), body: JSON.stringify({ notes }),
      });
      if (!r.ok) throw new Error("Failed to save notes");
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["directory"] });
    },
    onError: () => toast({ title: "Failed to save notes", variant: "destructive" }),
  });

  const [, setLocation] = useLocation();

  const handleNotesBlur = useCallback(() => {
    if (selected && editingNotes !== (selected.notes ?? "")) {
      notesMutation.mutate({ id: selected.id, notes: editingNotes });
    }
  }, [selected, editingNotes, notesMutation]);

  // Detail view
  if (selected) {
    return (
      <div className="pb-24">
        <div className="bg-primary text-primary-foreground px-4 pt-4 pb-3 sticky top-0 z-10 shadow-md">
          <button
            type="button"
            onClick={() => setSelectedId(null)}
            className="text-primary-foreground/70 text-sm mb-2 hover:text-primary-foreground"
          >
            &larr; Back to directory
          </button>
          <div className="flex items-start justify-between gap-2">
            <h1 className="text-xl font-bold leading-tight">{selected.address}</h1>
            <button type="button" onClick={() => setEditOpen(true)} aria-label="Edit entry"
              className="shrink-0 p-1.5 rounded-full bg-white/15"><Pencil className="w-4 h-4" /></button>
          </div>
        </div>

        {editOpen && <EditEntrySheet entry={selected} onClose={() => setEditOpen(false)} />}

        <div className="px-4 pt-4 space-y-4">
          {/* Resident 1 */}
          <div className="border rounded-xl p-4 space-y-2">
            <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Resident 1</p>
            {selected.resident1Name && <p className="font-semibold text-base">{selected.resident1Name}</p>}
            <div className="flex flex-col gap-2">
              {selected.resident1Phone && (
                <a href={`tel:${selected.resident1Phone}`} className="flex items-center gap-2 text-primary font-medium">
                  <Phone className="w-4 h-4" />{formatPhone(selected.resident1Phone)}
                </a>
              )}
              {selected.resident1Email && (
                <a href={`mailto:${selected.resident1Email}`} className="flex items-center gap-2 text-primary font-medium break-all">
                  <Mail className="w-4 h-4" />{selected.resident1Email}
                </a>
              )}
            </div>
          </div>

          {/* Resident 2 */}
          {(selected.resident2Name || selected.resident2Phone || selected.resident2Email) && (
            <div className="border rounded-xl p-4 space-y-2">
              <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Resident 2</p>
              {selected.resident2Name && <p className="font-semibold text-base">{selected.resident2Name}</p>}
              <div className="flex flex-col gap-2">
                {selected.resident2Phone && (
                  <a href={`tel:${selected.resident2Phone}`} className="flex items-center gap-2 text-primary font-medium">
                    <Phone className="w-4 h-4" />{formatPhone(selected.resident2Phone)}
                  </a>
                )}
                {selected.resident2Email && (
                  <a href={`mailto:${selected.resident2Email}`} className="flex items-center gap-2 text-primary font-medium break-all">
                    <Mail className="w-4 h-4" />{selected.resident2Email}
                  </a>
                )}
              </div>
            </div>
          )}

          {/* Notes */}
          <div className="border rounded-xl p-4 space-y-2">
            <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground">Notes</p>
            <Textarea
              value={editingNotes}
              onChange={(e) => setEditingNotes(e.target.value)}
              onBlur={handleNotesBlur}
              placeholder="Add notes about this property..."
              rows={4}
              className="resize-none"
            />
            {notesMutation.isPending && (
              <p className="text-xs text-muted-foreground">Saving...</p>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-3">
            {selected.resident1Phone && (
              <a href={`tel:${selected.resident1Phone}`} className="flex-1">
                <Button className="w-full" variant="outline">
                  <Phone className="w-4 h-4 mr-2" />Call Resident 1
                </Button>
              </a>
            )}
            <Button className="flex-1" variant="outline" onClick={() => setLocation("/docs")}>
              <FileText className="w-4 h-4 mr-2" />Generate Document
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // List view
  return (
    <div className="pb-24">
      {/* Header */}
      <div className="bg-primary text-primary-foreground px-4 pt-4 pb-3 sticky top-0 z-10 shadow-md">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-2xl font-bold">Tenant Directory</h1>
          <button
            type="button"
            onClick={() => syncMutation.mutate()}
            disabled={syncMutation.isPending}
            className="bg-primary-foreground text-primary rounded-full w-10 h-10 flex items-center justify-center shadow disabled:opacity-50"
          >
            <RefreshCw className={`w-5 h-5 ${syncMutation.isPending ? "animate-spin" : ""}`} />
          </button>
        </div>
        <div className="flex items-center gap-2 text-xs text-primary-foreground/70 mb-3">
          <span>{entries.length} properties</span>
          <span className="opacity-50">|</span>
          {syncStatus.error && !syncStatus.lastSyncOk ? (
            <button
              type="button"
              onClick={() => syncMutation.mutate()}
              className="flex items-center gap-1 text-red-300 hover:text-red-200"
            >
              <AlertTriangle className="w-3 h-3" />Sync failed — tap to retry
            </button>
          ) : (
            <span className={`flex items-center gap-1 ${isSyncStale(syncStatus.lastSyncAt) ? "text-amber-300" : ""}`}>
              <Clock className="w-3 h-3" />Last synced: {formatTimeAgo(syncStatus.lastSyncAt)}
            </span>
          )}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary-foreground/50" />
          <input
            type="text"
            placeholder="Search address, name, or phone..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-primary-foreground/10 text-primary-foreground placeholder:text-primary-foreground/50 border border-primary-foreground/20 rounded-lg pl-9 pr-3 py-2 text-sm outline-none"
          />
        </div>
      </div>

      {/* List */}
      <div className="px-4 pt-3 space-y-2">
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20 w-full rounded-xl" />)
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <Search className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="font-medium">{search ? "No results" : "No properties synced yet"}</p>
            {!search && (
              <Button variant="outline" className="mt-4" onClick={() => syncMutation.mutate()}>
                <RefreshCw className="w-4 h-4 mr-2" />Sync from Rentec
              </Button>
            )}
          </div>
        ) : (
          filtered.map(entry => (
            <Card
              key={entry.id}
              className="border cursor-pointer hover:border-primary/30 transition-colors active:bg-muted/50"
              onClick={() => setSelectedId(entry.id)}
            >
              <CardContent className="p-4">
                <p className="font-semibold text-sm leading-tight">{entry.address}</p>
                <div className="flex flex-col gap-0.5 mt-1.5">
                  {entry.resident1Name && (
                    <p className="text-xs text-muted-foreground">{entry.resident1Name}</p>
                  )}
                  {entry.resident2Name && (
                    <p className="text-xs text-muted-foreground">{entry.resident2Name}</p>
                  )}
                </div>
                {(entry.resident1Phone || entry.resident2Phone) && (
                  <div className="flex items-center gap-3 mt-1.5">
                    {entry.resident1Phone && (
                      <span className="flex items-center gap-1 text-xs text-primary">
                        <Phone className="w-3 h-3" />{formatPhone(entry.resident1Phone)}
                      </span>
                    )}
                    {entry.resident2Phone && (
                      <span className="flex items-center gap-1 text-xs text-primary">
                        <Phone className="w-3 h-3" />{formatPhone(entry.resident2Phone)}
                      </span>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

/** Full edit of a directory entry — every contact field is editable. */
function EditEntrySheet({ entry, onClose }: { entry: Property; onClose: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [form, setForm] = useState({
    address: entry.address,
    resident1Name: entry.resident1Name ?? "",
    resident1Phone: entry.resident1Phone ?? "",
    resident1Email: entry.resident1Email ?? "",
    resident2Name: entry.resident2Name ?? "",
    resident2Phone: entry.resident2Phone ?? "",
    resident2Email: entry.resident2Email ?? "",
  });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const save = useMutation({
    mutationFn: async () => {
      const r = await fetch(`${API_BASE}/api/directory/${entry.id}`, {
        method: "PATCH",
        headers: authHeaders(),
        body: JSON.stringify(form),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || "Failed to save");
      return r.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["directory"] });
      toast({ title: "Entry updated" });
      onClose();
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  const I = "w-full border border-border rounded-lg px-3 py-2 text-sm bg-background mt-0.5";
  const L = "text-xs font-semibold block";
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50" onClick={onClose}>
      <div className="w-full sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl bg-card shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-primary text-primary-foreground px-4 py-3 flex items-center justify-between">
          <h2 className="font-bold text-base">Edit Directory Entry</h2>
          <button type="button" onClick={onClose} aria-label="Close"><X className="w-5 h-5" /></button>
        </div>
        <div className="p-4 space-y-3">
          <label className={L}>Property address<input value={form.address} onChange={(e) => set("address", e.target.value)} className={I} /></label>
          <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground pt-1">Resident 1</p>
          <label className={L}>Name<input value={form.resident1Name} onChange={(e) => set("resident1Name", e.target.value)} className={I} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className={L}>Phone<input type="tel" value={form.resident1Phone} onChange={(e) => set("resident1Phone", e.target.value)} className={I} /></label>
            <label className={L}>Email<input type="email" value={form.resident1Email} onChange={(e) => set("resident1Email", e.target.value)} className={I} /></label>
          </div>
          <p className="text-xs uppercase tracking-wider font-semibold text-muted-foreground pt-1">Resident 2 (optional)</p>
          <label className={L}>Name<input value={form.resident2Name} onChange={(e) => set("resident2Name", e.target.value)} className={I} /></label>
          <div className="grid grid-cols-2 gap-2">
            <label className={L}>Phone<input type="tel" value={form.resident2Phone} onChange={(e) => set("resident2Phone", e.target.value)} className={I} /></label>
            <label className={L}>Email<input type="email" value={form.resident2Email} onChange={(e) => set("resident2Email", e.target.value)} className={I} /></label>
          </div>
          <button type="button" onClick={() => save.mutate()} disabled={save.isPending || !form.address.trim()}
            className="w-full rounded-xl py-3 text-sm font-bold text-white disabled:opacity-50" style={{ backgroundColor: "#B23A2E" }}>
            {save.isPending ? "Saving…" : "Save Changes"}
          </button>
        </div>
      </div>
    </div>
  );
}
