import { useState, useRef } from "react";
import { SheetButtonRow } from "@/components/sheet-button-row";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { Plus, ChevronRight, Trash2, X, Pencil, MessageSquare, Phone } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function authHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${localStorage.getItem("kc_token") ?? ""}`,
    "Content-Type": "application/json",
  };
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API_BASE}/api${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(body || `Request failed (${r.status})`);
  }
  return r.json() as Promise<T>;
}

export interface NoteComment {
  id: number;
  noteId: number;
  author: string;
  comment: string;
  createdAt: string;
}

export interface LedgerAssessment {
  currentBalance: number;
  flag: "paid" | "partial" | "returned" | "none";
  message: string | null;
  suggestedAmount: number | null;
}

export interface TenantNote {
  id: number;
  propertyAddress: string;
  tenantName: string;
  doorloopLeaseId: string | null;
  situation: string;
  expectedPaymentDate: string | null;
  expectedPaymentAmount: string | null;
  status: "open" | "missed_promise" | "resolved";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  comments: NoteComment[];
  ledger?: LedgerAssessment | null;
}

interface ReminderResponse {
  id: number;
  sentAt: string;
  stage: string;
  label: string;
  body: string;
  phone: string | null;
  tenantName: string | null;
}

/** Map a situation's status to the appropriate reminder template stage. */
function stageForNote(note: { status: string; ledger?: LedgerAssessment | null }): string {
  if (note.ledger?.flag === "returned") return "payment_returned";
  if (note.status === "missed_promise") return "missed_promise";
  return "situation_reminder";
}

/**
 * Send a per-stage text reminder: logs it on the server (logged on tap — the
 * native Messages composer can't confirm a real send), then opens the device's
 * Messages app prefilled with the recipient + message. Returns false (with an
 * alert) when no phone is on file.
 */
async function sendTextReminder(payload: {
  noteId?: number;
  propertyAddress: string;
  tenantName?: string | null;
  leaseId?: string | null;
  stage: string;
  amount?: number | string | null;
  date?: string | null;
}): Promise<boolean> {
  const res = await apiFetch<ReminderResponse>("/collection/reminders", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  if (!res.phone) {
    alert("No phone number on file for this tenant in Rentec.");
    return false;
  }
  const sms = `sms:${res.phone}${/(iphone|ipad|mac)/i.test(navigator.userAgent) ? "&" : "?"}body=${encodeURIComponent(res.body)}`;
  window.location.href = sms;
  return true;
}

interface LocalProperty {
  id: number;
  address: string;
  resident1Name: string | null;
  resident2Name: string | null;
  doorloopLeaseId: string | null;
}

export const tenantNoteKeys = {
  all: ["tenant-notes"] as const,
};

function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const parts = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!parts) return iso;
    const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return `${months[parseInt(parts[2], 10) - 1]} ${parseInt(parts[3], 10)}`;
  } catch {
    return iso;
  }
}

const AUTHOR_NAMES: Record<string, string> = { jacob: "Jacob", mike: "Mike", jack: "Jack" };

const STATUS_DOT: Record<string, string> = {
  open: "bg-yellow-400",
  missed_promise: "bg-red-500",
  resolved: "bg-green-500",
};

const STATUS_BORDER: Record<string, string> = {
  open: "border-l-yellow-400",
  missed_promise: "border-l-red-500",
  resolved: "border-l-green-500",
};

const STATUS_BADGE: Record<string, string> = {
  open: "bg-yellow-100 text-yellow-800",
  missed_promise: "bg-red-100 text-red-800",
  resolved: "bg-green-100 text-green-800",
};

const STATUS_LABEL: Record<string, string> = {
  open: "Open",
  missed_promise: "Missed Promise",
  resolved: "Resolved",
};

// ── Bottom sheet ──────────────────────────────────────────────────────────────

function BottomSheet({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex flex-col justify-end">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative bg-background rounded-t-2xl max-h-[90vh] flex flex-col shadow-xl">
        <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-border shrink-0">
          <h2 className="text-base font-bold truncate pr-4">{title}</h2>
          <button type="button" onClick={onClose} className="p-1 rounded-full hover:bg-muted shrink-0">
            <X className="w-5 h-5" />
          </button>
        </div>
        <div className="overflow-y-auto flex-1">{children}</div>
        {footer && (
          <SheetButtonRow border className="shrink-0">
            {footer}
          </SheetButtonRow>
        )}
      </div>
    </div>
  );
}

// ── Note card ─────────────────────────────────────────────────────────────────

function NoteCard({
  note,
  onTap,
  isJacob,
}: {
  note: TenantNote;
  onTap: () => void;
  isJacob: boolean;
}) {
  const [, setLocation] = useLocation();
  const dot = STATUS_DOT[note.status] ?? "bg-gray-400";
  const border = STATUS_BORDER[note.status] ?? "border-l-gray-400";

  // Show the most recent comment on the summary card when one exists; otherwise
  // fall back to the original situation text. (Comments arrive sorted ascending
  // by createdAt, but compute the max defensively so order can't break this.)
  const mostRecentComment =
    note.comments.length > 0
      ? note.comments.reduce((a, b) =>
          new Date(b.createdAt).getTime() >= new Date(a.createdAt).getTime() ? b : a,
        )
      : null;
  const displayText = mostRecentComment?.comment ?? note.situation;

  return (
    <div className={`border border-border border-l-4 ${border} rounded-lg overflow-hidden`}>
      <button type="button" onClick={onTap} className="w-full text-left p-3">
        <div className="flex items-start gap-2">
          <span className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${dot}`} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold truncate">{note.propertyAddress}</p>
            <p className="text-xs text-muted-foreground">{note.tenantName}</p>
            <p className="text-xs text-muted-foreground italic mt-0.5 line-clamp-2">
              &ldquo;{displayText}&rdquo;
            </p>
            {(note.expectedPaymentDate || note.expectedPaymentAmount) && (
              <p className="text-xs font-medium text-foreground mt-1">
                {note.expectedPaymentDate
                  ? `Expected: ${formatShortDate(note.expectedPaymentDate)}`
                  : ""}
                {note.expectedPaymentAmount
                  ? ` · $${Number(note.expectedPaymentAmount).toLocaleString()}`
                  : ""}
              </p>
            )}
            {note.ledger && (note.ledger.flag === "returned" || note.ledger.flag === "partial" || note.ledger.flag === "paid") && (
              <span
                className={`inline-block mt-1 text-[10px] font-bold px-2 py-0.5 rounded-full ${
                  note.ledger.flag === "returned"
                    ? "bg-red-100 text-red-700"
                    : note.ledger.flag === "paid"
                      ? "bg-green-100 text-green-700"
                      : "bg-amber-100 text-amber-700"
                }`}
              >
                {note.ledger.flag === "returned" ? "Payment returned" : note.ledger.flag === "paid" ? "Paid in full" : "Payment activity"}
              </span>
            )}
            <p className="text-[10px] text-muted-foreground mt-1">
              {mostRecentComment
                ? `${AUTHOR_NAMES[mostRecentComment.author] ?? mostRecentComment.author} · ${formatDistanceToNow(new Date(mostRecentComment.createdAt), { addSuffix: true })}`
                : `Added by ${AUTHOR_NAMES[note.createdBy] ?? note.createdBy} · ${formatDistanceToNow(new Date(note.createdAt), { addSuffix: true })}`}
              {note.comments.length > 0 && ` · ${note.comments.length} comment${note.comments.length !== 1 ? "s" : ""}`}
            </p>
          </div>
        </div>
      </button>

      {note.status === "missed_promise" && isJacob && (
        <button
          type="button"
          onClick={() => {
            sessionStorage.setItem(
              "nch_docs_prefill",
              JSON.stringify({
                docId: "three_day_notice",
                fields: {
                  property_address: note.propertyAddress,
                  tenant_name: note.tenantName,
                },
              }),
            );
            setLocation("/docs");
          }}
          className="w-full border-t border-red-100 bg-red-50 text-red-700 text-xs font-semibold py-2 text-center"
        >
          Send Notice →
        </button>
      )}
    </div>
  );
}

// ── Add note sheet ────────────────────────────────────────────────────────────

function AddNoteSheet({
  open,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
}) {
  const [propId, setPropId] = useState("");
  const [propertyAddress, setPropertyAddress] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [doorloopLeaseId, setDoorloopLeaseId] = useState("");
  const [situation, setSituation] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [expectedAmount, setExpectedAmount] = useState("");

  const { data: properties = [] } = useQuery<LocalProperty[]>({
    queryKey: ["properties-list"],
    queryFn: () => apiFetch<LocalProperty[]>("/properties"),
    staleTime: 5 * 60 * 1000,
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: (body: Record<string, string | undefined>) =>
      apiFetch<TenantNote>("/tenant-notes", { method: "POST", body: JSON.stringify(body) }),
    onSuccess: () => {
      onSaved();
      handleClose();
    },
  });

  const reset = () => {
    setPropId("");
    setPropertyAddress("");
    setTenantName("");
    setDoorloopLeaseId("");
    setSituation("");
    setExpectedDate("");
    setExpectedAmount("");
  };

  const handleClose = () => { reset(); onOpenChange(false); };

  const handlePropertySelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    setPropId(id);
    const prop = properties.find((p) => String(p.id) === id);
    if (prop) {
      setPropertyAddress(prop.address);
      const r1 = prop.resident1Name?.trim() || "";
      const r2 = prop.resident2Name?.trim() || "";
      setTenantName(r1 && r2 ? `${r1} & ${r2}` : r1);
      setDoorloopLeaseId(prop.doorloopLeaseId ?? "");
    }
  };

  const canSave = !!situation.trim();

  const footer = (
    <>
      <button
        type="button"
        onClick={handleClose}
        className="flex-1 border border-border rounded-xl py-3 text-sm font-semibold bg-background text-foreground"
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={() =>
          createMutation.mutate({
            propertyAddress,
            tenantName,
            doorloopLeaseId: doorloopLeaseId || undefined,
            situation,
            expectedPaymentDate: expectedDate || undefined,
            expectedPaymentAmount: expectedAmount || undefined,
          })
        }
        disabled={!canSave || createMutation.isPending}
        className="flex-1 rounded-xl py-3 text-sm font-semibold text-white disabled:opacity-40"
        style={{ backgroundColor: "#B23A2E" }}
      >
        {createMutation.isPending ? "Saving…" : "Save Note"}
      </button>
    </>
  );

  return (
    <BottomSheet open={open} onClose={handleClose} title="Add Payment Situation" footer={footer}>
      <div className="p-4 space-y-4">
        <div>
          <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
            Property
          </label>
          <select
            value={propId}
            onChange={handlePropertySelect}
            className="w-full mt-1 border border-border rounded-lg px-3 py-2.5 text-sm bg-background"
          >
            <option value="">— select a property —</option>
            {properties
              .slice()
              .sort((a, b) => a.address.localeCompare(b.address))
              .map((p) => {
                const r1 = p.resident1Name?.trim() || null;
                const r2 = p.resident2Name?.trim() || null;
                const label = p.address + (r1 && r2 ? ` — ${r1} & ${r2}` : r1 ? ` — ${r1}` : " — Vacant");
                return (
                  <option key={p.id} value={p.id}>
                    {label}
                  </option>
                );
              })}
          </select>
        </div>

        <div>
          <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
            Tenant Name *
          </label>
          <input
            value={tenantName}
            onChange={(e) => setTenantName(e.target.value)}
            className="w-full mt-1 border border-border rounded-lg px-3 py-2.5 text-sm bg-background"
            placeholder="Full name"
          />
        </div>

        <div>
          <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
            Address *
          </label>
          <input
            value={propertyAddress}
            onChange={(e) => setPropertyAddress(e.target.value)}
            className="w-full mt-1 border border-border rounded-lg px-3 py-2.5 text-sm bg-background"
            placeholder="Full street address"
          />
        </div>

        <div>
          <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
            Situation *
          </label>
          <textarea
            value={situation}
            onChange={(e) => setSituation(e.target.value)}
            rows={3}
            className="w-full mt-1 border border-border rounded-lg px-3 py-2.5 text-sm bg-background resize-none"
            placeholder="Describe the payment situation..."
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
              Expected Date
            </label>
            <input
              type="date"
              value={expectedDate}
              onChange={(e) => setExpectedDate(e.target.value)}
              className="w-full mt-1 border border-border rounded-lg px-3 py-2.5 text-sm bg-background"
            />
          </div>
          <div>
            <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
              Amount ($)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={expectedAmount}
              onChange={(e) => setExpectedAmount(e.target.value)}
              className="w-full mt-1 border border-border rounded-lg px-3 py-2.5 text-sm bg-background"
              placeholder="0.00"
            />
          </div>
        </div>

        {createMutation.isError && (
          <p className="text-xs text-red-600">
            {(createMutation.error as Error).message}
          </p>
        )}
      </div>
    </BottomSheet>
  );
}

// ── Note detail sheet ─────────────────────────────────────────────────────────

function NoteDetailSheet({
  note,
  onClose,
  onChanged,
  isJacob,
}: {
  note: TenantNote | null;
  onClose: () => void;
  onChanged: () => void;
  isJacob: boolean;
}) {
  const [, setLocation] = useLocation();
  const [comment, setComment] = useState("");
  const commentRef = useRef<HTMLInputElement>(null);

  // Inline-edit state (Feature 1: edit in place, never delete-and-recreate).
  const [editing, setEditing] = useState(false);
  const [edSituation, setEdSituation] = useState("");
  const [edDate, setEdDate] = useState("");
  const [edAmount, setEdAmount] = useState("");
  const [edStatus, setEdStatus] = useState<TenantNote["status"]>("open");

  const startEdit = () => {
    if (!note) return;
    setEdSituation(note.situation);
    setEdDate(note.expectedPaymentDate ?? "");
    setEdAmount(note.expectedPaymentAmount ?? "");
    setEdStatus(note.status);
    setEditing(true);
  };

  const patchMutation = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      apiFetch(`/tenant-notes/${note!.id}`, { method: "PATCH", body: JSON.stringify(body) }),
    onSuccess: () => { setEditing(false); onChanged(); },
  });

  const postCommentMutation = useMutation({
    mutationFn: (text: string) =>
      apiFetch(`/tenant-notes/${note!.id}/comments`, {
        method: "POST",
        body: JSON.stringify({ comment: text }),
      }),
    onSuccess: () => { setComment(""); onChanged(); },
  });

  const resolveMutation = useMutation({
    mutationFn: () => apiFetch(`/tenant-notes/${note!.id}/resolve`, { method: "PUT" }),
    onSuccess: () => { onChanged(); onClose(); },
  });

  const deleteMutation = useMutation({
    mutationFn: () => apiFetch(`/tenant-notes/${note!.id}`, { method: "DELETE" }),
    onSuccess: () => { onChanged(); onClose(); },
  });

  // One-tap "update amount to current Rentec balance" (Feature 2 banner action).
  const applyBalanceMutation = useMutation({
    mutationFn: (amount: number) =>
      apiFetch(`/tenant-notes/${note!.id}`, {
        method: "PATCH",
        body: JSON.stringify({ expectedPaymentAmount: amount.toFixed(2) }),
      }),
    onSuccess: () => onChanged(),
  });

  const reminderMutation = useMutation({
    mutationFn: () =>
      sendTextReminder({
        noteId: note!.id,
        propertyAddress: note!.propertyAddress,
        tenantName: note!.tenantName,
        leaseId: note!.doorloopLeaseId,
        stage: stageForNote(note!),
        amount: note!.ledger?.suggestedAmount ?? note!.expectedPaymentAmount,
        date: note!.expectedPaymentDate,
      }),
    onSuccess: () => onChanged(),
  });

  const { data: reminders = [] } = useQuery<Array<{ id: number; stage: string; sentAt: string; sentBy: string }>>({
    queryKey: ["reminders", note?.id],
    queryFn: () => apiFetch(`/collection/reminders?noteId=${note!.id}`),
    enabled: !!note,
  });

  if (!note) return null;

  const badgeClass = STATUS_BADGE[note.status] ?? "bg-gray-100 text-gray-800";
  const label = STATUS_LABEL[note.status] ?? note.status;
  const led = note.ledger;
  const showBanner = led && (led.flag === "partial" || led.flag === "returned" || led.flag === "paid");

  return (
    <BottomSheet open={!!note} onClose={onClose} title={note.propertyAddress}>
      <div className="p-4 space-y-4 pb-8">
        {/* Tenant + status + edit toggle */}
        <div className="flex items-center justify-between">
          <p className="text-base font-semibold">{note.tenantName}</p>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${badgeClass}`}>{label}</span>
            {isJacob && !editing && (
              <button type="button" onClick={startEdit} className="p-1.5 rounded-full hover:bg-muted" aria-label="Edit situation">
                <Pencil className="w-4 h-4 text-muted-foreground" />
              </button>
            )}
          </div>
        </div>

        {/* Ledger-informed banner (Feature 2): partial / returned / paid */}
        {showBanner && (
          <div
            className={`rounded-xl p-3 text-sm ${
              led!.flag === "returned"
                ? "bg-red-50 border border-red-200 text-red-800"
                : led!.flag === "paid"
                  ? "bg-green-50 border border-green-200 text-green-800"
                  : "bg-amber-50 border border-amber-200 text-amber-800"
            }`}
          >
            <p className="font-semibold">
              {led!.flag === "returned" ? "Payment returned" : led!.flag === "paid" ? "Paid in full" : "Payment activity"}
            </p>
            {led!.message && <p className="text-xs mt-0.5">{led!.message}</p>}
            {isJacob && led!.flag !== "paid" && led!.suggestedAmount != null &&
              String(led!.suggestedAmount.toFixed(2)) !== String(note.expectedPaymentAmount ?? "") && (
                <button
                  type="button"
                  onClick={() => applyBalanceMutation.mutate(led!.suggestedAmount!)}
                  disabled={applyBalanceMutation.isPending}
                  className="mt-2 inline-block rounded-lg bg-white/70 border border-current px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                >
                  {applyBalanceMutation.isPending
                    ? "Updating…"
                    : `Update amount to $${led!.suggestedAmount!.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                </button>
              )}
            {led!.flag !== "paid" && (
              <p className="text-[10px] mt-2 opacity-80">
                Expected date isn&rsquo;t changed automatically — edit it if the remaining balance needs a new date.
              </p>
            )}
          </div>
        )}

        {/* Situation — view or edit */}
        {editing ? (
          <div className="space-y-3 bg-muted/40 rounded-xl p-3">
            <div>
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Situation</label>
              <textarea
                value={edSituation}
                onChange={(e) => setEdSituation(e.target.value)}
                rows={3}
                className="w-full mt-1 border border-border rounded-lg px-3 py-2 text-sm bg-background resize-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Expected Date</label>
                <input type="date" value={edDate} onChange={(e) => setEdDate(e.target.value)}
                  className="w-full mt-1 border border-border rounded-lg px-2 py-2 text-sm bg-background" />
              </div>
              <div>
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Amount ($)</label>
                <input type="number" min="0" step="0.01" value={edAmount} onChange={(e) => setEdAmount(e.target.value)}
                  className="w-full mt-1 border border-border rounded-lg px-2 py-2 text-sm bg-background" />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Status</label>
              <select value={edStatus} onChange={(e) => setEdStatus(e.target.value as TenantNote["status"])}
                className="w-full mt-1 border border-border rounded-lg px-2 py-2 text-sm bg-background">
                <option value="open">Open</option>
                <option value="missed_promise">Missed Promise</option>
                <option value="resolved">Resolved</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setEditing(false)}
                className="flex-1 border border-border rounded-lg py-2 text-sm font-semibold">Cancel</button>
              <button
                type="button"
                onClick={() =>
                  patchMutation.mutate({
                    situation: edSituation,
                    expectedPaymentDate: edDate || null,
                    expectedPaymentAmount: edAmount || null,
                    status: edStatus,
                  })
                }
                disabled={patchMutation.isPending}
                className="flex-1 rounded-lg py-2 text-sm font-semibold text-white disabled:opacity-50"
                style={{ backgroundColor: "#B23A2E" }}
              >
                {patchMutation.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="bg-muted/50 rounded-xl p-3">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1">Situation</p>
              <p className="text-sm leading-relaxed">{note.situation}</p>
            </div>
            {(note.expectedPaymentDate || note.expectedPaymentAmount) && (
              <div className="flex gap-6">
                {note.expectedPaymentDate && (
                  <div>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Expected Date</p>
                    <p className="text-sm font-semibold mt-0.5">{formatShortDate(note.expectedPaymentDate)}</p>
                  </div>
                )}
                {note.expectedPaymentAmount && (
                  <div>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Amount</p>
                    <p className="text-sm font-semibold mt-0.5">${Number(note.expectedPaymentAmount).toLocaleString()}</p>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Text reminder (Feature 5) */}
        {isJacob && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => reminderMutation.mutate()}
              disabled={reminderMutation.isPending}
              className="flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-sm font-semibold disabled:opacity-50"
            >
              <MessageSquare className="w-4 h-4" />
              {reminderMutation.isPending ? "Opening…" : "Text reminder"}
            </button>
            {reminders.length > 0 && (
              <span className="text-[10px] text-muted-foreground">
                Last sent {formatDistanceToNow(new Date(reminders[0].sentAt), { addSuffix: true })} · {reminders.length} total
              </span>
            )}
          </div>
        )}

        {/* Comments (system entries styled distinctly) */}
        <div>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-2">Comments &amp; History</p>
          {note.comments.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No comments yet</p>
          ) : (
            <div className="space-y-2 mb-3">
              {note.comments.map((c) =>
                c.author === "system" ? (
                  <div key={c.id} className="border-l-2 border-blue-300 bg-blue-50/60 rounded-r-lg px-3 py-1.5">
                    <p className="text-[10px] font-semibold text-blue-700">
                      System · {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}
                    </p>
                    <p className="text-xs text-blue-900 mt-0.5">{c.comment}</p>
                  </div>
                ) : (
                  <div key={c.id} className="bg-muted/40 rounded-xl px-3 py-2">
                    <p className="text-[10px] font-bold text-muted-foreground">
                      {AUTHOR_NAMES[c.author] ?? c.author} · {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}
                    </p>
                    <p className="text-sm mt-0.5">{c.comment}</p>
                  </div>
                ),
              )}
            </div>
          )}

          <div className="flex gap-2 mt-2">
            <input
              ref={commentRef}
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && comment.trim()) {
                  e.preventDefault();
                  postCommentMutation.mutate(comment.trim());
                }
              }}
              placeholder="Add a comment…"
              className="flex-1 border border-border rounded-lg px-3 py-2 text-sm bg-background"
            />
            <button
              type="button"
              onClick={() => comment.trim() && postCommentMutation.mutate(comment.trim())}
              disabled={!comment.trim() || postCommentMutation.isPending}
              className="bg-primary text-primary-foreground rounded-lg px-4 text-sm font-semibold disabled:opacity-50"
            >
              {postCommentMutation.isPending ? "…" : "Post"}
            </button>
          </div>
        </div>

        {/* Jacob-only actions */}
        {isJacob && !editing && (
          <SheetButtonRow border className="-mx-4 px-4">
            {note.status === "missed_promise" && (
              <button
                type="button"
                onClick={() => {
                  sessionStorage.setItem(
                    "nch_docs_prefill",
                    JSON.stringify({
                      docId: "three_day_notice",
                      fields: { property_address: note.propertyAddress, tenant_name: note.tenantName },
                    }),
                  );
                  setLocation("/docs");
                }}
                className="flex-1 border border-red-200 bg-red-50 text-red-700 rounded-xl py-2.5 text-sm font-semibold"
              >
                Send Notice
              </button>
            )}

            {note.status !== "resolved" && (
              <button
                type="button"
                onClick={() => resolveMutation.mutate()}
                disabled={resolveMutation.isPending}
                className="flex-1 bg-green-600 text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50"
              >
                {resolveMutation.isPending ? "Resolving…" : "Mark Resolved"}
              </button>
            )}

            <button
              type="button"
              onClick={() => { if (confirm("Delete this note?")) deleteMutation.mutate(); }}
              disabled={deleteMutation.isPending}
              className="border border-border rounded-xl px-3 py-2.5 text-muted-foreground disabled:opacity-50"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          </SheetButtonRow>
        )}
      </div>
    </BottomSheet>
  );
}

// ── Needs Contacted (Feature 3: unpaid back-check) ────────────────────────────

interface NeedsContactedItem {
  address: string;
  tenantName: string | null;
  leaseId: string | null;
  amountOwed: number;
  status: string;
  daysOverdue: number;
  phone: string | null;
}

function NeedsContactedSection({ isJacob }: { isJacob: boolean }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(true);

  const { data } = useQuery<{ entries: NeedsContactedItem[]; source: string }>({
    queryKey: ["needs-contacted"],
    queryFn: () => apiFetch(`/collection/needs-contacted`),
    refetchInterval: 5 * 60 * 1000,
  });

  const entries = data?.entries ?? [];

  const reminderMutation = useMutation({
    mutationFn: async (item: NeedsContactedItem) => {
      await sendTextReminder({
        propertyAddress: item.address,
        tenantName: item.tenantName,
        leaseId: item.leaseId,
        stage: "needs_contacted",
        amount: item.amountOwed,
      });
      // A sent reminder counts as outreach → log a contact so it drops off the list.
      await apiFetch(`/collection/contacts`, {
        method: "POST",
        body: JSON.stringify({ propertyAddress: item.address, tenantName: item.tenantName, method: "text" }),
      });
    },
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["needs-contacted"] }),
  });

  const logContactMutation = useMutation({
    mutationFn: (item: NeedsContactedItem) =>
      apiFetch(`/collection/contacts`, {
        method: "POST",
        body: JSON.stringify({ propertyAddress: item.address, tenantName: item.tenantName, method: "call" }),
      }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: ["needs-contacted"] }),
  });

  if (!isJacob || entries.length === 0) return null;

  return (
    <div className="mb-3">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-1 text-sm font-bold text-red-700 mb-2"
      >
        <ChevronRight className={`w-3.5 h-3.5 transition-transform ${expanded ? "rotate-90" : ""}`} />
        Needs Contacted ({entries.length})
      </button>
      {expanded && (
        <div className="space-y-2">
          {entries.map((item) => (
            <div key={item.address} className="border border-red-200 bg-red-50/40 rounded-lg p-3">
              <p className="text-sm font-semibold truncate">{item.address}</p>
              <p className="text-xs text-muted-foreground">
                {item.tenantName ?? "Unknown tenant"}
                {item.amountOwed > 0 && ` · owes $${item.amountOwed.toLocaleString(undefined, { minimumFractionDigits: 2 })}`}
                {item.daysOverdue > 0 && ` · ${item.daysOverdue}d overdue`}
              </p>
              <div className="flex gap-2 mt-2">
                <button
                  type="button"
                  onClick={() => reminderMutation.mutate(item)}
                  disabled={!item.phone || reminderMutation.isPending}
                  title={item.phone ? "Send a text reminder" : "No phone on file in Rentec"}
                  className="flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-semibold disabled:opacity-40"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  Text
                </button>
                <button
                  type="button"
                  onClick={() => logContactMutation.mutate(item)}
                  disabled={logContactMutation.isPending}
                  className="flex items-center gap-1 rounded-lg border border-border bg-background px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50"
                >
                  <Phone className="w-3.5 h-3.5" />
                  Log call
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main export ───────────────────────────────────────────────────────────────

export function PaymentSituationsSection() {
  const { user } = useAuth();
  const isJacob = user?.role === "jacob";
  const qc = useQueryClient();

  const [addOpen, setAddOpen] = useState(false);
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(null);
  const [resolvedExpanded, setResolvedExpanded] = useState(false);

  const { data: notes = [] } = useQuery<TenantNote[]>({
    queryKey: tenantNoteKeys.all,
    queryFn: () => apiFetch<TenantNote[]>("/tenant-notes"),
    refetchInterval: 3 * 60 * 1000,
  });

  const selectedNote = selectedNoteId !== null ? (notes.find((n) => n.id === selectedNoteId) ?? null) : null;

  const invalidate = () => void qc.invalidateQueries({ queryKey: tenantNoteKeys.all });

  const missedNotes = notes.filter((n) => n.status === "missed_promise");
  const openNotes = notes.filter((n) => n.status === "open");
  const resolvedNotes = notes.filter((n) => n.status === "resolved");
  const hasNotes = notes.length > 0;

  if (!hasNotes && !isJacob) return null;

  return (
    <div className="border-t border-border pt-3">
      <NeedsContactedSection isJacob={isJacob} />
      <div className="flex items-center justify-between px-0.5 mb-2">
        <h3 className="text-sm font-bold">Payment Situations</h3>
        {isJacob && (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className="text-xs font-medium text-primary flex items-center gap-1"
          >
            <Plus className="w-3 h-3" />
            Add
          </button>
        )}
      </div>

      {!hasNotes ? (
        <p className="text-sm text-muted-foreground px-0.5 py-1">
          No payment situations logged
        </p>
      ) : (
        <div className="space-y-2">
          {missedNotes.map((n) => (
            <NoteCard
              key={n.id}
              note={n}
              onTap={() => setSelectedNoteId(n.id)}
              isJacob={isJacob}
            />
          ))}
          {openNotes.map((n) => (
            <NoteCard
              key={n.id}
              note={n}
              onTap={() => setSelectedNoteId(n.id)}
              isJacob={isJacob}
            />
          ))}
          {resolvedNotes.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setResolvedExpanded((v) => !v)}
                className="flex items-center gap-1 text-xs font-medium text-muted-foreground mt-1 px-0.5"
              >
                <ChevronRight
                  className={`w-3 h-3 transition-transform ${resolvedExpanded ? "rotate-90" : ""}`}
                />
                Resolved ({resolvedNotes.length})
              </button>
              {resolvedExpanded && (
                <div className="space-y-2 mt-2">
                  {resolvedNotes.map((n) => (
                    <NoteCard
                      key={n.id}
                      note={n}
                      onTap={() => setSelectedNoteId(n.id)}
                      isJacob={isJacob}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <AddNoteSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        onSaved={invalidate}
      />
      <NoteDetailSheet
        note={selectedNote}
        onClose={() => setSelectedNoteId(null)}
        onChanged={invalidate}
        isJacob={isJacob}
      />
    </div>
  );
}
