import { useListExpenses, useCreateExpense, getListExpensesQueryKey } from "@workspace/api-client-react";
import { useState, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Plus, DollarSign, Camera, X, ScanLine, ImagePlus } from "lucide-react";
import { format } from "date-fns";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { DocumentScanner } from "@/features/document-scanner/scanner";
import { PropertyPicker } from "@/components/property-picker";

const PROPERTY_CATEGORIES = [
  "Property Tax",
  "Water/Sewer",
  "Electric",
  "Gas",
  "Vacant Property Registration Fee",
  "Code Violation Fine",
  "Other Property Expense",
];

const COMPANY_CATEGORIES = [
  "Canton City Income Tax",
  "Recording Fee",
  "Title/Closing Fee",
  "LLC/State Filing Fee",
  "Business Insurance",
  "Professional Services",
  "Office/Administrative",
  "Other Company Expense",
];

const PAYMENT_METHODS = ["Check", "ACH", "Zelle", "Cash", "Card", "Other"];

const UTILITY_CATS = ["Water/Sewer", "Electric", "Gas"];
const PROPERTY_TAX_CAT = "Property Tax";
const GOV_CATS = ["Canton City Income Tax", "Recording Fee", "Title/Closing Fee", "LLC/State Filing Fee"];

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function Expenses() {
  const { data: expenses, isLoading } = useListExpenses();
  const createExpense = useCreateExpense();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);

  // Core fields
  const [expenseType, setExpenseType] = useState<"A - Property" | "B - Company" | "">("");
  const [category, setCategory] = useState("");
  const [payeeEntity, setPayeeEntity] = useState("");
  const [amount, setAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("");
  const [propertyAddress, setPropertyAddress] = useState("");
  const [propertyGroup, setPropertyGroup] = useState("");
  const [notes, setNotes] = useState("");
  const [taxYear, setTaxYear] = useState(String(new Date().getFullYear()));
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // Conditional: Property Tax
  const [parcelNumber, setParcelNumber] = useState("");
  const [billPeriod, setBillPeriod] = useState("");
  const [confirmationNumber, setConfirmationNumber] = useState("");

  // Conditional: Utility
  const [provider, setProvider] = useState("");
  const [accountNumber, setAccountNumber] = useState("");
  const [billMonth, setBillMonth] = useState("");
  const [occupancyStatus, setOccupancyStatus] = useState("");

  // Conditional: Gov Fees
  const [referenceNumber, setReferenceNumber] = useState("");
  const [dueDate, setDueDate] = useState("");

  const isProperty = expenseType === "A - Property";
  const isCompany = expenseType === "B - Company";
  const isUtility = UTILITY_CATS.includes(category);
  const isPropertyTax = category === PROPERTY_TAX_CAT;
  const isGovFee = GOV_CATS.includes(category);

  const categories = isProperty ? PROPERTY_CATEGORIES : isCompany ? COMPANY_CATEGORIES : [];

  const resetForm = () => {
    setExpenseType(""); setCategory(""); setPayeeEntity(""); setAmount("");
    setPaymentMethod(""); setPropertyAddress(""); setPropertyGroup("");
    setNotes(""); setTaxYear(String(new Date().getFullYear()));
    setPhotoBase64(null); setPhotoPreview(null);
    setParcelNumber(""); setBillPeriod(""); setConfirmationNumber("");
    setProvider(""); setAccountNumber(""); setBillMonth(""); setOccupancyStatus("");
    setReferenceNumber(""); setDueDate("");
  };

  const handlePhotoChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const base64 = await readFileAsBase64(file);
      setPhotoBase64(base64);
      setPhotoPreview(base64);
    } catch {
      toast({ title: "Could not read photo", variant: "destructive" });
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!expenseType) { toast({ title: "Expense type required", variant: "destructive" }); return; }
    if (!category) { toast({ title: "Category required", variant: "destructive" }); return; }
    if (!payeeEntity.trim()) { toast({ title: "Payee/Vendor required", variant: "destructive" }); return; }
    if (!amount || parseFloat(amount) <= 0) { toast({ title: "Enter a valid amount", variant: "destructive" }); return; }
    if (!paymentMethod) { toast({ title: "Payment method required", variant: "destructive" }); return; }

    try {
      await createExpense.mutateAsync({
        data: {
          description: payeeEntity,
          category,
          amount: parseFloat(amount),
          expenseType,
          payeeEntity,
          propertyAddress: isProperty ? propertyAddress : "",
          propertyGroup: "",
          paymentMethod,
          taxYear: parseInt(taxYear, 10),
          notes,
          ...(photoBase64 ? { photoBase64 } : {}),
          ...(isPropertyTax ? { parcelNumber, billPeriod, confirmationNumber } : {}),
          ...(isUtility ? { provider, accountNumber, billMonth, occupancyStatus } : {}),
          ...(isGovFee ? { referenceNumber, dueDate } : {}),
        },
      });
      queryClient.invalidateQueries({ queryKey: getListExpensesQueryKey() });
      toast({ title: "Expense logged ✓", description: `Written to ${expenseType === "A - Property" ? "Property" : "Company"} Expenses sheet` });
      setOpen(false);
      resetForm();
    } catch {
      toast({ title: "Failed to log expense", variant: "destructive" });
    }
  };

  const totalUnsorted = expenses?.filter((e) => e.status === "unsorted").reduce((s, e) => s + Number(e.amount), 0) ?? 0;

  if (scannerOpen) {
    return (
      <DocumentScanner
        onCapture={(base64) => { setPhotoBase64(base64); setPhotoPreview(base64); setScannerOpen(false); }}
        onClose={() => setScannerOpen(false)}
      />
    );
  }

  return (
    <div className="pb-20">
      <div className="bg-primary text-primary-foreground p-4 sticky top-0 z-10 shadow-md">
        <div className="flex justify-between items-center">
          <h1 className="text-2xl font-bold">Expenses</h1>
          <Dialog open={open} onOpenChange={(v) => { setOpen(v); if (!v) resetForm(); }}>
            <DialogTrigger asChild>
              <Button size="sm" variant="secondary" className="h-9 font-semibold">
                <Plus className="w-4 h-4 mr-1" /> Log Expense
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md max-h-[92vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Log Expense</DialogTitle>
              </DialogHeader>
              <form onSubmit={handleSubmit} className="space-y-4 pt-1">

                {/* Expense Type Toggle */}
                <div className="space-y-1">
                  <Label>Expense Type</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {(["A - Property", "B - Company"] as const).map((t) => (
                      <button
                        key={t}
                        type="button"
                        onClick={() => { setExpenseType(t); setCategory(""); }}
                        className={`h-12 rounded-lg border-2 font-semibold text-sm transition-colors ${
                          expenseType === t
                            ? "border-primary bg-primary text-primary-foreground"
                            : "border-input bg-background hover:border-primary/50"
                        }`}
                      >
                        {t === "A - Property" ? "🏠 Property" : "🏢 Company"}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Category */}
                {expenseType && (
                  <div className="space-y-1">
                    <Label>Category</Label>
                    <Select value={category} onValueChange={setCategory}>
                      <SelectTrigger className="h-12">
                        <SelectValue placeholder="Select category" />
                      </SelectTrigger>
                      <SelectContent>
                        {categories.map((c) => (
                          <SelectItem key={c} value={c}>{c}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}

                {/* Property-only fields */}
                {isProperty && (
                  <div className="space-y-1">
                    <Label>Property Address</Label>
                    <PropertyPicker value={propertyAddress} onChange={setPropertyAddress} />
                  </div>
                )}

                {/* Always visible */}
                <div className="space-y-1">
                  <Label>Payee / Vendor</Label>
                  <Input
                    required value={payeeEntity}
                    onChange={(e) => setPayeeEntity(e.target.value)}
                    placeholder="Who was paid?"
                    className="h-12"
                  />
                </div>

                <div className="space-y-1">
                  <Label>Amount ($)</Label>
                  <Input
                    type="number" step="0.01" min="0.01" required
                    value={amount} onChange={(e) => setAmount(e.target.value)}
                    placeholder="0.00" className="h-12 text-lg"
                  />
                </div>

                <div className="space-y-1">
                  <Label>Payment Method</Label>
                  <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                    <SelectTrigger className="h-12">
                      <SelectValue placeholder="How was it paid?" />
                    </SelectTrigger>
                    <SelectContent>
                      {PAYMENT_METHODS.map((m) => (
                        <SelectItem key={m} value={m}>{m}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                {/* Property Tax conditional fields */}
                {isPropertyTax && (
                  <div className="space-y-3 p-3 rounded-lg bg-amber-50 border border-amber-200">
                    <p className="text-xs font-semibold text-amber-700 uppercase tracking-wide">Property Tax Details</p>
                    <div className="space-y-1">
                      <Label>Parcel Number <span className="text-muted-foreground text-xs">(optional)</span></Label>
                      <Input value={parcelNumber} onChange={(e) => setParcelNumber(e.target.value)} placeholder="Parcel #" className="h-10" />
                    </div>
                    <div className="space-y-1">
                      <Label>Bill Period</Label>
                      <Select value={billPeriod} onValueChange={setBillPeriod}>
                        <SelectTrigger className="h-10"><SelectValue placeholder="Spring or Fall" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Spring">Spring</SelectItem>
                          <SelectItem value="Fall">Fall</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label>Confirmation # <span className="text-muted-foreground text-xs">(optional)</span></Label>
                      <Input value={confirmationNumber} onChange={(e) => setConfirmationNumber(e.target.value)} placeholder="Confirmation number" className="h-10" />
                    </div>
                  </div>
                )}

                {/* Utility conditional fields */}
                {isUtility && (
                  <div className="space-y-3 p-3 rounded-lg bg-blue-50 border border-blue-200">
                    <p className="text-xs font-semibold text-blue-700 uppercase tracking-wide">Utility Details</p>
                    <div className="space-y-1">
                      <Label>Provider</Label>
                      <Input value={provider} onChange={(e) => setProvider(e.target.value)} placeholder="e.g. AEP Ohio" className="h-10" />
                    </div>
                    <div className="space-y-1">
                      <Label>Account # <span className="text-muted-foreground text-xs">(optional)</span></Label>
                      <Input value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} placeholder="Account number" className="h-10" />
                    </div>
                    <div className="space-y-1">
                      <Label>Bill Month</Label>
                      <Input value={billMonth} onChange={(e) => setBillMonth(e.target.value)} placeholder="e.g. March 2026" className="h-10" />
                    </div>
                    <div className="space-y-1">
                      <Label>Occupancy Status</Label>
                      <Select value={occupancyStatus} onValueChange={setOccupancyStatus}>
                        <SelectTrigger className="h-10"><SelectValue placeholder="Select status" /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="Vacant">Vacant</SelectItem>
                          <SelectItem value="Transitional">Transitional</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {/* Gov Fee conditional fields */}
                {isGovFee && (
                  <div className="space-y-3 p-3 rounded-lg bg-purple-50 border border-purple-200">
                    <p className="text-xs font-semibold text-purple-700 uppercase tracking-wide">Fee Details</p>
                    <div className="space-y-1">
                      <Label>Reference # <span className="text-muted-foreground text-xs">(optional)</span></Label>
                      <Input value={referenceNumber} onChange={(e) => setReferenceNumber(e.target.value)} placeholder="Reference number" className="h-10" />
                    </div>
                    <div className="space-y-1">
                      <Label>Due Date <span className="text-muted-foreground text-xs">(optional)</span></Label>
                      <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="h-10" />
                    </div>
                  </div>
                )}

                {/* Receipt Photo */}
                <div className="space-y-2">
                  <Label>Receipt Photo <span className="text-muted-foreground text-xs">(optional)</span></Label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handlePhotoChange}
                  />
                  <input
                    ref={cameraInputRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={handlePhotoChange}
                  />
                  {photoPreview ? (
                    <div className="relative w-full">
                      <img src={photoPreview} alt="Receipt preview" className="w-full max-h-40 object-cover rounded-lg border" />
                      <button
                        type="button"
                        onClick={() => { setPhotoBase64(null); setPhotoPreview(null); if (fileInputRef.current) fileInputRef.current.value = ""; if (cameraInputRef.current) cameraInputRef.current.value = ""; }}
                        className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <div className="grid grid-cols-3 gap-2">
                      <button
                        type="button"
                        onClick={() => cameraInputRef.current?.click()}
                        className="h-16 rounded-lg border-2 border-dashed border-input flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                      >
                        <Camera className="w-5 h-5" />
                        <span className="text-xs font-medium">Take Photo</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => fileInputRef.current?.click()}
                        className="h-16 rounded-lg border-2 border-dashed border-input flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                      >
                        <ImagePlus className="w-5 h-5" />
                        <span className="text-xs font-medium">Library</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setScannerOpen(true)}
                        className="h-16 rounded-lg border-2 border-dashed border-input flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
                      >
                        <ScanLine className="w-5 h-5" />
                        <span className="text-xs font-medium">Scan Doc</span>
                      </button>
                    </div>
                  )}
                </div>

                {/* Notes */}
                <div className="space-y-1">
                  <Label>Notes <span className="text-muted-foreground text-xs">(optional)</span></Label>
                  <Textarea
                    value={notes} onChange={(e) => setNotes(e.target.value)}
                    placeholder="Additional details..."
                    className="min-h-[70px]"
                  />
                </div>

                {/* Tax Year */}
                <div className="space-y-1">
                  <Label>Tax Year</Label>
                  <Input
                    type="number" value={taxYear}
                    onChange={(e) => setTaxYear(e.target.value)}
                    className="h-10"
                  />
                </div>

                <Button type="submit" className="w-full h-12 font-bold" disabled={createExpense.isPending}>
                  {createExpense.isPending ? "Saving..." : "Log Expense"}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>
        {totalUnsorted > 0 && (
          <div className="mt-2 bg-amber-500/20 rounded-lg px-3 py-1.5 text-sm flex items-center gap-2">
            <DollarSign className="w-4 h-4" />
            <span><strong>${totalUnsorted.toLocaleString()}</strong> in unsorted expenses</span>
          </div>
        )}
      </div>

      <div className="p-4 space-y-3">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20 w-full" />)
        ) : !expenses?.length ? (
          <div className="text-center py-16 text-muted-foreground">
            <DollarSign className="w-12 h-12 mx-auto mb-3 opacity-30" />
            <p className="font-medium">No expenses yet</p>
            <p className="text-sm">Tap "Log Expense" to add one</p>
          </div>
        ) : (
          expenses.map((exp) => (
            <Card key={exp.id} className={`border-l-4 ${exp.status === "unsorted" ? "border-l-amber-400 bg-amber-50" : exp.status === "sorted" ? "border-l-green-500" : ""}`}>
              <CardContent className="p-4 flex justify-between items-center gap-3">
                <div className="min-w-0">
                  <p className="font-semibold truncate">{(exp as any).payeeEntity || exp.description}</p>
                  <div className="flex flex-wrap gap-2 items-center mt-1">
                    <Badge variant="outline" className="text-xs">{exp.category}</Badge>
                    {(exp as any).expenseType && (
                      <Badge variant="outline" className="text-xs text-blue-600 border-blue-300">
                        {(exp as any).expenseType === "A - Property" ? "Property" : "Company"}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(exp.createdAt), "MMM d, yyyy")}
                    </span>
                    {exp.status === "unsorted" && (
                      <Badge variant="outline" className="text-xs text-amber-600 border-amber-400">Unsorted</Badge>
                    )}
                  </div>
                </div>
                <p className="font-bold text-lg shrink-0">${Number(exp.amount).toLocaleString()}</p>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}
