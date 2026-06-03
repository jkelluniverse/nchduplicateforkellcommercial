import { useState } from "react";
import { useCreateJob, getListJobsQueryKey, type CreateJobBodyClient } from "@workspace/api-client-react";
import { useLocation, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ChevronLeft, Check } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const PRESET_CLIENTS = ["BSMK", "Coastal Management LLC"];

export default function NewJob() {
  const [clientMode, setClientMode] = useState<"preset" | "custom">("preset");
  const [selectedPreset, setSelectedPreset] = useState("");
  const [customClient, setCustomClient] = useState("");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const [estimate, setEstimate] = useState("");

  const createJob = useCreateJob();
  const [, setLocation] = useLocation();
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
          client: client as CreateJobBodyClient,
          address: address.trim(),
          description: description.trim(),
          estimateAmount: parseFloat(estimate) || 0,
        },
      });
      queryClient.invalidateQueries({ queryKey: getListJobsQueryKey() });
      toast({ title: "Job created!" });
      setLocation(`/jobs/${result.id}`);
    } catch {
      toast({ title: "Failed to create job", variant: "destructive" });
    }
  };

  return (
    <div className="pb-20 bg-background min-h-screen">
      <div className="bg-primary text-primary-foreground p-4 sticky top-0 z-10 flex items-center shadow-md">
        <Link href="/jobs" className="mr-3">
          <ChevronLeft className="w-6 h-6" />
        </Link>
        <h1 className="text-xl font-bold">New Job</h1>
      </div>

      <form onSubmit={handleSubmit} className="p-4 space-y-6">
        <div className="space-y-2">
          <Label>Client</Label>

          <div className="flex flex-wrap gap-2">
            {PRESET_CLIENTS.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => { setClientMode("preset"); setSelectedPreset(name); }}
                className={cn(
                  "px-4 py-2 rounded-lg border text-sm font-medium transition-colors",
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
                "px-4 py-2 rounded-lg border text-sm font-medium transition-colors",
                clientMode === "custom"
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-foreground border-input hover:bg-muted"
              )}
            >
              + New Client
            </button>
          </div>

          {clientMode === "custom" && (
            <Input
              autoFocus
              placeholder="Enter client name"
              className="h-12 text-lg mt-2"
              value={customClient}
              onChange={(e) => setCustomClient(e.target.value)}
            />
          )}

          {client && (
            <p className="text-sm text-muted-foreground">
              Client: <span className="font-medium text-foreground">{client}</span>
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label>Address</Label>
          <Input
            required
            placeholder="123 Main St, Canton OH"
            className="h-12 text-lg"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>Estimate Amount ($)</Label>
          <Input
            type="number"
            required
            min="0"
            step="0.01"
            placeholder="0.00"
            className="h-12 text-lg"
            value={estimate}
            onChange={(e) => setEstimate(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>Description</Label>
          <Textarea
            placeholder="Describe the work to be done..."
            className="min-h-[120px] text-lg"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <Button
          type="submit"
          className="w-full h-14 text-lg font-bold"
          disabled={createJob.isPending || !client}
        >
          {createJob.isPending ? "Creating..." : "Create Job"}
        </Button>
      </form>
    </div>
  );
}
