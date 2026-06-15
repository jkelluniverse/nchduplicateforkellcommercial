import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { MoreHorizontal, FileText, MessageSquarePlus, CircleCheck as CheckCircle2, X, ChevronRight } from "lucide-react";
import { postOverride, deleteOverride, rentKeys } from "./api";
import type { RentRow, OverrideStatus } from "./types";
import { AddNoteSheet } from "./payment-notes";

const RESOLUTION_TYPES: { value: OverrideStatus; label: string }[] = [
  { value: "vacated", label: "Vacated / Evicted" },
  { value: "written_off", label: "Written Off" },
  { value: "arrangement", label: "Arrangement Made" },
  { value: "paid_cash", label: "Paid Cash" },
  { value: "other", label: "Other" },
];

const RESOLUTION_LABEL: Record<OverrideStatus, string> = {
  vacated: "Vacated / Evicted",
  written_off: "Written Off",
  arrangement: "Arrangement Made",
  paid_cash: "Paid Cash",
  other: "Other",
};

function Overlay({ onClose, children }: { onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-background rounded-t-2xl max-h-[90vh] flex flex-col shadow-xl">
        {children}
      </div>
    </div>
  );
}

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

// ── Mark as Resolved sheet ────────────────────────────────────────────────────

function MarkResolvedSheet({
  row,
  onClose,
  onSaved,
}: {
  row: RentRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = useState<OverrideStatus | "">("");
  const [notes, setNotes] = useState("");

  const save = useMutation({
    mutationFn: () =>
      postOverride({
        property_address: row.address,
        doorloop_lease_id: row.doorloopLeaseId ?? undefined,
        override_status: type,
        reason: type ? RESOLUTION_LABEL[type] : "",
        notes: notes.trim() || undefined,
      }),
    onSuccess: onSaved,
  });

  return (
    <Overlay onClose={onClose}>
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-border">
        <h3 className="text-base font-bold truncate pr-4">Mark {row.address} as Resolved</h3>
        <button type="button" onClick={onClose} className="p-1 rounded-full hover:bg-muted">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="p-4 space-y-4 overflow-y-auto">
        <div>
          <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
            Resolution Type
          </label>
          <div className="flex flex-wrap gap-2 mt-2">
            {RESOLUTION_TYPES.map((t) => (
              <button
                key={t.value}
                type="button"
                onClick={() => setType(t.value)}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border ${
                  type === t.value
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-foreground bg-background"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
            Reason / Notes
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full mt-1 border border-border rounded-lg px-3 py-2.5 text-sm bg-background resize-none"
            placeholder="Example: Eviction hearing June 11 at 1:30pm, property will be vacant after"
          />
        </div>
        {save.isError && (
          <p className="text-xs text-red-600">{(save.error as Error).message}</p>
        )}
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={save.isPending}
            className="flex-1 border border-border rounded-xl py-3 text-sm font-semibold bg-background disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => save.mutate()}
            disabled={!type || save.isPending}
            className="flex-1 rounded-xl py-3 text-sm font-semibold text-white disabled:opacity-40"
            style={{ backgroundColor: "#B23A2E" }}
          >
            {save.isPending ? "Saving…" : "Confirm Resolution"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

// ── Per-row "···" menu ────────────────────────────────────────────────────────

export function ResolveMenu({ row, onChanged }: { row: RentRow; onChanged: () => void }) {
  const [, setLocation] = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const [situationOpen, setSituationOpen] = useState(false);

  const handleGenerateNotice = () => {
    setMenuOpen(false);
    const docType: "ten_day_notice" | "notice_of_default" =
      row.daysOverdue >= 30 ? "notice_of_default" : "ten_day_notice";
    const periodLabel = new Date(row.year, row.month - 1, 1).toLocaleString("en-US", {
      month: "long",
      year: "numeric",
    });
    sessionStorage.setItem(
      "nch_doc_prefill",
      JSON.stringify({
        doc_type: docType,
        prefill: {
          tenant_name: row.tenantName ?? "",
          property_address: row.address,
          past_rent_amount: row.monthlyRent,
          rent_period: periodLabel,
          late_fees: row.lateFeeDue,
          default_amount: row.monthlyRent + row.lateFeeDue,
          seller_signatory: "",
        },
      }),
    );
    setLocation("/docs");
  };

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setMenuOpen(true);
        }}
        className="p-1.5 rounded-full hover:bg-muted shrink-0"
        aria-label="More actions"
      >
        <MoreHorizontal className="w-4 h-4 text-muted-foreground" />
      </button>

      {menuOpen && (
        <Overlay onClose={() => setMenuOpen(false)}>
          <div className="px-2 py-2">
            <p className="px-3 py-2 text-sm font-bold truncate">{row.address}</p>
            <MenuItem icon={<FileText className="w-4 h-4" />} label="Generate Notice" onClick={handleGenerateNotice} />
            <MenuItem
              icon={<MessageSquarePlus className="w-4 h-4" />}
              label="Add Payment Situation"
              onClick={() => { setMenuOpen(false); setSituationOpen(true); }}
            />
            <MenuItem
              icon={<CheckCircle2 className="w-4 h-4" />}
              label="Mark as Resolved"
              onClick={() => { setMenuOpen(false); setResolveOpen(true); }}
            />
          </div>
        </Overlay>
      )}

      {resolveOpen && (
        <MarkResolvedSheet
          row={row}
          onClose={() => setResolveOpen(false)}
          onSaved={() => { setResolveOpen(false); onChanged(); }}
        />
      )}

      <AddNoteSheet
        open={situationOpen}
        onOpenChange={(v) => setSituationOpen(v)}
        initialAddress={row.address}
        initialTenantName={row.tenantName ?? ""}
        initialLeaseId={row.doorloopLeaseId ?? ""}
        initialAmount={String(row.monthlyRent + row.lateFeeDue)}
        onSaved={() => { setSituationOpen(false); onChanged(); }}
      />
    </>
  );
}

function MenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="w-full flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-muted text-left text-sm font-medium"
    >
      <span className="text-muted-foreground">{icon}</span>
      {label}
    </button>
  );
}

// ── Resolved This Month section ───────────────────────────────────────────────

export function ResolvedThisMonthSection({
  rows,
  onChanged,
}: {
  rows: RentRow[];
  onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const qc = useQueryClient();

  const undo = useMutation({
    mutationFn: (id: number) => deleteOverride(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: rentKeys.all });
      onChanged();
    },
  });

  if (rows.length === 0) return null;

  return (
    <div className="border-t border-border pt-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-0.5"
      >
        <h3 className="text-sm font-bold">Resolved This Month ({rows.length})</h3>
        <ChevronRight className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
      </button>

      {expanded && (
        <div className="space-y-2 mt-2">
          {rows.map((r) => {
            const label = r.overrideStatus ? RESOLUTION_LABEL[r.overrideStatus] : "Resolved";
            return (
              <div key={r.address} className="border border-border border-l-4 border-l-green-500 rounded-lg p-3">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-600 mt-0.5 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold truncate">{r.address}</p>
                    {r.tenantName && (
                      <p className="text-xs text-muted-foreground">{r.tenantName}</p>
                    )}
                    <p className="text-xs font-medium text-green-700 mt-0.5">
                      {label}
                      {r.overrideCreatedAt ? ` · ${fmtDate(r.overrideCreatedAt)}` : ""}
                    </p>
                    {r.overrideNotes && (
                      <p className="text-xs text-muted-foreground italic mt-1">“{r.overrideNotes}”</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => r.overrideId && undo.mutate(r.overrideId)}
                    disabled={undo.isPending || !r.overrideId}
                    className="text-xs font-medium text-primary shrink-0 disabled:opacity-50"
                  >
                    Undo
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
