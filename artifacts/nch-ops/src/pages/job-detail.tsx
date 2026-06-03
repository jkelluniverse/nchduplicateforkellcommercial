import { useState, useEffect } from "react";
import {
  useGetJob, useListJobReceipts, useUpdateJob,
  getGetJobQueryKey, getListJobReceiptsQueryKey,
} from "@workspace/api-client-react";
import { Link, useParams } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  ChevronLeft, Receipt, ChevronRight, AlertTriangle, CheckCircle2,
  Clock, Banknote, FileText, XCircle, ArrowRightLeft,
  FilePlus, FileCheck, Download, Share2, Plus, Trash2, Loader2, CheckCircle,
} from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const STATUSES = [
  { value: "estimate",         label: "Estimate",         color: "bg-gray-500",    desc: "Job created, awaiting client approval" },
  { value: "deposit_received", label: "Deposit Received", color: "bg-blue-500",    desc: "Client paid deposit — ready to start" },
  { value: "in_progress",      label: "In Progress",      color: "bg-amber-500",   desc: "Work is actively underway" },
  { value: "invoiced",         label: "Invoiced",         color: "bg-purple-500",  desc: "Invoice sent, awaiting payment" },
  { value: "paid",             label: "Paid",             color: "bg-green-500",   desc: "Payment received in full" },
  { value: "complete",         label: "Complete",         color: "bg-green-700",   desc: "Job finished and closed out" },
  { value: "closed",           label: "Closed",           color: "bg-gray-800",    desc: "Archived / no further action" },
] as const;

type JobStatus = typeof STATUSES[number]["value"];

function StatusBadge({ status }: { status: string }) {
  const s = STATUSES.find((x) => x.value === status);
  return (
    <Badge className={`${s?.color ?? "bg-gray-500"} text-white border-0 text-xs`}>
      {s?.label ?? status}
    </Badge>
  );
}

function ChangeStatusDialog({ jobId, currentStatus, onChanged }: {
  jobId: number; currentStatus: string; onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const updateJob = useUpdateJob();
  const { toast } = useToast();

  const handleSelect = async (newStatus: JobStatus) => {
    if (newStatus === currentStatus) { setOpen(false); return; }
    try {
      await updateJob.mutateAsync({ jobId, data: { status: newStatus, note: note || undefined } });
      toast({ title: `Status updated to "${STATUSES.find((s) => s.value === newStatus)?.label}"` });
      setOpen(false);
      setNote("");
      onChanged();
    } catch {
      toast({ title: "Failed to update status", variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" className="h-14 font-semibold flex-1">
          <ArrowRightLeft className="w-5 h-5 mr-2" /> Change Status
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Change Job Status</DialogTitle>
        </DialogHeader>
        <div className="space-y-2 pt-2">
          {STATUSES.map((s) => {
            const isCurrent = s.value === currentStatus;
            return (
              <button
                key={s.value}
                onClick={() => handleSelect(s.value)}
                disabled={updateJob.isPending}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-xl border text-left transition-colors",
                  isCurrent
                    ? "border-primary bg-primary/5 cursor-default"
                    : "border-input hover:bg-muted hover:border-primary/40"
                )}
              >
                <div className={`w-3 h-3 rounded-full shrink-0 ${s.color}`} />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-sm">{s.label}</p>
                  <p className="text-xs text-muted-foreground truncate">{s.desc}</p>
                </div>
                {isCurrent && <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />}
                {!isCurrent && <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
              </button>
            );
          })}
        </div>
        <div className="pt-2">
          <label className="text-xs text-muted-foreground block mb-1">Note (optional)</label>
          <input
            className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
            placeholder="Reason for status change..."
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── PDF Modal ───────────────────────────────────────────────────────────────

interface LineItemForm {
  id: number;
  title: string;
  bullets: string;
  qty: number;
  price: number;
}

interface PdfResult {
  filename: string;
  driveUrl: string;
  pdfBase64: string;
  savedTo: string;
}

async function apiPost(path: string, body: unknown): Promise<any> {
  const t = localStorage.getItem("nch_token");
  const res = await fetch(`${BASE}/api${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(t ? { Authorization: `Bearer ${t}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

async function apiFetch(path: string): Promise<any> {
  const t = localStorage.getItem("nch_token");
  const res = await fetch(`${BASE}/api${path}`, {
    headers: t ? { Authorization: `Bearer ${t}` } : {},
  });
  const json = await res.json();
  if (!res.ok) throw new Error(json.error || `Request failed (${res.status})`);
  return json;
}

function downloadPdf(base64: string, filename: string) {
  const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
  const blob = new Blob([bytes], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

async function sharePdf(base64: string, filename: string, driveUrl: string) {
  if (navigator.share && driveUrl) {
    try {
      await navigator.share({ title: filename, url: driveUrl });
      return;
    } catch {}
  }
  if (driveUrl) {
    await navigator.clipboard.writeText(driveUrl);
    return;
  }
  downloadPdf(base64, filename);
}

function GeneratePdfDialog({
  docType,
  job,
  receipts,
}: {
  docType: "estimate" | "invoice";
  job: any;
  receipts: any[];
}) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<"form" | "generating" | "done">("form");
  const [result, setResult] = useState<PdfResult | null>(null);
  const [docNumber, setDocNumber] = useState("");
  const [issuedDate, setIssuedDate] = useState("");
  const [clientName, setClientName] = useState("");
  const [address, setAddress] = useState("");
  const [depositPaid, setDepositPaid] = useState("");
  const [lineItems, setLineItems] = useState<LineItemForm[]>([]);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  function resetForm() {
    const today = new Date();
    const mm = String(today.getMonth() + 1).padStart(2, "0");
    const dd = String(today.getDate()).padStart(2, "0");
    const yyyy = today.getFullYear();
    setIssuedDate(`${mm}/${dd}/${yyyy}`);
    setClientName(job.client || "");
    setAddress(job.address || "");
    setDepositPaid(job.estimateAmount ? String(Math.round(Number(job.estimateAmount) * 0.5)) : "0");

    // Pre-fill line items from receipts or job estimate
    if (receipts && receipts.length > 0) {
      setLineItems(
        receipts.map((r, i) => ({
          id: i,
          title: r.category.replace(/_/g, " ").replace(/\b\w/g, (c: string) => c.toUpperCase()),
          bullets: r.notes || "",
          qty: 1,
          price: Number(r.amount),
        }))
      );
    } else {
      setLineItems([{
        id: 0,
        title: job.description || "Work Completed",
        bullets: "",
        qty: 1,
        price: Number(job.estimateAmount) || 0,
      }]);
    }

    setStep("form");
    setResult(null);
    setCopied(false);
  }

  useEffect(() => {
    if (!open) return;
    resetForm();

    // Fetch next document number
    apiFetch(`/invoices/next-number?type=${docType}`)
      .then((d) => setDocNumber(d.docNumber))
      .catch(() => {
        const yr = new Date().getFullYear();
        setDocNumber(docType === "estimate" ? `EST-${yr}-001` : `INV-${yr}-001`);
      });
  }, [open]);

  function addLineItem() {
    setLineItems((prev) => [...prev, { id: Date.now(), title: "", bullets: "", qty: 1, price: 0 }]);
  }

  function removeLineItem(id: number) {
    setLineItems((prev) => prev.filter((li) => li.id !== id));
  }

  function updateItem(id: number, field: keyof LineItemForm, value: any) {
    setLineItems((prev) => prev.map((li) => li.id === id ? { ...li, [field]: value } : li));
  }

  const subtotal = lineItems.reduce((s, li) => s + li.qty * li.price, 0);

  async function handleGenerate() {
    setStep("generating");
    try {
      const items = lineItems.map((li) => ({
        title: li.title || "Item",
        bullets: li.bullets ? li.bullets.split("\n").map((b) => b.trim()).filter(Boolean) : [],
        qty: Number(li.qty) || 1,
        price: Number(li.price) || 0,
      }));

      const data: any = {
        doc_number: docNumber,
        issued_date: issuedDate,
        client_name: clientName,
        client_address: address,
        line_items: items,
      };
      if (docType === "invoice") {
        data.deposit_paid = parseFloat(depositPaid) || 0;
      }

      const res = await apiPost("/generate-pdf", { type: docType, jobId: job.id, data });
      setResult(res);
      setStep("done");
    } catch (err: any) {
      setStep("form");
      toast({ title: "PDF generation failed", description: err.message, variant: "destructive" });
    }
  }

  const label = docType === "estimate" ? "Estimate" : "Invoice";
  const Icon = docType === "estimate" ? FilePlus : FileCheck;

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); }}>
      <DialogTrigger asChild>
        <Button
          variant={docType === "estimate" ? "outline" : "default"}
          className="h-14 font-semibold flex-1"
        >
          <Icon className="w-5 h-5 mr-2" /> Generate {label}
        </Button>
      </DialogTrigger>

      <DialogContent className="sm:max-w-lg max-h-[90vh] flex flex-col p-0 gap-0">
        <DialogHeader className="px-5 pt-5 pb-3 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2">
            <Icon className="w-5 h-5 text-primary" />
            Generate {label}
          </DialogTitle>
        </DialogHeader>

        {/* ── FORM ── */}
        {step === "form" && (
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
            {/* Doc info */}
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Document Info</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Document #</label>
                  <input
                    className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary font-mono"
                    value={docNumber}
                    onChange={(e) => setDocNumber(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Issued Date</label>
                  <input
                    className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
                    value={issuedDate}
                    onChange={(e) => setIssuedDate(e.target.value)}
                    placeholder="MM/DD/YYYY"
                  />
                </div>
              </div>
            </section>

            {/* Client info */}
            <section>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Client</h3>
              <div className="space-y-2">
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Client Name</label>
                  <input
                    className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
                    value={clientName}
                    onChange={(e) => setClientName(e.target.value)}
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground block mb-1">Property Address</label>
                  <input
                    className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                  />
                </div>
              </div>
            </section>

            {/* Line items */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Line Items</h3>
                <button
                  onClick={addLineItem}
                  className="flex items-center gap-1 text-xs text-primary hover:underline font-medium"
                >
                  <Plus className="w-3.5 h-3.5" /> Add Item
                </button>
              </div>
              <div className="space-y-3">
                {lineItems.map((li) => (
                  <div key={li.id} className="border rounded-xl p-3 bg-muted/30 space-y-2">
                    <div className="flex items-start gap-2">
                      <input
                        className="flex-1 border rounded-lg px-3 py-1.5 text-sm outline-none focus:border-primary bg-white"
                        placeholder="Description / title"
                        value={li.title}
                        onChange={(e) => updateItem(li.id, "title", e.target.value)}
                      />
                      <button
                        onClick={() => removeLineItem(li.id)}
                        className="mt-1 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                    <textarea
                      className="w-full border rounded-lg px-3 py-1.5 text-xs outline-none focus:border-primary bg-white resize-none"
                      placeholder="Bullet points (one per line, optional)"
                      rows={2}
                      value={li.bullets}
                      onChange={(e) => updateItem(li.id, "bullets", e.target.value)}
                    />
                    <div className="flex gap-2">
                      <div className="w-20">
                        <label className="text-xs text-muted-foreground block mb-0.5">QTY</label>
                        <input
                          type="number"
                          className="w-full border rounded-lg px-2 py-1.5 text-sm outline-none focus:border-primary bg-white text-center"
                          value={li.qty}
                          min={1}
                          onChange={(e) => updateItem(li.id, "qty", parseFloat(e.target.value) || 1)}
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-xs text-muted-foreground block mb-0.5">Price ($)</label>
                        <input
                          type="number"
                          className="w-full border rounded-lg px-3 py-1.5 text-sm outline-none focus:border-primary bg-white"
                          value={li.price}
                          min={0}
                          step={0.01}
                          onChange={(e) => updateItem(li.id, "price", parseFloat(e.target.value) || 0)}
                        />
                      </div>
                      <div className="w-24 flex flex-col justify-end">
                        <p className="text-xs text-muted-foreground mb-0.5">Amount</p>
                        <p className="text-sm font-semibold py-1.5 text-right">
                          ${(li.qty * li.price).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                        </p>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Deposit (invoice only) */}
            {docType === "invoice" && (
              <section>
                <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Payment</h3>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs text-muted-foreground block mb-1">Deposit Paid ($)</label>
                    <input
                      type="number"
                      className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:border-primary"
                      value={depositPaid}
                      min={0}
                      step={0.01}
                      onChange={(e) => setDepositPaid(e.target.value)}
                    />
                  </div>
                  <div className="flex flex-col justify-end">
                    <p className="text-xs text-muted-foreground mb-1">Balance Due</p>
                    <p className="text-lg font-bold text-primary">
                      ${Math.max(0, subtotal - (parseFloat(depositPaid) || 0)).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                </div>
              </section>
            )}

            {/* Subtotal preview */}
            <div className="flex justify-between items-center bg-primary/5 rounded-xl px-4 py-3 border border-primary/20">
              <span className="text-sm font-medium">{docType === "estimate" ? "Estimate" : "Subtotal"}</span>
              <span className="text-lg font-bold text-primary">
                ${subtotal.toLocaleString("en-US", { minimumFractionDigits: 2 })}
              </span>
            </div>
          </div>
        )}

        {/* ── GENERATING ── */}
        {step === "generating" && (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 py-16 px-5">
            <Loader2 className="w-12 h-12 text-primary animate-spin" />
            <p className="font-semibold text-lg">Generating PDF...</p>
            <p className="text-sm text-muted-foreground text-center">
              Building your {label} and uploading to Google Drive
            </p>
          </div>
        )}

        {/* ── DONE ── */}
        {step === "done" && result && (
          <div className="flex-1 flex flex-col items-center justify-center gap-5 py-10 px-5">
            <div className="w-16 h-16 rounded-full bg-green-100 flex items-center justify-center">
              <CheckCircle className="w-9 h-9 text-green-600" />
            </div>
            <div className="text-center">
              <p className="font-bold text-xl">{label} Ready</p>
              <p className="text-sm text-muted-foreground mt-1">{result.filename}</p>
            </div>

            {result.savedTo && !result.savedTo.includes("failed") && (
              <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-xl px-4 py-2.5 text-sm text-green-800">
                <CheckCircle2 className="w-4 h-4 text-green-600 shrink-0" />
                <span>Saved to {result.savedTo} ✓</span>
              </div>
            )}

            <div className="flex gap-3 w-full">
              <Button
                className="flex-1 h-13"
                variant="outline"
                onClick={() => downloadPdf(result.pdfBase64, result.filename)}
              >
                <Download className="w-5 h-5 mr-2" /> Download
              </Button>
              <Button
                className="flex-1 h-13"
                onClick={async () => {
                  await sharePdf(result.pdfBase64, result.filename, result.driveUrl);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                <Share2 className="w-5 h-5 mr-2" />
                {copied ? "Copied!" : "Share Link"}
              </Button>
            </div>

            {result.driveUrl && (
              <a
                href={result.driveUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-primary underline"
              >
                Open in Google Drive ↗
              </a>
            )}

            <button
              className="text-sm text-muted-foreground hover:text-foreground underline"
              onClick={() => { setStep("form"); setResult(null); }}
            >
              Generate another
            </button>
          </div>
        )}

        {/* Footer button */}
        {step === "form" && (
          <div className="px-5 py-4 border-t shrink-0">
            <Button
              className="w-full h-13 font-semibold text-base"
              onClick={handleGenerate}
              disabled={lineItems.length === 0 || !docNumber}
            >
              <FileCheck className="w-5 h-5 mr-2" /> Generate PDF
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function JobDetail() {
  const { id } = useParams<{ id: string }>();
  const jobId = parseInt(id || "0", 10);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: job, isLoading } = useGetJob(jobId, {
    query: { enabled: !!jobId, queryKey: getGetJobQueryKey(jobId) },
  });

  const { data: receipts, isLoading: receiptsLoading } = useListJobReceipts(jobId, {
    query: { enabled: !!jobId, queryKey: getListJobReceiptsQueryKey(jobId) },
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(jobId) });
    queryClient.invalidateQueries({ queryKey: getListJobReceiptsQueryKey(jobId) });
  };

  if (isLoading) return (
    <div className="p-4 space-y-3">
      <Skeleton className="h-14 w-full" />
      <Skeleton className="h-48 w-full" />
      <Skeleton className="h-32 w-full" />
    </div>
  );
  if (!job) return <div className="p-8 text-center text-muted-foreground">Job not found</div>;

  const margin = job.estimateAmount > 0
    ? Math.round(((job.estimateAmount - job.totalCosts) / job.estimateAmount) * 100)
    : 0;

  const showEstimateBtn = ["estimate", "deposit_received"].includes(job.status);
  const showInvoiceBtn  = ["invoiced", "complete", "paid"].includes(job.status);

  return (
    <div className="pb-24">
      <div className="bg-primary text-primary-foreground p-4 sticky top-0 z-10 flex items-center gap-3 shadow-md">
        <Link href="/jobs" className="shrink-0">
          <ChevronLeft className="w-6 h-6" />
        </Link>
        <div className="flex-1 min-w-0">
          <h1 className="text-xl font-bold leading-tight">{job.jobNumber}</h1>
          <p className="text-sm text-primary-foreground/70 truncate">{job.client}</p>
        </div>
        <StatusBadge status={job.status} />
      </div>

      <div className="p-4 space-y-4">
        {/* Job info */}
        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Client</p>
                <p className="font-semibold">{job.client}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Created</p>
                <p className="font-semibold">{format(new Date(job.createdAt), "MMM d, yyyy")}</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Address</p>
              <p className="font-medium">{job.address}</p>
            </div>
            {job.description && (
              <div>
                <p className="text-xs text-muted-foreground">Description</p>
                <p className="text-sm whitespace-pre-wrap text-muted-foreground">{job.description}</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Financials */}
        <Card className={job.isOverBudget ? "border-destructive border-2" : ""}>
          <CardContent className="p-4">
            {job.isOverBudget && (
              <div className="flex items-center gap-2 text-destructive text-sm font-semibold mb-3">
                <AlertTriangle className="w-4 h-4" /> OVER BUDGET
              </div>
            )}
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Estimate</p>
                <p className="font-bold text-lg">${job.estimateAmount.toLocaleString()}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Total Costs</p>
                <p className={cn("font-bold text-lg", job.isOverBudget && "text-destructive")}>
                  ${job.totalCosts.toLocaleString()}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Margin</p>
                <p className={cn("font-bold text-lg", margin < 0 ? "text-destructive" : "text-green-600")}>
                  {margin}%
                </p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Action buttons */}
        <div className="grid grid-cols-2 gap-3">
          <ChangeStatusDialog jobId={jobId} currentStatus={job.status} onChanged={refresh} />
          <Link href={`/jobs/${job.id}/log-receipt`} className="flex-1">
            <Button className="w-full h-14 font-semibold">
              <Receipt className="w-5 h-5 mr-2" /> Log Receipt
            </Button>
          </Link>
        </div>

        {/* PDF generation buttons */}
        {(showEstimateBtn || showInvoiceBtn) && (
          <div className="flex gap-3">
            {showEstimateBtn && (
              <GeneratePdfDialog
                docType="estimate"
                job={job}
                receipts={receipts || []}
              />
            )}
            {showInvoiceBtn && (
              <GeneratePdfDialog
                docType="invoice"
                job={job}
                receipts={receipts || []}
              />
            )}
          </div>
        )}

        {/* Receipts */}
        <div>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold">Receipts</h2>
            {receipts && receipts.length > 0 && (
              <span className="text-sm text-muted-foreground">
                {receipts.length} item{receipts.length !== 1 ? "s" : ""} · $
                {receipts.reduce((s, r) => s + Number(r.amount), 0).toLocaleString()}
              </span>
            )}
          </div>

          {receiptsLoading ? (
            <Skeleton className="h-20 w-full" />
          ) : !receipts?.length ? (
            <div className="text-center py-8 text-muted-foreground border-2 border-dashed rounded-xl">
              <Receipt className="w-8 h-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No receipts logged yet</p>
            </div>
          ) : (
            <div className="space-y-2">
              {receipts.map((r) => (
                <div key={r.id} className="bg-card p-3 rounded-xl border flex justify-between items-center gap-3">
                  <div className="min-w-0">
                    <p className="font-medium capitalize text-sm">{r.category.replace(/_/g, " ")}</p>
                    <p className="text-xs text-muted-foreground">
                      {r.vendorName || "Unknown vendor"} · {format(new Date(r.createdAt), "MMM d")}
                    </p>
                    {r.notes && <p className="text-xs text-muted-foreground italic mt-0.5 truncate">{r.notes}</p>}
                  </div>
                  <p className="font-bold shrink-0">${Number(r.amount).toLocaleString()}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
