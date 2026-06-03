import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { CheckCircle, Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

const API_BASE = import.meta.env.VITE_API_URL || "/api";

export default function TenantApply() {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    phone: "",
    currentAddress: "",
    city: "",
    state: "OH",
    zip: "",
    employer: "",
    employerPhone: "",
    monthlyIncome: "",
    moveInDate: "",
    desiredProperty: "",
    howDidYouHear: "",
    pets: "No",
    petDetails: "",
    evictionHistory: "No",
    evictionDetails: "",
    felonyHistory: "No",
    felonyDetails: "",
    additionalOccupants: "",
    references: "",
    emergencyContactName: "",
    emergencyContactPhone: "",
    signature: "",
  });

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const setSelect = (field: string) => (val: string) =>
    setForm((prev) => ({ ...prev, [field]: val }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.firstName || !form.lastName || !form.phone) {
      toast({ title: "Required fields missing", description: "Please fill in your first name, last name, and phone number.", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`${API_BASE}/forms/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error("Submission failed");
      setSubmitted(true);
    } catch {
      toast({ title: "Error", description: "Failed to submit application. Please try again.", variant: "destructive" });
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
            <h2 className="text-2xl font-bold">Application Submitted!</h2>
            <p className="text-muted-foreground">Thank you for your interest in Nice City Homes. We will review your application and get back to you soon.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-gray-50">
      <div className="bg-[#8B0000] text-white p-4 text-center sticky top-0 z-10">
        <h1 className="text-xl font-bold">Nice City Homes</h1>
        <p className="text-sm opacity-90">Resident Application</p>
      </div>

      <form onSubmit={handleSubmit} className="max-w-lg mx-auto p-4 space-y-6 pb-12">
        <Card>
          <CardContent className="p-4 space-y-4">
            <h2 className="font-bold text-lg border-b pb-2">Personal Information</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>First Name *</Label>
                <Input required value={form.firstName} onChange={set("firstName")} className="h-11" />
              </div>
              <div className="space-y-1">
                <Label>Last Name *</Label>
                <Input required value={form.lastName} onChange={set("lastName")} className="h-11" />
              </div>
            </div>
            <div className="space-y-1">
              <Label>Phone *</Label>
              <Input required type="tel" value={form.phone} onChange={set("phone")} placeholder="330-555-1234" className="h-11" />
            </div>
            <div className="space-y-1">
              <Label>Email</Label>
              <Input type="email" value={form.email} onChange={set("email")} className="h-11" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-4">
            <h2 className="font-bold text-lg border-b pb-2">Current Address</h2>
            <div className="space-y-1">
              <Label>Street Address</Label>
              <Input value={form.currentAddress} onChange={set("currentAddress")} className="h-11" />
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label>City</Label>
                <Input value={form.city} onChange={set("city")} className="h-11" />
              </div>
              <div className="space-y-1">
                <Label>State</Label>
                <Input value={form.state} onChange={set("state")} className="h-11" />
              </div>
              <div className="space-y-1">
                <Label>Zip</Label>
                <Input value={form.zip} onChange={set("zip")} className="h-11" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-4">
            <h2 className="font-bold text-lg border-b pb-2">Employment</h2>
            <div className="space-y-1">
              <Label>Employer</Label>
              <Input value={form.employer} onChange={set("employer")} className="h-11" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Employer Phone</Label>
                <Input type="tel" value={form.employerPhone} onChange={set("employerPhone")} className="h-11" />
              </div>
              <div className="space-y-1">
                <Label>Monthly Income</Label>
                <Input value={form.monthlyIncome} onChange={set("monthlyIncome")} placeholder="$" className="h-11" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-4">
            <h2 className="font-bold text-lg border-b pb-2">Rental Details</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Desired Move-In Date</Label>
                <Input type="date" value={form.moveInDate} onChange={set("moveInDate")} className="h-11" />
              </div>
              <div className="space-y-1">
                <Label>Desired Property</Label>
                <Input value={form.desiredProperty} onChange={set("desiredProperty")} placeholder="Address or 'Any'" className="h-11" />
              </div>
            </div>
            <div className="space-y-1">
              <Label>How did you hear about us?</Label>
              <Input value={form.howDidYouHear} onChange={set("howDidYouHear")} className="h-11" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-4">
            <h2 className="font-bold text-lg border-b pb-2">Background</h2>
            <div className="space-y-1">
              <Label>Do you have pets?</Label>
              <Select value={form.pets} onValueChange={setSelect("pets")}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="No">No</SelectItem>
                  <SelectItem value="Yes">Yes</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.pets === "Yes" && (
              <div className="space-y-1">
                <Label>Pet Details (type, breed, weight)</Label>
                <Input value={form.petDetails} onChange={set("petDetails")} className="h-11" />
              </div>
            )}

            <div className="space-y-1">
              <Label>Have you ever been evicted?</Label>
              <Select value={form.evictionHistory} onValueChange={setSelect("evictionHistory")}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="No">No</SelectItem>
                  <SelectItem value="Yes">Yes</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.evictionHistory === "Yes" && (
              <div className="space-y-1">
                <Label>Please explain</Label>
                <Textarea value={form.evictionDetails} onChange={set("evictionDetails")} />
              </div>
            )}

            <div className="space-y-1">
              <Label>Any felony convictions?</Label>
              <Select value={form.felonyHistory} onValueChange={setSelect("felonyHistory")}>
                <SelectTrigger className="h-11"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="No">No</SelectItem>
                  <SelectItem value="Yes">Yes</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.felonyHistory === "Yes" && (
              <div className="space-y-1">
                <Label>Please explain</Label>
                <Textarea value={form.felonyDetails} onChange={set("felonyDetails")} />
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-4">
            <h2 className="font-bold text-lg border-b pb-2">Additional Info</h2>
            <div className="space-y-1">
              <Label>Additional occupants (names & ages)</Label>
              <Textarea value={form.additionalOccupants} onChange={set("additionalOccupants")} placeholder="List anyone who will be living with you" />
            </div>
            <div className="space-y-1">
              <Label>References (name & phone)</Label>
              <Textarea value={form.references} onChange={set("references")} placeholder="Personal or rental references" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>Emergency Contact</Label>
                <Input value={form.emergencyContactName} onChange={set("emergencyContactName")} className="h-11" />
              </div>
              <div className="space-y-1">
                <Label>Emergency Phone</Label>
                <Input type="tel" value={form.emergencyContactPhone} onChange={set("emergencyContactPhone")} className="h-11" />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4 space-y-4">
            <h2 className="font-bold text-lg border-b pb-2">Certification</h2>
            <p className="text-sm text-muted-foreground">I certify that the information provided is true and complete. I authorize Nice City Homes to verify this information and conduct background and credit checks.</p>
            <div className="space-y-1">
              <Label>Signature (type your full name) *</Label>
              <Input required value={form.signature} onChange={set("signature")} placeholder="Type your full name" className="h-11" />
            </div>
          </CardContent>
        </Card>

        <Button type="submit" disabled={submitting} className="w-full h-14 text-lg font-bold bg-[#8B0000] hover:bg-[#6B0000]">
          {submitting ? <><Loader2 className="w-5 h-5 mr-2 animate-spin" /> Submitting...</> : "Submit Application"}
        </Button>
      </form>
    </div>
  );
}
