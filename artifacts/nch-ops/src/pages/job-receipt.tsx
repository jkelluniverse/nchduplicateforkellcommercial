import { useState, useRef } from "react";
import { useCreateReceipt, getGetJobQueryKey, getListJobReceiptsQueryKey } from "@workspace/api-client-react";
import { useLocation, useParams, Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ChevronLeft, Camera, X, ScanLine, ImagePlus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { DocumentScanner } from "@/features/document-scanner/scanner";

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

export default function LogReceipt() {
  const { id } = useParams<{ id: string }>();
  const jobId = parseInt(id || "0", 10);

  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<any>("");
  const [vendorName, setVendorName] = useState("");
  const [notes, setNotes] = useState("");
  const [photoBase64, setPhotoBase64] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const createReceipt = useCreateReceipt();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

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

  const handleScanComplete = (base64: string) => {
    setPhotoBase64(base64);
    setPhotoPreview(base64);
    setScannerOpen(false);
  };

  const clearPhoto = () => {
    setPhotoBase64(null);
    setPhotoPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (cameraInputRef.current) cameraInputRef.current.value = "";
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!category) { toast({ title: "Category required", variant: "destructive" }); return; }

    try {
      await createReceipt.mutateAsync({
        jobId,
        data: {
          amount: parseFloat(amount) || 0,
          category,
          vendorName,
          notes: notes || undefined,
          ...(photoBase64 ? { photoBase64 } : {}),
        },
      });
      queryClient.invalidateQueries({ queryKey: getGetJobQueryKey(jobId) });
      queryClient.invalidateQueries({ queryKey: getListJobReceiptsQueryKey(jobId) });
      toast({ title: "Receipt logged!" });
      setLocation(`/jobs/${jobId}`);
    } catch {
      toast({ title: "Failed to log receipt", variant: "destructive" });
    }
  };

  if (scannerOpen) {
    return (
      <DocumentScanner
        onCapture={handleScanComplete}
        onClose={() => setScannerOpen(false)}
      />
    );
  }

  return (
    <div className="pb-20 bg-background min-h-screen">
      <div className="bg-primary text-primary-foreground p-4 sticky top-0 z-10 flex items-center shadow-md">
        <Link href={`/jobs/${jobId}`} className="mr-3">
          <ChevronLeft className="w-6 h-6" />
        </Link>
        <h1 className="text-xl font-bold">Log Receipt</h1>
      </div>

      <form onSubmit={handleSubmit} className="p-4 space-y-6">
        <div className="space-y-2">
          <Label>Amount ($)</Label>
          <Input
            type="number"
            step="0.01"
            required
            className="h-16 text-3xl font-bold text-center"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
          />
        </div>

        <div className="space-y-2">
          <Label>Category</Label>
          <Select onValueChange={(val: any) => setCategory(val)}>
            <SelectTrigger className="h-14 text-lg">
              <SelectValue placeholder="Select Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="materials">Materials</SelectItem>
              <SelectItem value="labor">Labor</SelectItem>
              <SelectItem value="subcontractor">Subcontractor</SelectItem>
              <SelectItem value="equipment_tools">Equipment & Tools</SelectItem>
              <SelectItem value="vehicle_fuel">Vehicle & Fuel</SelectItem>
              <SelectItem value="other">Other</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>Vendor Name</Label>
          <Input
            className="h-12 text-lg"
            value={vendorName}
            onChange={(e) => setVendorName(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label>Notes</Label>
          <Textarea
            className="text-base"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Optional notes..."
            rows={2}
          />
        </div>

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
              <img src={photoPreview} alt="Receipt preview" className="w-full max-h-48 object-cover rounded-lg border" />
              <button
                type="button"
                onClick={clearPhoto}
                className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1.5"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => cameraInputRef.current?.click()}
                className="h-20 rounded-lg border-2 border-dashed border-input flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
              >
                <Camera className="w-5 h-5" />
                <span className="text-xs font-medium">Take Photo</span>
              </button>
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="h-20 rounded-lg border-2 border-dashed border-input flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
              >
                <ImagePlus className="w-5 h-5" />
                <span className="text-xs font-medium">Library</span>
              </button>
              <button
                type="button"
                onClick={() => setScannerOpen(true)}
                className="h-20 rounded-lg border-2 border-dashed border-input flex flex-col items-center justify-center gap-1 text-muted-foreground hover:border-primary hover:text-primary transition-colors"
              >
                <ScanLine className="w-5 h-5" />
                <span className="text-xs font-medium">Scan Doc</span>
              </button>
            </div>
          )}
        </div>

        <Button type="submit" className="w-full h-14 text-lg font-bold mt-8" disabled={createReceipt.isPending}>
          {createReceipt.isPending ? "Saving..." : "Save Receipt"}
        </Button>
      </form>
    </div>
  );
}
