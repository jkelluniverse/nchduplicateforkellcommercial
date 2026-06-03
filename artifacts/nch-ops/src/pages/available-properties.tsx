import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowLeft, Plus, FileDown, Pencil, Trash2, ArrowUp, ArrowDown, Loader2, Bed, Bath } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";

interface AvailableProperty {
  id: number;
  number: string | null;
  address: string;
  cityStateZip: string;
  beds: number | null;
  baths: number | null;
  notes: string | null;
  active: boolean;
  sortOrder: number;
  addedAt: string;
}

const API = "/api/available-properties";

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem("nch_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function fetchJson<T>(url: string, opts: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...opts,
    headers: { "Content-Type": "application/json", ...authHeaders(), ...(opts.headers || {}) },
  });
  if (!res.ok) {
    let msg = res.statusText;
    try { const j = await res.json(); msg = j.error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return res.json();
}

export default function AvailablePropertiesPage() {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const canEdit = user?.role === "mike" || user?.role === "jacob";

  const [editTarget, setEditTarget] = useState<AvailableProperty | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<AvailableProperty | null>(null);
  const [generating, setGenerating] = useState(false);

  const { data: properties = [], isLoading } = useQuery<AvailableProperty[]>({
    queryKey: ["available-properties"],
    queryFn: () => fetchJson<AvailableProperty[]>(API),
  });

  const reorderMut = useMutation({
    mutationFn: (ids: number[]) =>
      fetchJson(`${API}/reorder`, { method: "POST", body: JSON.stringify({ ids }) }),
    onMutate: async (ids: number[]) => {
      await qc.cancelQueries({ queryKey: ["available-properties"] });
      const prev = qc.getQueryData<AvailableProperty[]>(["available-properties"]);
      if (prev) {
        const idToRow = new Map(prev.map((p) => [p.id, p]));
        const reordered = ids.map((id, i) => {
          const row = idToRow.get(id)!;
          return { ...row, sortOrder: i + 1 };
        });
        qc.setQueryData(["available-properties"], reordered);
      }
      return { prev };
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(["available-properties"], ctx.prev);
      toast({ title: "Reorder failed", description: (err as Error).message, variant: "destructive" });
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ["available-properties"] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: number) => fetchJson(`${API}/${id}`, { method: "DELETE" }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["available-properties"] });
      toast({ title: "Property removed" });
      setDeleteTarget(null);
    },
    onError: (err) => toast({ title: "Remove failed", description: (err as Error).message, variant: "destructive" }),
  });

  function move(idx: number, dir: -1 | 1) {
    const next = idx + dir;
    if (next < 0 || next >= properties.length) return;
    const ids = properties.map((p) => p.id);
    [ids[idx], ids[next]] = [ids[next], ids[idx]];
    reorderMut.mutate(ids);
  }

  async function generatePdf() {
    setGenerating(true);
    try {
      const res = await fetch(`${API}/generate-pdf`, { headers: authHeaders() });
      if (!res.ok) {
        let msg = res.statusText;
        try { const j = await res.json(); msg = j.error || msg; } catch { /* ignore */ }
        throw new Error(msg);
      }
      const blob = await res.blob();
      const cd = res.headers.get("content-disposition") || "";
      const m = /filename="?([^"]+)"?/i.exec(cd);
      const filename = m?.[1] || "NCH_Available_Properties.pdf";
      const a = document.createElement("a");
      const url = URL.createObjectURL(blob);
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast({ title: "PDF generated", description: "Saved a copy to Google Drive too." });
    } catch (err) {
      toast({ title: "PDF generation failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="pb-24">
      {/* Header */}
      <div className="bg-primary text-primary-foreground p-4 sticky top-0 z-10 shadow-md flex items-center gap-3">
        <Link href="/more">
          <Button variant="ghost" size="icon" className="text-primary-foreground hover:bg-white/10" aria-label="Back">
            <ArrowLeft className="w-5 h-5" />
          </Button>
        </Link>
        <h1 className="text-xl font-bold">Available Properties</h1>
      </div>

      <div className="p-4 space-y-3">
        {/* Action bar */}
        <div className="flex flex-col gap-2">
          <Button onClick={generatePdf} disabled={generating} className="w-full h-12 text-base font-semibold">
            {generating ? <Loader2 className="w-5 h-5 mr-2 animate-spin" /> : <FileDown className="w-5 h-5 mr-2" />}
            {generating ? "Generating..." : "Generate & Download PDF"}
          </Button>
          {canEdit && (
            <Button variant="outline" className="w-full h-12 text-base font-semibold" onClick={() => setCreateOpen(true)}>
              <Plus className="w-5 h-5 mr-2" /> Add Property
            </Button>
          )}
        </div>

        {/* List */}
        {isLoading && (
          <div className="flex justify-center py-8 text-muted-foreground">
            <Loader2 className="w-6 h-6 animate-spin" />
          </div>
        )}

        {!isLoading && properties.length === 0 && (
          <Card><CardContent className="p-6 text-center text-muted-foreground">No properties yet.</CardContent></Card>
        )}

        {properties.map((p, idx) => (
          <Card key={p.id} className="overflow-hidden">
            <CardContent className="p-4">
              <div className="flex items-start gap-3">
                {/* # badge */}
                <div className="shrink-0 w-9 h-9 rounded-full bg-primary/10 text-primary font-bold flex items-center justify-center text-sm">
                  {p.number || String(idx + 1).padStart(2, "0")}
                </div>
                {/* Body */}
                <div className="flex-1 min-w-0">
                  <div className="font-bold text-base leading-tight">{p.address}</div>
                  <div className="text-sm text-muted-foreground">{p.cityStateZip}</div>
                  <div className="flex items-center gap-3 mt-2 text-sm">
                    {p.beds != null && (
                      <span className="inline-flex items-center gap-1"><Bed className="w-4 h-4" /> {p.beds}</span>
                    )}
                    {p.baths != null && (
                      <span className="inline-flex items-center gap-1"><Bath className="w-4 h-4" /> {p.baths}</span>
                    )}
                  </div>
                  {p.notes && <div className="text-xs italic text-muted-foreground mt-1">{p.notes}</div>}
                </div>
                {/* Reorder */}
                {canEdit && (
                  <div className="flex flex-col gap-1 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={idx === 0 || reorderMut.isPending}
                      onClick={() => move(idx, -1)}
                      aria-label="Move up"
                    >
                      <ArrowUp className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      disabled={idx === properties.length - 1 || reorderMut.isPending}
                      onClick={() => move(idx, 1)}
                      aria-label="Move down"
                    >
                      <ArrowDown className="w-4 h-4" />
                    </Button>
                  </div>
                )}
              </div>
              {/* Actions */}
              {canEdit && (
                <div className="flex gap-2 mt-3">
                  <Button variant="outline" size="sm" className="flex-1" onClick={() => setEditTarget(p)}>
                    <Pencil className="w-4 h-4 mr-1" /> Edit
                  </Button>
                  <Button variant="outline" size="sm" className="flex-1 text-destructive hover:text-destructive" onClick={() => setDeleteTarget(p)}>
                    <Trash2 className="w-4 h-4 mr-1" /> Remove
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Add / Edit dialogs */}
      <PropertyFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="Add Property"
        onSaved={() => qc.invalidateQueries({ queryKey: ["available-properties"] })}
      />
      <PropertyFormDialog
        open={!!editTarget}
        onOpenChange={(o) => { if (!o) setEditTarget(null); }}
        title="Edit Property"
        property={editTarget ?? undefined}
        onSaved={() => qc.invalidateQueries({ queryKey: ["available-properties"] })}
      />

      {/* Confirm delete */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this property?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteTarget?.address} will be removed from the Available Properties list. You can re-add it later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteTarget && deleteMut.mutate(deleteTarget.id)}
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function PropertyFormDialog({
  open,
  onOpenChange,
  title,
  property,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  property?: AvailableProperty;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const isEdit = !!property;
  const [form, setForm] = useState({
    number: "",
    address: "",
    cityStateZip: "",
    beds: "",
    baths: "",
    notes: "",
  });
  const [saving, setSaving] = useState(false);

  // Reset form whenever the dialog opens or the target property changes.
  useEffect(() => {
    if (!open) return;
    setForm({
      number: property?.number ?? "",
      address: property?.address ?? "",
      cityStateZip: property?.cityStateZip ?? "",
      beds: property?.beds != null ? String(property.beds) : "",
      baths: property?.baths != null ? String(property.baths) : "",
      notes: property?.notes ?? "",
    });
  }, [open, property?.id, property?.address, property?.cityStateZip, property?.beds, property?.baths, property?.notes, property?.number]);

  async function submit() {
    if (!form.address.trim() || !form.cityStateZip.trim()) {
      toast({ title: "Address and city/state/zip are required", variant: "destructive" });
      return;
    }
    const payload = {
      number: form.number.trim() || null,
      address: form.address.trim(),
      cityStateZip: form.cityStateZip.trim(),
      beds: form.beds.trim() ? Number(form.beds) : null,
      baths: form.baths.trim() ? Number(form.baths) : null,
      notes: form.notes.trim() || null,
    };
    setSaving(true);
    try {
      if (isEdit && property) {
        await fetchJson(`${API}/${property.id}`, { method: "PUT", body: JSON.stringify(payload) });
        toast({ title: "Property updated" });
      } else {
        await fetchJson(API, { method: "POST", body: JSON.stringify(payload) });
        toast({ title: "Property added" });
      }
      onSaved();
      onOpenChange(false);
      if (!isEdit) {
        setForm({ number: "", address: "", cityStateZip: "", beds: "", baths: "", notes: "" });
      }
    } catch (err) {
      toast({ title: "Save failed", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="ap-number">Number (optional)</Label>
            <Input id="ap-number" value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} placeholder="e.g. 13" />
          </div>
          <div>
            <Label htmlFor="ap-address">Address *</Label>
            <Input id="ap-address" value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="1234 Example St NW" />
          </div>
          <div>
            <Label htmlFor="ap-csz">City, State ZIP *</Label>
            <Input id="ap-csz" value={form.cityStateZip} onChange={(e) => setForm({ ...form, cityStateZip: e.target.value })} placeholder="Canton, OH 44703" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ap-beds">Beds</Label>
              <Input id="ap-beds" type="number" inputMode="numeric" value={form.beds} onChange={(e) => setForm({ ...form, beds: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="ap-baths">Baths</Label>
              <Input id="ap-baths" type="number" inputMode="numeric" value={form.baths} onChange={(e) => setForm({ ...form, baths: e.target.value })} />
            </div>
          </div>
          <div>
            <Label htmlFor="ap-notes">Notes</Label>
            <Textarea id="ap-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} placeholder="e.g. Recently renovated" rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving}>
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {isEdit ? "Save Changes" : "Add Property"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
