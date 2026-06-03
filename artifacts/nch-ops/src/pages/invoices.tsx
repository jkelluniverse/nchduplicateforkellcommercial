import {
  useListInvoices, useMarkInvoicePaid, getListInvoicesQueryKey, useListJobs, useCreateJob, getListJobsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { Plus, FileText, ChevronDown, ChevronUp, Check } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const PRESET_CLIENTS = ["BSMK", "Coastal Management LLC"];

async function createInvoice(body: {
  jobId: number; type: string; totalAmount: number; depositPaid: number; dueDate?: string;
}) {
  const token = localStorage.getItem("nch_token");
  const res = await fetch(`${BASE}/api/invoices`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error("Failed to create invoice");
  return res.json();
}

function InlineJobForm({ onCreated }: { onCreated: (jobId: number) => void }) {
  const [clientMode, setClientMode] = useState<"preset" | "custom">("preset");
  const [selectedPreset, setSelectedPreset] = useState("");
  const [customClient, setCustomClient] = useState("");
  const [address, setAddress] = useState("");
  const [estimate, setEstimate] = useState("");
  const [description, setDescription] = useState("");
  const createJob = useCreateJob();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const client = clientMode === "preset" ? selectedPreset : customClient.trim();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!client) { toast({ title: "Client required", variant: "destructive" }); return; }
    if (!address.trim()) { toast({ title: "Address required", variant: "destructive" }); return; }
    try {
      const result = await createJob.mutateAsync({
        data: {
          client: client as import("@workspace/api-client-react").CreateJobBodyClient,
          address: address.trim(),
          description: description.trim(),
          estimateAmount: parseFloat(estimate) || 0,
        },
      });
      queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
      toast({ title: "Job created!" });
      onCreated(result.id);
    } catch {
      toast({ title: "Failed to create job", variant: "destructive" });
    }
  };

  return (
    <form onSubmit={handleSubmit} className="mt-3 p-3 bg-muted/50 rounded-lg border space-y-3">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">New Job</p>

      {/* Client presets */}
      <div className="space-y-1.5">
        <Label className="text-xs">Client</Label>
        <div className="flex flex-wrap gap-1.5">
          {PRESET_CLIENTS.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => { setClientMode("preset"); setSelectedPreset(name); }}
              className={cn(
                "px-3 py-1.5 rounded-md border text-xs font-medium transition-colors",
                clientMode === "preset" && selectedPreset === name
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-foreground border-input hover:bg-muted"
              )}
            >
              {clientMode === "preset" && selectedPreset === name && (
                <Check className="w-3 h-3 inline-block mr-1" />
              )}
              {name}
            </button>
          ))}
          <button
            type="button"
            onClick={() => { setClientMode("custom"); setSelectedPreset(""); }}
            className={cn(
              "px-3 py-1.5 rounded-md border text-xs font-medium transition-colors",
              clientMode === "custom"
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-foreground border-input hover:bg-muted"
            )}
          >
            + Custom
          </button>
        </div>
        {clientMode === "custom" && (
          <Input
            autoFocus
            placeholder="Client name"
            className="h-9 text-sm mt-1"
            value={customClient}
            onChange={(e) => setCustomClient(e.target.value)}
          />
        )}
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Address</Label>
        <Input
          required
          placeholder="123 Main St, Canton OH"
          className="h-9 text-sm"
          value={address}
          onChange={(e) => setAddress(e.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Estimate Amount ($)</Label>
        <Input
          type="number" min="0" step="0.01"
          placeholder="0.00"
          className="h-9 text-sm"
          value={estimate}
          onChange={(e) => setEstimate(e.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label className="text-xs">Description <span className="text-muted-foreground">(optional)</span></Label>
        <Textarea
          placeholder="Describe the work..."
          className="min-h-[60px] text-sm"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>

      <Button
        type="submit"
        size="sm"
        className="w-full font-semibold"
        disabled={createJob.isPending || !client}
      >
        {createJob.isPending ? "Creating..." : "Create Job & Select"}
      </Button>
    </form>
  );
}

function NewDocDialog({ defaultType, onSuccess }: { defaultType: "invoice" | "estimate"; onSuccess: () => void }) {
  const [open, setOpen] = useState(false);
  const [jobId, setJobId] = useState("");
  const [totalAmount, setTotalAmount] = useState("");
  const [depositPaid, setDepositPaid] = useState("0");
  const [dueDate, setDueDate] = useState("");
  const [showNewJobForm, setShowNewJobForm] = useState(false);
  const { toast } = useToast();

  const { data: jobs } = useListJobs({});

  const mutation = useMutation({
    mutationFn: createInvoice,
    onSuccess: () => {
      toast({ title: `${defaultType === "estimate" ? "Estimate" : "Invoice"} created!` });
      setOpen(false);
      resetForm();
      onSuccess();
    },
    onError: () => toast({ title: "Failed to create", variant: "destructive" }),
  });

  const resetForm = () => {
    setJobId(""); setTotalAmount(""); setDepositPaid("0"); setDueDate(""); setShowNewJobForm(false);
  };

  const selectedJob = jobs?.find((j) => String(j.id) === jobId);
  const balanceDue = Math.max(0, (parseFloat(totalAmount) || 0) - (parseFloat(depositPaid) || 0));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!jobId) { toast({ title: "Select a job", variant: "destructive" }); return; }
    if (!totalAmount || parseFloat(totalAmount) <= 0) { toast({ title: "Enter a valid amount", variant: "destructive" }); return; }
    mutation.mutate({
      jobId: parseInt(jobId),
      type: defaultType,
      totalAmount: parseFloat(totalAmount),
      depositPaid: parseFloat(depositPaid) || 0,
      ...(dueDate ? { dueDate } : {}),
    });
  };

  const handleJobCreated = (newJobId: number) => {
    setJobId(String(newJobId));
    setShowNewJobForm(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
      <DialogTrigger asChild>
        <Button size="sm" variant="secondary" className="h-9 font-semibold">
          <Plus className="w-4 h-4 mr-1" />
          {defaultType === "invoice" ? "New Invoice" : "New Estimate"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {defaultType === "invoice" ? "Create Invoice" : "Create Estimate"}
          </DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 pt-2">
          <div className="space-y-1">
            <Label>Job</Label>
            <Select value={jobId} onValueChange={(v) => { setJobId(v); setShowNewJobForm(false); }}>
              <SelectTrigger className="h-12">
                <SelectValue placeholder="Select a job" />
              </SelectTrigger>
              <SelectContent>
                {jobs?.map((j) => (
                  <SelectItem key={j.id} value={String(j.id)}>
                    {j.jobNumber} — {j.client} · {j.address}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {selectedJob && (
              <p className="text-xs text-muted-foreground pl-1">
                Estimate: ${selectedJob.estimateAmount.toLocaleString()} · Status: {selectedJob.status.replace("_", " ")}
              </p>
            )}

            {/* Create new job inline */}
            <button
              type="button"
              onClick={() => setShowNewJobForm((v) => !v)}
              className="mt-1 flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              {showNewJobForm ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              ＋ Create New Job
            </button>

            {showNewJobForm && (
              <InlineJobForm onCreated={handleJobCreated} />
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label>Total Amount ($)</Label>
              <Input
                type="number" min="0" step="0.01" required
                value={totalAmount} onChange={(e) => setTotalAmount(e.target.value)}
                placeholder="0.00" className="h-12"
              />
            </div>
            <div className="space-y-1">
              <Label>Deposit Paid ($)</Label>
              <Input
                type="number" min="0" step="0.01"
                value={depositPaid} onChange={(e) => setDepositPaid(e.target.value)}
                placeholder="0.00" className="h-12"
              />
            </div>
          </div>

          {totalAmount && (
            <div className="bg-muted rounded-lg px-4 py-2 text-sm flex justify-between">
              <span className="text-muted-foreground">Balance Due</span>
              <span className="font-bold">${balanceDue.toLocaleString()}</span>
            </div>
          )}

          <div className="space-y-1">
            <Label>Due Date <span className="text-muted-foreground text-xs">(optional)</span></Label>
            <Input
              type="date" value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="h-12"
            />
          </div>

          <Button type="submit" className="w-full h-12 font-bold" disabled={mutation.isPending}>
            {mutation.isPending ? "Creating..." : `Create ${defaultType === "estimate" ? "Estimate" : "Invoice"}`}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function Invoices() {
  const [status, setStatus] = useState<string>("");
  const { data: invoices, isLoading } = useListInvoices({ status: (status as any) || undefined });
  const markPaid = useMarkInvoicePaid();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleMarkPaid = async (id: number) => {
    try {
      await markPaid.mutateAsync({ invoiceId: id });
      queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });
      toast({ title: "Invoice marked as paid" });
    } catch {
      toast({ title: "Error", variant: "destructive" });
    }
  };

  const refresh = () => queryClient.invalidateQueries({ queryKey: getListInvoicesQueryKey() });

  return (
    <div className="pb-20">
      <div className="bg-primary text-primary-foreground p-4 sticky top-0 z-10 shadow-md">
        <div className="flex justify-between items-center mb-3">
          <h1 className="text-2xl font-bold">Invoices / Estimates</h1>
          <div className="flex gap-2">
            <NewDocDialog defaultType="estimate" onSuccess={refresh} />
            <NewDocDialog defaultType="invoice" onSuccess={refresh} />
          </div>
        </div>
        <Tabs defaultValue="all" onValueChange={(v) => setStatus(v === "all" ? "" : v)}>
          <TabsList className="w-full bg-primary-foreground/20 text-primary-foreground h-11">
            {["all", "unpaid", "paid"].map((v) => (
              <TabsTrigger key={v} value={v} className="flex-1 capitalize data-[state=active]:bg-white data-[state=active]:text-primary">
                {v}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
      </div>

      <div className="p-4 space-y-3">
        {isLoading ? (
          Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32 w-full" />)
        ) : !invoices?.length ? (
          <div className="text-center py-16 text-muted-foreground">
            <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No invoices yet</p>
            <p className="text-sm">Tap "New Invoice" to create one</p>
          </div>
        ) : (
          invoices.map((inv) => (
            <Card
              key={inv.id}
              className={`border-l-4 ${inv.status === "paid" ? "border-l-green-500" : "border-l-amber-400"}`}
            >
              <CardContent className="p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <h3 className="font-bold text-lg leading-tight">{inv.invoiceNumber}</h3>
                    <p className="text-sm font-medium text-muted-foreground">{inv.client || "—"}</p>
                  </div>
                  <Badge
                    variant="outline"
                    className={inv.status === "paid"
                      ? "bg-green-50 text-green-700 border-green-400"
                      : "bg-amber-50 text-amber-700 border-amber-400"}
                  >
                    {inv.status.toUpperCase()}
                  </Badge>
                </div>

                <div className="flex gap-3 text-xs text-muted-foreground mb-3">
                  <span className="capitalize bg-muted px-2 py-0.5 rounded">{inv.type}</span>
                  <span>Issued {format(new Date(inv.issuedAt), "MMM d, yyyy")}</span>
                  {inv.dueDate && <span>Due {format(new Date(inv.dueDate), "MMM d")}</span>}
                </div>

                <div className="flex justify-between items-end">
                  <div className="space-y-1">
                    <div className="flex gap-4">
                      <div>
                        <p className="text-xs text-muted-foreground">Total</p>
                        <p className="font-bold text-lg">${inv.totalAmount.toLocaleString()}</p>
                      </div>
                      {(inv.balanceDue ?? 0) > 0 && (
                        <div>
                          <p className="text-xs text-muted-foreground">Balance Due</p>
                          <p className="font-semibold text-amber-600">${(inv.balanceDue ?? 0).toLocaleString()}</p>
                        </div>
                      )}
                    </div>
                  </div>
                  {inv.status === "unpaid" && (
                    <Button
                      size="sm"
                      className="bg-green-600 hover:bg-green-700 text-white"
                      onClick={() => handleMarkPaid(inv.id)}
                      disabled={markPaid.isPending}
                    >
                      Mark Paid
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
