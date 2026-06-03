import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle, Loader2, Zap, Flame, Droplets, Trash2, Wifi } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

export default function UtilityAccounts() {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [form, setForm] = useState({
    tenantName: "",
    propertyAddress: "",
    moveInDate: "",
    electricAccount: "",
    electricProvider: "",
    gasAccount: "",
    gasProvider: "",
    waterAccount: "",
    waterProvider: "",
    trashAccount: "",
    trashProvider: "",
    internetAccount: "",
    internetProvider: "",
    phone: "",
    email: "",
    notes: "",
  });

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.tenantName || !form.propertyAddress) {
      toast({ title: "Required fields missing", description: "Please enter your name and property address.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/forms/utilities`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Submission failed");
      setSubmitted(true);
    } catch {
      toast({ title: "Error", description: "Failed to submit form. Please try again.", variant: "destructive" });
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="min-h-[100dvh] bg-gray-50 flex items-center justify-center p-4">
        <Card className="w-full max-w-md text-center">
          <CardContent className="p-8 space-y-4">
            <CheckCircle className="w-16 h-16 text-green-600 mx-auto" />
            <h2 className="text-2xl font-bold">Submitted!</h2>
            <p className="text-muted-foreground">Thank you! Your utility account information has been recorded. Nice City Homes will follow up if we need anything else.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-gray-50">
      <div className="bg-[#8B0000] text-white p-4 text-center sticky top-0 z-10">
        <h1 className="text-xl font-bold">Nice City Homes</h1>
        <p className="text-sm opacity-90">Tenant Utility Accounts</p>
      </div>

      <form onSubmit={handleSubmit} className="max-w-lg mx-auto p-4 space-y-6 pb-12">
        <Card>
          <CardContent className="p-4 space-y-4">
            <h2 className="font-bold text-lg border-b pb-2">Tenant Info</h2>
            <div className="space-y-1">
              <Label>Full Name *</Label>
              <Input required value={form.tenantName} onChange={set("tenantName")} className="h-11" />
            </div>
            <div className="space-y-1">
              <Label>Property Address *</Label>
              <Input required value={form.propertyAddress} onChange={set("propertyAddress")} placeholder="123 Main St, Canton OH" className="h-11" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Move-In Date</Label>
                <Input type="date" value={form.moveInDate} onChange={set("moveInDate")} className="h-11" />
              </div>
              <div className="space-y-1">
                <Label>Phone</Label>
                <Input type="tel" value={form.phone} onChange={set("phone")} className="h-11" />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={set("email")} className="h-11" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-4">
            <h2 className="font-bold text-lg border-b pb-2 flex items-center gap-2"><Zap className="w-5 h-5" /> Electric</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Account Number</Label>
                <Input value={form.electricAccount} onChange={set("electricAccount")} className="h-11" />
              </div>
              <div className="space-y-1">
                <Label>Provider</Label>
                <Input value={form.electricProvider} onChange={set("electricProvider")} placeholder="e.g. Ohio Edison" className="h-11" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-4">
            <h2 className="font-bold text-lg border-b pb-2 flex items-center gap-2"><Flame className="w-5 h-5" /> Gas</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Account Number</Label>
                <Input value={form.gasAccount} onChange={set("gasAccount")} className="h-11" />
              </div>
              <div className="space-y-1">
                <Label>Provider</Label>
                <Input value={form.gasProvider} onChange={set("gasProvider")} placeholder="e.g. Dominion Energy" className="h-11" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-4">
            <h2 className="font-bold text-lg border-b pb-2 flex items-center gap-2"><Droplets className="w-5 h-5" /> Water</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Account Number</Label>
                <Input value={form.waterAccount} onChange={set("waterAccount")} className="h-11" />
              </div>
              <div className="space-y-1">
                <Label>Provider</Label>
                <Input value={form.waterProvider} onChange={set("waterProvider")} placeholder="e.g. City of Canton" className="h-11" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-4">
            <h2 className="font-bold text-lg border-b pb-2 flex items-center gap-2"><Trash2 className="w-5 h-5" /> Trash</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Account Number</Label>
                <Input value={form.trashAccount} onChange={set("trashAccount")} className="h-11" />
              </div>
              <div className="space-y-1">
                <Label>Provider</Label>
                <Input value={form.trashProvider} onChange={set("trashProvider")} placeholder="e.g. Republic Services" className="h-11" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-4">
            <h2 className="font-bold text-lg border-b pb-2 flex items-center gap-2"><Wifi className="w-5 h-5" /> Internet</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Account Number</Label>
                <Input value={form.internetAccount} onChange={set("internetAccount")} className="h-11" />
              </div>
              <div className="space-y-1">
                <Label>Provider</Label>
                <Input value={form.internetProvider} onChange={set("internetProvider")} placeholder="e.g. Spectrum" className="h-11" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-4">
            <h2 className="font-bold text-lg border-b pb-2">Notes</h2>
            <Textarea value={form.notes} onChange={set("notes")} placeholder="Any additional info about your utility accounts..." rows={3} />
          </CardContent>
        </Card>

        <Button type="submit" disabled={submitting} className="w-full h-14 text-lg font-bold bg-[#8B0000] hover:bg-[#6B0000]">
          {submitting ? <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Submitting...</> : "Submit Utility Info"}
        </Button>
      </form>
    </div>
  );
}
