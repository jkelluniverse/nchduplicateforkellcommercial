import { useState, useCallback, useEffect, useRef } from "react";
import { SheetButtonRow } from "@/components/sheet-button-row";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import {
  Search, ChevronRight, ArrowLeft, FileText, Scale, Bell, Receipt, Wrench, Users,
  CheckCircle2, Download, Share2, Plus, Trash2, RefreshCw, Key,
} from "lucide-react";
import { format, addDays } from "date-fns";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem("nch_token")}`, "Content-Type": "application/json" };
}

type Screen = "select" | "form" | "success";

interface FieldSchema {
  id: string; label: string;
  type: "text" | "textarea" | "date" | "currency" | "number" | "percent" | "dropdown" | "radio" | "repeating_group" | "calculated" | "static";
  required?: boolean; placeholder?: string; default?: string; note?: string;
  options?: string[]; formula?: string; subfields?: FieldSchema[];
}

interface DocSchema {
  id: string; title: string; category: string; description: string;
  pdf_style: "branded" | "legal" | "static"; drive_folder: string;
  filename_pattern: string; fields: FieldSchema[]; static_file?: string;
}

interface GenerateResult {
  success: boolean; historyId: number; filename: string;
  driveUrl: string; driveFolder: string; savedMsg: string; pdfBase64: string;
}

interface HistoryRow {
  id: number; docType: string; docTitle: string; generatedBy: string;
  filename: string; driveUrl: string; driveFolder: string; generatedAt: string;
  fieldData: Record<string, any>;
}

interface PropertyOption {
  id: string | number;
  address: string;
  resident1Name: string | null;
  resident2Name: string | null;
  tenantName: string | null;
  tenantPhone?: string | null;
  tenantEmail?: string | null;
  monthlyPayment: number | null;
}

// Field IDs across the doc schemas that map to a property/tenant. When a
// user picks a property from the dropdown we auto-fill any field whose id
// appears below using the matched property's data.
const PROPERTY_PREFILL_MAP: Record<string, "address" | "tenantName"> = {
  property_address: "address",
  tenant_name: "tenantName",
  buyer_name: "tenantName",
  occupant_name: "tenantName",
  received_from: "tenantName",
};

function fieldHasPropertyPrefill(fieldIds: string[]): boolean {
  return fieldIds.some((id) => id in PROPERTY_PREFILL_MAP);
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  "Notices": <Bell className="w-5 h-5" />,
  "Legal": <Scale className="w-5 h-5" />,
  "Financial": <Receipt className="w-5 h-5" />,
  "Tenant / Occupant": <Users className="w-5 h-5" />,
  "Contracting": <Wrench className="w-5 h-5" />,
  "Closing": <Key className="w-5 h-5" />,
};

function resolveDefault(def: string | undefined): string {
  if (!def) return "";
  if (def === "today") return format(new Date(), "yyyy-MM-dd");
  const m = def.match(/^today\+(\d+)$/);
  if (m) return format(addDays(new Date(), parseInt(m[1], 10)), "yyyy-MM-dd");
  return def;
}

function evalFormula(formula: string, values: Record<string, string>): number {
  let expr = formula;
  for (const [key, val] of Object.entries(values)) {
    expr = expr.replace(new RegExp(`\\b${key}\\b`, "g"), String(parseFloat(val) || 0));
  }
  try { return Function(`"use strict"; return (${expr})`)() as number; } catch { return 0; }
}

function fmtCurrency(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default function Docs() {
  const { toast } = useToast();
  const [screen, setScreen] = useState<Screen>("select");
  const [selectedSchema, setSelectedSchema] = useState<DocSchema | null>(null);
  const [formValues, setFormValues] = useState<Record<string, string>>({});
  const [repeatingValues, setRepeatingValues] = useState<Record<string, Array<Record<string, string>>>>({});
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [search, setSearch] = useState("");
  const [errors, setErrors] = useState<Record<string, boolean>>({});

  const { data: schemas, isLoading: schemasLoading } = useQuery<DocSchema[]>({
    queryKey: ["doc-schemas"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/docs/schemas`, { headers: authHeaders() });
      return r.json();
    },
  });

  const { data: recent } = useQuery<HistoryRow[]>({
    queryKey: ["doc-recent"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/docs/recent?limit=5`, { headers: authHeaders() });
      return r.json();
    },
  });

  // Property list — always use local /api/properties (synced from DoorLoop every 30 min).
  // Compute tenantName from both residents for prefill and display.
  const { data: properties } = useQuery<PropertyOption[]>({
    queryKey: ["properties-prefill"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/properties`, { headers: authHeaders() });
      const rows: Array<{ id: number; address: string; resident1Name: string | null; resident2Name: string | null; [k: string]: unknown }> = await r.json();
      return rows.map((p) => {
        const r1 = p.resident1Name?.trim() || null;
        const r2 = p.resident2Name?.trim() || null;
        const tenantName = r1 && r2 ? `${r1} & ${r2}` : r1 ?? null;
        return { ...p, tenantName, monthlyPayment: null };
      });
    },
    staleTime: 5 * 60 * 1000,
  });

  const generate = useMutation({
    mutationFn: async (payload: { doc_type: string; data: Record<string, any> }) => {
      const r = await fetch(`${API_BASE}/api/docs/generate`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error((await r.json()).error || "Generation failed");
      return r.json() as Promise<GenerateResult>;
    },
    onSuccess: (data) => {
      setResult(data);
      setScreen("success");
    },
    onError: (err: any) => {
      toast({ title: "Generation failed", description: err.message, variant: "destructive" });
    },
  });

  const openForm = useCallback((schema: DocSchema) => {
    setSelectedSchema(schema);
    const defaults: Record<string, string> = {};
    const reps: Record<string, Array<Record<string, string>>> = {};
    for (const f of schema.fields) {
      if (f.type === "repeating_group") {
        reps[f.id] = [{}];
      } else if (f.type !== "calculated") {
        defaults[f.id] = resolveDefault(f.default);
      }
    }
    setFormValues(defaults);
    setRepeatingValues(reps);
    setErrors({});
    setScreen("form");
  }, []);

  // Read sessionStorage prefill written by "Send Notice" in the Payment Situations widget.
  // Fires once schemas are loaded; applies field overrides after openForm sets defaults.
  const pendingPrefill = useRef<Record<string, string> | null>(null);
  useEffect(() => {
    const raw = sessionStorage.getItem("nch_docs_prefill");
    if (!raw || !schemas) return;
    try {
      const { docId, fields } = JSON.parse(raw) as { docId: string; fields: Record<string, string> };
      const schema = schemas.find((s) => s.id === docId);
      if (!schema) return;
      sessionStorage.removeItem("nch_docs_prefill");
      pendingPrefill.current = fields;
      openForm(schema);
    } catch { /* ignore malformed data */ }
  }, [schemas, openForm]);
  // After openForm transitions to "form" screen, merge the prefill values on top of defaults.
  useEffect(() => {
    if (pendingPrefill.current && screen === "form") {
      const fields = pendingPrefill.current;
      pendingPrefill.current = null;
      setFormValues((prev) => ({ ...prev, ...fields }));
    }
  }, [screen]);

  const downloadStatic = useCallback(async (schema: DocSchema) => {
    if (!schema.static_file) return;
    const r = await fetch(`${API_BASE}/api/docs/static/${encodeURIComponent(schema.static_file)}`, { headers: authHeaders() });
    if (!r.ok) { toast({ title: "Download failed", variant: "destructive" }); return; }
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = schema.static_file; a.click();
    URL.revokeObjectURL(url);
  }, [toast]);

  const setField = (id: string, val: string) => setFormValues((prev) => ({ ...prev, [id]: val }));

  const setSubField = (groupId: string, rowIdx: number, subId: string, val: string) => {
    setRepeatingValues((prev) => {
      const rows = [...(prev[groupId] || [])];
      rows[rowIdx] = { ...rows[rowIdx], [subId]: val };
      return { ...prev, [groupId]: rows };
    });
  };

  const addRow = (groupId: string) => {
    setRepeatingValues((prev) => ({ ...prev, [groupId]: [...(prev[groupId] || []), {}] }));
  };

  const removeRow = (groupId: string, idx: number) => {
    setRepeatingValues((prev) => {
      const rows = [...(prev[groupId] || [])];
      rows.splice(idx, 1);
      return { ...prev, [groupId]: rows };
    });
  };

  const handleSubmit = () => {
    if (!selectedSchema) return;
    const newErrors: Record<string, boolean> = {};
    for (const f of selectedSchema.fields) {
      if (f.required && f.type !== "calculated" && f.type !== "static") {
        if (f.type === "repeating_group") {
          if (!repeatingValues[f.id]?.length) newErrors[f.id] = true;
        } else if (!formValues[f.id]) {
          newErrors[f.id] = true;
        }
      }
    }
    if (Object.keys(newErrors).length) {
      setErrors(newErrors);
      toast({ title: "Please fill in all required fields", variant: "destructive" });
      return;
    }
    setErrors({});
    const data: Record<string, any> = { ...formValues };
    for (const [k, v] of Object.entries(repeatingValues)) { data[k] = v; }
    generate.mutate({ doc_type: selectedSchema.id, data });
  };

  const downloadPdf = () => {
    if (!result?.pdfBase64 || !result?.filename) return;
    const bytes = atob(result.pdfBase64);
    const arr = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
    const blob = new Blob([arr], { type: "application/pdf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = result.filename; a.click();
    URL.revokeObjectURL(url);
  };

  const share = async () => {
    if (result?.driveUrl) {
      if (navigator.share) {
        await navigator.share({ title: result.filename, url: result.driveUrl });
      } else {
        await navigator.clipboard.writeText(result.driveUrl);
        toast({ title: "Drive link copied to clipboard" });
      }
    }
  };

  const reloadFromHistory = (row: HistoryRow) => {
    const schema = schemas?.find((s) => s.id === row.docType);
    if (!schema) return;
    setSelectedSchema(schema);
    const fd = row.fieldData as Record<string, any>;
    const vals: Record<string, string> = {};
    const reps: Record<string, Array<Record<string, string>>> = {};
    for (const f of schema.fields) {
      if (f.type === "repeating_group") {
        reps[f.id] = fd[f.id] || [{}];
      } else {
        vals[f.id] = String(fd[f.id] ?? "");
      }
    }
    setFormValues(vals);
    setRepeatingValues(reps);
    setErrors({});
    setScreen("form");
  };

  // Deep-link from Rent Collection widget: open a notice form pre-filled with
  // tenant + property + amounts. Consumed once and cleared from sessionStorage.
  useEffect(() => {
    if (!schemas || screen !== "select") return;
    const raw = sessionStorage.getItem("nch_doc_prefill");
    if (!raw) return;
    sessionStorage.removeItem("nch_doc_prefill");
    try {
      const parsed = JSON.parse(raw) as { doc_type: string; prefill: Record<string, string | number> };
      const schema = schemas.find((s) => s.id === parsed.doc_type);
      if (!schema) return;
      setSelectedSchema(schema);
      const defaults: Record<string, string> = {};
      const reps: Record<string, Array<Record<string, string>>> = {};
      for (const f of schema.fields) {
        if (f.type === "repeating_group") {
          reps[f.id] = [{}];
        } else if (f.type !== "calculated") {
          const incoming = parsed.prefill[f.id];
          if (incoming !== undefined && incoming !== null && String(incoming) !== "") {
            defaults[f.id] = String(incoming);
          } else {
            defaults[f.id] = resolveDefault(f.default);
          }
        }
      }
      setFormValues(defaults);
      setRepeatingValues(reps);
      setErrors({});
      setScreen("form");
    } catch {
      /* ignore malformed payload */
    }
  }, [schemas, screen]);

  // Category grouping
  const categories = schemasLoading ? [] : [...new Set(schemas?.map((s) => s.category) || [])];
  const filtered = schemas?.filter((s) =>
    !search || s.title.toLowerCase().includes(search.toLowerCase()) || s.category.toLowerCase().includes(search.toLowerCase())
  ) || [];

  // ── SCREEN 1: Selection ───────────────────────────────────────────────
  if (screen === "select") {
    return (
      <div className="pb-24">
        <div className="bg-primary text-primary-foreground p-4 sticky top-0 z-10 shadow-md">
          <h1 className="text-2xl font-bold">Document Maker</h1>
          <p className="text-sm text-primary-foreground/70 mt-0.5">Select a document to get started</p>
          <div className="relative mt-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary-foreground/50" />
            <Input
              value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Search documents..."
              className="pl-9 bg-white/10 border-white/20 text-white placeholder:text-white/50 h-10"
            />
          </div>
        </div>

        <div className="p-4 space-y-6">
          {schemasLoading ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)
          ) : (
            categories
              .filter((cat) => filtered.some((s) => s.category === cat))
              .map((cat) => (
                <div key={cat}>
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-primary">{CATEGORY_ICONS[cat] || <FileText className="w-5 h-5" />}</span>
                    <h2 className="font-bold text-sm uppercase tracking-wider text-muted-foreground">{cat}</h2>
                  </div>
                  <div className="space-y-2">
                    {filtered.filter((s) => s.category === cat).map((schema) => (
                      <button
                        key={schema.id}
                        type="button"
                        onClick={() => schema.pdf_style === "static" ? downloadStatic(schema) : openForm(schema)}
                        className="w-full text-left"
                      >
                        <Card className="hover:shadow-md transition-shadow border-l-4 border-l-primary/20 hover:border-l-primary">
                          <CardContent className="p-4 flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-semibold text-sm">{schema.title}</p>
                              <p className="text-xs text-muted-foreground mt-0.5 truncate">{schema.description}</p>
                              {schema.pdf_style === "legal" && (
                                <Badge variant="outline" className="text-[10px] mt-1 text-purple-600 border-purple-300">Stark County Recorder</Badge>
                              )}
                              {schema.pdf_style === "static" && (
                                <Badge variant="outline" className="text-[10px] mt-1 text-green-700 border-green-300">Direct Download</Badge>
                              )}
                            </div>
                            {schema.pdf_style === "static"
                              ? <Download className="w-4 h-4 text-green-600 shrink-0" />
                              : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
                          </CardContent>
                        </Card>
                      </button>
                    ))}
                  </div>
                </div>
              ))
          )}

          {/* Recent Documents */}
          {recent && recent.length > 0 && (
            <div>
              <h2 className="font-bold text-sm uppercase tracking-wider text-muted-foreground mb-3">Recent Documents</h2>
              <div className="space-y-2">
                {recent.map((row) => (
                  <Card key={row.id} className="cursor-pointer hover:shadow-sm" onClick={() => {
                    setResult({
                      success: true, historyId: row.id, filename: row.filename,
                      driveUrl: row.driveUrl || "", driveFolder: row.driveFolder || "",
                      savedMsg: row.driveUrl ? `Saved to Drive: ${row.driveFolder}` : "No Drive link",
                      pdfBase64: "",
                    });
                    setSelectedSchema(schemas?.find((s) => s.id === row.docType) || null);
                    setScreen("success");
                  }}>
                    <CardContent className="p-3 flex items-center gap-3">
                      <FileText className="w-8 h-8 text-primary/60 shrink-0" />
                      <div className="min-w-0 flex-1">
                        <p className="font-medium text-sm truncate">{row.docTitle}</p>
                        <p className="text-xs text-muted-foreground">{format(new Date(row.generatedAt), "MMM d, yyyy 'at' h:mm a")}</p>
                      </div>
                      <button type="button" onClick={(e) => { e.stopPropagation(); reloadFromHistory(row); }}
                        className="p-2 rounded-full hover:bg-muted shrink-0">
                        <RefreshCw className="w-4 h-4 text-muted-foreground" />
                      </button>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── SCREEN 2: Form ────────────────────────────────────────────────────
  if (screen === "form" && selectedSchema) {
    return (
      <div className="pb-6">
        <div className="bg-primary text-primary-foreground p-4 sticky top-0 z-10 shadow-md">
          <button type="button" onClick={() => setScreen("select")} className="flex items-center gap-1 text-sm text-primary-foreground/70 mb-2">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <h1 className="text-xl font-bold leading-tight">{selectedSchema.title}</h1>
          {selectedSchema.pdf_style === "legal" && (
            <Badge className="mt-1 bg-purple-700 text-white text-[10px]">Legal — Recorder Compliant</Badge>
          )}
        </div>

        <div className="p-4 space-y-5">
          {/* Property prefill — appears on schemas with a property_address /
              tenant_name field so Mike & Jacob can pick from their portfolio
              instead of typing the address every time. */}
          {fieldHasPropertyPrefill(selectedSchema.fields.map((f) => f.id)) && properties && properties.length > 0 && (
            <div className="space-y-1.5 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
              <Label className="text-emerald-800 font-semibold text-xs uppercase tracking-wide">
                Quick Fill from Property
              </Label>
              <Select
                onValueChange={(propIdStr) => {
                  // Compare by string identity so DoorLoop string ObjectIds
                  // and local numeric IDs both work.
                  const p = properties.find((x) => String(x.id) === propIdStr);
                  if (!p) return;
                  setFormValues((prev) => {
                    const next = { ...prev };
                    for (const f of selectedSchema.fields) {
                      const map = PROPERTY_PREFILL_MAP[f.id];
                      if (map === "address") next[f.id] = p.address;
                      else if (map === "tenantName" && p.tenantName) next[f.id] = p.tenantName;
                    }
                    return next;
                  });
                  toast({
                    title: "Pre-filled",
                    description: `${p.address.split(",")[0]}${p.tenantName ? " · " + p.tenantName : ""}`,
                  });
                }}
              >
                <SelectTrigger className="h-11 bg-white">
                  <SelectValue placeholder="Pick a property to auto-fill address & tenant…" />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  {properties
                    .slice()
                    .sort((a, b) => a.address.localeCompare(b.address))
                    .map((p) => {
                      const r1 = p.resident1Name?.trim() || null;
                      const r2 = p.resident2Name?.trim() || null;
                      const label = p.address + (r1 && r2 ? ` — ${r1} & ${r2}` : r1 ? ` — ${r1}` : " — Vacant");
                      return (
                        <SelectItem key={p.id} value={String(p.id)}>
                          <span className="block text-left truncate">{label}</span>
                        </SelectItem>
                      );
                    })}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-emerald-700">
                Pulls tenant info from local property records · You can still edit any field below.
              </p>
            </div>
          )}

          {selectedSchema.fields.map((field) => {
            const val = formValues[field.id] ?? "";
            const hasError = errors[field.id];

            if (field.type === "static") {
              return (
                <div key={field.id} className="space-y-1">
                  <Label className="text-muted-foreground">{field.label}</Label>
                  <p className="text-sm text-muted-foreground bg-muted px-3 py-2 rounded-md">{field.default || val}</p>
                </div>
              );
            }

            if (field.type === "calculated") {
              const calc = evalFormula(field.formula || "0", formValues);
              return (
                <div key={field.id} className="space-y-1">
                  <Label className="text-muted-foreground">{field.label}</Label>
                  <p className="text-base font-bold text-primary bg-primary/5 px-3 py-2.5 rounded-md border border-primary/20">
                    {fmtCurrency(calc)}
                  </p>
                  {field.note && <p className="text-xs text-muted-foreground">{field.note}</p>}
                </div>
              );
            }

            if (field.type === "repeating_group") {
              const rows = repeatingValues[field.id] || [];
              return (
                <div key={field.id} className={`space-y-2 p-3 rounded-lg border-2 ${hasError ? "border-red-400 bg-red-50" : "border-border"}`}>
                  <div className="flex items-center justify-between">
                    <Label className={hasError ? "text-red-600" : ""}>{field.label}{field.required && <span className="text-red-500 ml-1">*</span>}</Label>
                  </div>
                  {field.note && <p className="text-xs text-muted-foreground">{field.note}</p>}
                  {rows.map((row, idx) => (
                    <div key={idx} className="bg-muted/50 rounded-lg p-3 space-y-2">
                      <div className="flex justify-between items-center">
                        <span className="text-xs font-medium text-muted-foreground">Row {idx + 1}</span>
                        {rows.length > 1 && (
                          <button type="button" onClick={() => removeRow(field.id, idx)} className="text-red-400 hover:text-red-600">
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                      {(field.subfields || []).map((sf) => (
                        <div key={sf.id} className="space-y-1">
                          <Label className="text-xs">{sf.label}</Label>
                          {sf.type === "currency" ? (
                            <div className="relative">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
                              <Input type="number" step="0.01" value={row[sf.id] || ""}
                                onChange={(e) => setSubField(field.id, idx, sf.id, e.target.value)}
                                className="pl-7 h-9" placeholder={sf.placeholder} />
                            </div>
                          ) : (
                            <Input value={row[sf.id] || ""}
                              onChange={(e) => setSubField(field.id, idx, sf.id, e.target.value)}
                              className="h-9" placeholder={sf.placeholder} />
                          )}
                        </div>
                      ))}
                    </div>
                  ))}
                  <Button type="button" variant="outline" size="sm" onClick={() => addRow(field.id)} className="w-full gap-1">
                    <Plus className="w-4 h-4" /> Add Row
                  </Button>
                </div>
              );
            }

            const baseClass = `${hasError ? "border-red-400 bg-red-50" : ""}`;

            return (
              <div key={field.id} className="space-y-1">
                <Label className={hasError ? "text-red-600" : ""}>
                  {field.label}
                  {field.required && <span className="text-red-500 ml-1">*</span>}
                </Label>

                {field.type === "textarea" && (
                  <Textarea value={val} onChange={(e) => setField(field.id, e.target.value)}
                    placeholder={field.placeholder} className={`min-h-[90px] ${baseClass}`} />
                )}

                {field.type === "text" && (
                  <Input value={val} onChange={(e) => setField(field.id, e.target.value)}
                    placeholder={field.placeholder} className={`h-11 ${baseClass}`} />
                )}

                {field.type === "date" && (
                  <Input type="date" value={val} onChange={(e) => setField(field.id, e.target.value)}
                    className={`h-11 ${baseClass}`} />
                )}

                {field.type === "currency" && (
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">$</span>
                    <Input type="number" step="0.01" min="0" value={val}
                      onChange={(e) => setField(field.id, e.target.value)}
                      className={`pl-7 h-11 ${baseClass}`} placeholder="0.00" />
                  </div>
                )}

                {field.type === "number" && (
                  <Input type="number" value={val} onChange={(e) => setField(field.id, e.target.value)}
                    placeholder={field.placeholder} className={`h-11 ${baseClass}`} />
                )}

                {field.type === "percent" && (
                  <div className="relative">
                    <Input type="number" step="0.01" min="0" max="100" value={val}
                      onChange={(e) => setField(field.id, e.target.value)}
                      className={`pr-8 h-11 ${baseClass}`} placeholder="0.00" />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">%</span>
                  </div>
                )}

                {(field.type === "dropdown" || field.type === "radio") && (
                  <Select value={val} onValueChange={(v) => setField(field.id, v)}>
                    <SelectTrigger className={`h-11 ${baseClass}`}>
                      <SelectValue placeholder={field.placeholder || "Select..."} />
                    </SelectTrigger>
                    <SelectContent>
                      {(field.options || []).map((opt) => (
                        <SelectItem key={opt} value={opt}>{opt}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}

                {field.note && <p className="text-xs text-muted-foreground">{field.note}</p>}
              </div>
            );
          })}
          <SheetButtonRow className="mt-4">
            <Button
              onClick={handleSubmit}
              disabled={generate.isPending}
              className="flex-1 h-12 font-bold"
              style={{ backgroundColor: "#8B0000", color: "white" }}
            >
              {generate.isPending ? (
                <span className="flex items-center gap-2"><RefreshCw className="w-4 h-4 animate-spin" /> Generating document...</span>
              ) : (
                "Generate Document"
              )}
            </Button>
          </SheetButtonRow>
        </div>
      </div>
    );
  }

  // ── SCREEN 3: Success ─────────────────────────────────────────────────
  if (screen === "success" && result) {
    return (
      <div className="pb-20">
        <div className="bg-primary text-primary-foreground p-4 sticky top-0 z-10 shadow-md">
          <h1 className="text-2xl font-bold">Document Ready</h1>
        </div>

        <div className="p-6 flex flex-col items-center text-center gap-4 mt-4">
          <div className="w-20 h-20 rounded-full bg-green-100 flex items-center justify-center">
            <CheckCircle2 className="w-10 h-10 text-green-600" />
          </div>
          <div>
            <p className="text-xl font-bold">{selectedSchema?.title}</p>
            <p className="text-sm text-muted-foreground mt-1">{result.filename}</p>
          </div>
          {result.savedMsg && (
            <div className="bg-green-50 border border-green-200 rounded-lg px-4 py-2 w-full text-left">
              <p className="text-xs font-semibold text-green-700">Google Drive</p>
              <p className="text-xs text-green-600 mt-0.5">{result.savedMsg}</p>
            </div>
          )}
        </div>

        <div className="px-4 space-y-3">
          {result.pdfBase64 && (
            <Button onClick={downloadPdf} className="w-full h-12 gap-2" style={{ backgroundColor: "#8B0000", color: "white" }}>
              <Download className="w-5 h-5" /> Download PDF
            </Button>
          )}
          {result.driveUrl && (
            <Button onClick={share} variant="outline" className="w-full h-12 gap-2">
              <Share2 className="w-5 h-5" /> Share Drive Link
            </Button>
          )}
          {result.driveUrl && !result.pdfBase64 && (
            <Button onClick={() => window.open(`https://drive.google.com/uc?export=download&id=${result.driveUrl.match(/[-\w]{25,}/)?.[0]}`, "_blank")}
              className="w-full h-12 gap-2" style={{ backgroundColor: "#8B0000", color: "white" }}>
              <Download className="w-5 h-5" /> Download from Drive
            </Button>
          )}
          <div className="flex gap-3 pt-2">
            <Button variant="outline" onClick={() => { setScreen("select"); setResult(null); }} className="flex-1 h-11">
              Generate Another
            </Button>
            <Button variant="outline" onClick={() => {
              if (selectedSchema) {
                const fd = result.historyId ? (recent?.find((r) => r.id === result.historyId)?.fieldData || {}) : {};
                const vals: Record<string, string> = {};
                const reps: Record<string, Array<Record<string, string>>> = {};
                for (const f of selectedSchema.fields) {
                  if (f.type === "repeating_group") reps[f.id] = (fd as any)[f.id] || [{}];
                  else vals[f.id] = String((fd as any)[f.id] ?? formValues[f.id] ?? "");
                }
                setFormValues(vals);
                setRepeatingValues(reps);
                setScreen("form");
              }
            }} className="flex-1 h-11">
              Edit &amp; Regenerate
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
