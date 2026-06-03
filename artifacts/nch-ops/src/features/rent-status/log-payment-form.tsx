import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { SheetButtonRow } from "@/components/sheet-button-row";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { format } from "date-fns";
import { logPayment, rentKeys, type LogPaymentInput } from "./api";

interface Props {
  propertyId: number;
  month: number;
  year: number;
  defaultAmount: number;
  lateFeeDue: number;
  onSaved: () => void;
  onCancel: () => void;
}

export function LogPaymentForm({
  propertyId,
  month,
  year,
  defaultAmount,
  lateFeeDue,
  onSaved,
  onCancel,
}: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [amount, setAmount] = useState(String(defaultAmount || ""));
  const [paymentDate, setPaymentDate] = useState(format(new Date(), "yyyy-MM-dd"));
  const [lateFeePaid, setLateFeePaid] = useState(lateFeeDue > 0);
  const [notes, setNotes] = useState("");

  const mut = useMutation({
    mutationFn: async (body: LogPaymentInput) => logPayment(propertyId, month, year, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: rentKeys.all });
      toast({ title: "Payment logged" });
      onSaved();
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : "Failed to log payment";
      toast({ title: "Error", description: msg, variant: "destructive" });
    },
  });

  const submit = () => {
    const n = Number(amount);
    if (!Number.isFinite(n) || n < 0) {
      toast({ title: "Enter a valid amount", variant: "destructive" });
      return;
    }
    // Convert YYYY-MM-DD → MM/DD/YYYY for display per spec.
    const [y, m, d] = paymentDate.split("-");
    const pretty = y && m && d ? `${m}/${d}/${y}` : paymentDate;
    mut.mutate({
      amount_paid: n,
      late_fee_paid: lateFeePaid ? lateFeeDue : 0,
      payment_date: pretty,
      notes: notes || null,
    });
  };

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="amount">Amount Received</Label>
        <Input
          id="amount"
          type="number"
          inputMode="decimal"
          step="0.01"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0.00"
          className="mt-1.5 text-base"
        />
      </div>

      <div>
        <Label htmlFor="payment-date">Payment Date</Label>
        <Input
          id="payment-date"
          type="date"
          value={paymentDate}
          onChange={(e) => setPaymentDate(e.target.value)}
          className="mt-1.5 text-base"
        />
      </div>

      {lateFeeDue > 0 && (
        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div>
            <p className="text-sm font-medium">Late fee paid?</p>
            <p className="text-xs text-muted-foreground">
              Outstanding fee: ${lateFeeDue.toFixed(2)}
            </p>
          </div>
          <Switch checked={lateFeePaid} onCheckedChange={setLateFeePaid} />
        </div>
      )}

      <div>
        <Label htmlFor="notes">Notes</Label>
        <Textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={2}
          placeholder="Optional"
          className="mt-1.5"
        />
      </div>

      <SheetButtonRow>
        <Button variant="outline" className="flex-1" onClick={onCancel} disabled={mut.isPending}>
          Cancel
        </Button>
        <Button className="flex-1" onClick={submit} disabled={mut.isPending}>
          {mut.isPending ? "Saving..." : "Save Payment"}
        </Button>
      </SheetButtonRow>
    </div>
  );
}
