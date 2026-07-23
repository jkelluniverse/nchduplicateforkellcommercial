import { useState, useRef, useEffect } from "react";
import { SheetButtonRow } from "@/components/sheet-button-row";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { useLocation } from "wouter";
import { Plus, ChevronRight, Trash2, X, MessageSquare, Pencil, Scale, TriangleAlert as AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { postOverride, rentKeys } from "./api";

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

/** Log that a reminder text was sent for a situation (comment + contact log). */
function sendReminderLog(noteId: number): Promise<unknown> {
  return apiFetch(`/tenant-notes/${noteId}/remind`, { method: "POST" });
}

export interface NoteComment {
  id: number;
  noteId: number;
  author: string;
  comment: string;
  kind?: string | null;
  createdAt: string;
}

export interface PatchSituationInput {
  situation?: string;
  expectedPaymentDate?: string | null;
  expectedPaymentAmount?: string | null;
  status?: "open" | "missed_promise" | "resolved";
  auto?: boolean;
  paymentContext?: string;
  ledgerAckBalance?: string | null;
}

function patchSituation(noteId: number, body: PatchSituationInput): Promise<TenantNote> {
  return apiFetch<TenantNote>(`/tenant-notes/${noteId}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export interface TenantNote {
  id: number;
  propertyAddress: string;
  tenantName: string;
  // Kept as `doorloopLeaseId` deliberately (target convention).
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
  tenantFirstName?: string | null;
  tenantPhone?: string | null;
  expectedDateOrdinal?: string | null;
  reminderMessage?: string | null;
  ledgerFlag?: LedgerFlag | null;
}

export interface LedgerFlag {
  kind: "partial" | "returned";
  currentBalance: number;
  situationAmount: number | null;
  receivedSince: number;
  receivedCount: number;
  receivedDate: string | null;
  applied: boolean;
  paymentContext: string;
}

function usdShort(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

/** Marker text the backend logs for a sent reminder. */
const REMINDER_COMMENT = "Reminder text sent";

/** Most recent reminder comment's timestamp, or null. */
function lastReminderAt(note: TenantNote): Date | null {
  const reminders = note.comments.filter((c) => c.comment === REMINDER_COMMENT);
  if (reminders.length === 0) return null;
  const latest = reminders.reduce((a, b) =>
    new Date(b.createdAt).getTime() >= new Date(a.createdAt).getTime() ? b : a,
  );
  return new Date(latest.createdAt);
}

/** Days from today to the expected date (0 = today, 1 = tomorrow, <0 = past). */
function daysUntilExpected(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const due = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((due.getTime() - today.getTime()) / 86_400_000);
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

export function AddNoteSheet({
  open,
  onOpenChange,
  onSaved,
  initialAddress,
  initialTenantName,
  initialLeaseId,
  initialAmount,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onSaved: () => void;
  initialAddress?: string;
  initialTenantName?: string;
  initialLeaseId?: string;
  initialAmount?: string;
}) {
  const [propId, setPropId] = useState("");
  const [propertyAddress, setPropertyAddress] = useState("");
  const [tenantName, setTenantName] = useState("");
  const [doorloopLeaseId, setDoorloopLeaseId] = useState("");
  const [situation, setSituation] = useState("");
  const [expectedDate, setExpectedDate] = useState("");
  const [expectedAmount, setExpectedAmount] = useState("");

  // When launched prefilled (e.g. the "+ Sit" shortcut) we already know the
  // property, so the picker is hidden and the fields come in populated.
  const prefilled = initialAddress !== undefined;

  // Apply any prefill (e.g. from the "+ Sit" shortcut) when the sheet opens.
  useEffect(() => {
    if (!open) return;
    if (initialAddress !== undefined) setPropertyAddress(initialAddress);
    if (initialTenantName !== undefined) setTenantName(initialTenantName);
    if (initialLeaseId !== undefined) setDoorloopLeaseId(initialLeaseId);
    if (initialAmount !== undefined) setExpectedAmount(initialAmount);
  }, [open, initialAddress, initialTenantName, initialLeaseId, initialAmount]);

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
        {prefilled ? (
          <div className="rounded-lg bg-muted/50 px-3 py-2">
            <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
              Property
            </p>
            <p className="text-sm font-semibold mt-0.5">{propertyAddress}</p>
          </div>
        ) : (
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
        )}

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
  onRemind,
}: {
  note: TenantNote | null;
  onClose: () => void;
  onChanged: () => void;
  isJacob: boolean;
  onRemind?: (note: TenantNote) => void;
}) {
  const [, setLocation] = useLocation();
  const [comment, setComment] = useState("");
  const commentRef = useRef<HTMLInputElement>(null);

  const postCommentMutation = useMutation({
    mutationFn: (text: string) =>
      apiFetch(`/tenant-notes/${note!.id}/comments`, {
        method: "POST",
        body: JSON.stringify({ comment: text }),
      }),
    onSuccess: () => {
      setComment("");
      onChanged();
    },
  });

  const resolveMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/tenant-notes/${note!.id}/resolve`, { method: "PUT" }),
    onSuccess: () => { onChanged(); onClose(); },
  });

  const deleteMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/tenant-notes/${note!.id}`, { method: "DELETE" }),
    onSuccess: () => { onChanged(); onClose(); },
  });

  const qc = useQueryClient();
  const markDelinquent = useMutation({
    mutationFn: () => postOverride({
      property_address: note!.propertyAddress,
      doorloop_lease_id: note!.doorloopLeaseId ?? undefined,
      override_status: "manual_delinquent",
      reason: "Tenant stated they will not / cannot pay",
    }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: rentKeys.all }); toast.success("Marked delinquent"); },
    onError: () => toast.error("Couldn't update — try again"),
  });

  const [editing, setEditing] = useState(false);
  const [eSituation, setESituation] = useState("");
  const [eDate, setEDate] = useState("");
  const [eAmount, setEAmount] = useState("");
  const [eStatus, setEStatus] = useState<TenantNote["status"]>("open");

  const patchMutation = useMutation({
    mutationFn: (body: PatchSituationInput) => patchSituation(note!.id, body),
    onSuccess: () => { setEditing(false); onChanged(); },
  });

  const startEdit = () => {
    if (!note) return;
    setESituation(note.situation);
    setEDate(note.expectedPaymentDate ?? "");
    setEAmount(note.expectedPaymentAmount ?? "");
    setEStatus(note.status);
    setEditing(true);
  };

  if (!note) return null;

  const badgeClass = STATUS_BADGE[note.status] ?? "bg-gray-100 text-gray-800";
  const label = STATUS_LABEL[note.status] ?? note.status;
  // Reminder log entries get their own block, so keep them out of Comments.
  const visibleComments = note.comments.filter(
    (c) => c.kind !== "reminder" && c.comment !== REMINDER_COMMENT,
  );

  return (
    <BottomSheet open={!!note} onClose={onClose} title={note.propertyAddress}>
      <div className="p-4 space-y-4 pb-8">
        {/* Ledger-activity banner (Rentec payment detected) */}
        {note.ledgerFlag && (
          <div
            className={`rounded-xl border p-3 ${
              note.ledgerFlag.kind === "returned"
                ? "border-red-300 bg-red-50"
                : "border-blue-300 bg-blue-50"
            }`}
          >
            {note.ledgerFlag.applied ? (
              <p className="text-sm text-foreground">
                ✓ Amount auto-updated to{" "}
                <span className="font-bold">{usdShort(note.ledgerFlag.currentBalance)}</span> (
                {note.ledgerFlag.paymentContext}). Set a new expected date for the remaining{" "}
                {usdShort(note.ledgerFlag.currentBalance)}?
              </p>
            ) : note.ledgerFlag.kind === "returned" ? (
              <p className="text-sm text-red-800 font-medium">
                ⚠️ Payment returned. Rentec balance is now{" "}
                <span className="font-bold">{usdShort(note.ledgerFlag.currentBalance)}</span>.
              </p>
            ) : (
              <p className="text-sm text-blue-900">
                💵 <span className="font-bold">{usdShort(note.ledgerFlag.receivedSince)} received</span>
                {note.ledgerFlag.receivedDate ? ` ${formatShortDate(note.ledgerFlag.receivedDate)}` : ""}
                {note.ledgerFlag.receivedCount > 1 ? ` (${note.ledgerFlag.receivedCount} payments)` : ""}
                . Rentec balance is now{" "}
                <span className="font-bold">{usdShort(note.ledgerFlag.currentBalance)}</span>.
              </p>
            )}
            <div className="flex flex-wrap gap-2 mt-2">
              {note.ledgerFlag.applied ? (
                <button
                  type="button"
                  onClick={startEdit}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white"
                  style={{ backgroundColor: "#B23A2E" }}
                >
                  Set new date
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() =>
                    patchMutation.mutate({
                      expectedPaymentAmount: String(note.ledgerFlag!.currentBalance),
                      auto: true,
                      paymentContext: note.ledgerFlag!.paymentContext,
                      ledgerAckBalance: String(note.ledgerFlag!.currentBalance),
                    })
                  }
                  disabled={patchMutation.isPending}
                  className="rounded-lg px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
                  style={{ backgroundColor: "#B23A2E" }}
                >
                  Update amount to {usdShort(note.ledgerFlag.currentBalance)}
                </button>
              )}
              {!note.ledgerFlag.applied && (
                <button
                  type="button"
                  onClick={startEdit}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold bg-background"
                >
                  Edit
                </button>
              )}
              <button
                type="button"
                onClick={() =>
                  patchMutation.mutate({ ledgerAckBalance: String(note.ledgerFlag!.currentBalance) })
                }
                disabled={patchMutation.isPending}
                className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold bg-background disabled:opacity-50"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Tenant + status + edit */}
        <div className="flex items-center justify-between">
          <p className="text-base font-semibold">{note.tenantName}</p>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${badgeClass}`}>
              {label}
            </span>
            {!editing && (
              <button
                type="button"
                onClick={startEdit}
                className="p-1.5 rounded-full hover:bg-muted text-muted-foreground"
                title="Edit situation"
                aria-label="Edit situation"
              >
                <Pencil className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {editing ? (
          <div className="space-y-3 border border-border rounded-xl p-3">
            <div>
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Situation</label>
              <textarea
                value={eSituation}
                onChange={(e) => setESituation(e.target.value)}
                rows={3}
                className="w-full mt-1 border border-border rounded-lg px-3 py-2 text-sm bg-background resize-none"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Expected Date</label>
                <input
                  type="date"
                  value={eDate}
                  onChange={(e) => setEDate(e.target.value)}
                  className="w-full mt-1 border border-border rounded-lg px-3 py-2 text-sm bg-background"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Amount ($)</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={eAmount}
                  onChange={(e) => setEAmount(e.target.value)}
                  className="w-full mt-1 border border-border rounded-lg px-3 py-2 text-sm bg-background"
                />
              </div>
            </div>
            <div>
              <label className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">Status</label>
              <select
                value={eStatus}
                onChange={(e) => setEStatus(e.target.value as TenantNote["status"])}
                className="w-full mt-1 border border-border rounded-lg px-3 py-2 text-sm bg-background"
              >
                <option value="open">Open</option>
                <option value="missed_promise">Missed Promise</option>
                <option value="resolved">Resolved</option>
              </select>
            </div>
            {patchMutation.isError && (
              <p className="text-xs text-red-600">{(patchMutation.error as Error).message}</p>
            )}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setEditing(false)}
                disabled={patchMutation.isPending}
                className="flex-1 border border-border rounded-lg py-2 text-sm font-semibold bg-background disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() =>
                  patchMutation.mutate({
                    situation: eSituation,
                    expectedPaymentDate: eDate || null,
                    expectedPaymentAmount: eAmount || null,
                    status: eStatus,
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
            {/* Situation */}
            <div className="bg-muted/50 rounded-xl p-3">
              <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-1">
                Situation
              </p>
              <p className="text-sm leading-relaxed">{note.situation}</p>
            </div>

            {/* Expected payment */}
            {(note.expectedPaymentDate || note.expectedPaymentAmount) && (
              <div className="flex gap-6">
                {note.expectedPaymentDate && (
                  <div>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">
                      Expected Date
                    </p>
                    <p className="text-sm font-semibold mt-0.5">
                      {formatShortDate(note.expectedPaymentDate)}
                    </p>
                  </div>
                )}
                {note.expectedPaymentAmount && (
                  <div>
                    <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide">
                      Amount
                    </p>
                    <p className="text-sm font-semibold mt-0.5">
                      ${Number(note.expectedPaymentAmount).toLocaleString()}
                    </p>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* Reminder history */}
        {note.comments.some((c) => c.comment === REMINDER_COMMENT) && (
          <div>
            <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-2">
              Reminders Sent
            </p>
            <div className="space-y-1.5">
              {note.comments
                .filter((c) => c.comment === REMINDER_COMMENT)
                .slice()
                .reverse()
                .map((c) => (
                  <div key={c.id} className="flex items-center gap-2 text-xs">
                    <MessageSquare className="w-3.5 h-3.5 text-green-600 shrink-0" />
                    <span className="text-foreground">
                      {new Date(c.createdAt).toLocaleString("en-US", {
                        month: "short",
                        day: "numeric",
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                    </span>
                    <span className="text-muted-foreground">
                      · {AUTHOR_NAMES[c.author] ?? c.author}
                    </span>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* Send Reminder Text */}
        {note.status !== "resolved" && onRemind && (
          <button
            type="button"
            onClick={() => onRemind(note)}
            disabled={!note.tenantPhone}
            title={note.tenantPhone ? "Send reminder text" : "No phone on file"}
            className="w-full flex items-center justify-center gap-2 rounded-xl py-3 text-sm font-semibold text-white disabled:opacity-40"
            style={{ backgroundColor: "#B23A2E" }}
          >
            <MessageSquare className="w-4 h-4" />
            {note.tenantPhone ? "Send Reminder Text" : "Send Reminder Text — no phone on file"}
          </button>
        )}

        {/* Comments */}
        <div>
          <p className="text-[10px] font-bold text-muted-foreground uppercase tracking-wide mb-2">
            Comments
          </p>
          {visibleComments.length === 0 ? (
            <p className="text-xs text-muted-foreground italic">No comments yet</p>
          ) : (
            <div className="space-y-2 mb-3">
              {visibleComments.map((c) =>
                c.kind === "system" ? (
                  // System/audit entry — distinct, no avatar, gray italic.
                  <p key={c.id} className="text-xs text-muted-foreground italic px-1">
                    {c.comment} —{" "}
                    {new Date(c.createdAt).toLocaleString("en-US", {
                      month: "short",
                      day: "numeric",
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </p>
                ) : (
                  <div key={c.id} className="bg-muted/40 rounded-xl px-3 py-2">
                    <p className="text-[10px] font-bold text-muted-foreground">
                      {AUTHOR_NAMES[c.author] ?? c.author} ·{" "}
                      {formatDistanceToNow(new Date(c.createdAt), { addSuffix: true })}
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

        {/* Jacob-only actions — all kept inside ONE sticky bar so every button
            (incl. Mark Delinquent / Begin Eviction) is visible above the nav. */}
        {isJacob && (
          <SheetButtonRow border className="-mx-4 px-4">
            <div className="flex flex-col gap-2 w-full">
              <div className="flex gap-3">
                {note.status === "missed_promise" && (
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
                  onClick={() => {
                    if (confirm("Delete this note?")) deleteMutation.mutate();
                  }}
                  disabled={deleteMutation.isPending}
                  className="border border-border rounded-xl px-3 py-2.5 text-muted-foreground disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={markDelinquent.isPending}
                  onClick={() => markDelinquent.mutate()}
                  className="flex items-center justify-center gap-1.5 border border-amber-300 text-amber-700 rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50"
                >
                  <AlertTriangle className="w-4 h-4" /> {markDelinquent.isPending ? "Marking…" : "Mark Delinquent"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    sessionStorage.setItem("nch_eviction_prefill", JSON.stringify({
                      propertyAddress: note.propertyAddress,
                      tenantName: note.tenantName,
                      doorloopLeaseId: note.doorloopLeaseId ?? "",
                    }));
                    setLocation("/evictions");
                  }}
                  className="flex items-center justify-center gap-1.5 border border-[#B23A2E]/40 text-[#B23A2E] rounded-xl py-2.5 text-sm font-semibold"
                >
                  <Scale className="w-4 h-4" /> Begin Eviction
                </button>
              </div>
            </div>
          </SheetButtonRow>
        )}
      </div>
    </BottomSheet>
  );
}

// ── Compact list row ───────────────────────────────────────────────────────────

/** "2600 Daleford Ave NE, Canton, OH 44705" → "2600 Daleford" */
function shortAddress(address: string): string {
  const parts = address.trim().split(/\s+/);
  return [parts[0], parts[1]].filter(Boolean).join(" ");
}

/** "Michael Baker" / "Cadyn D & Crystal S" → "Michael B." */
function shortName(fullName: string): string {
  const parts = (fullName ?? "").trim().split(/\s+/);
  const first = parts[0] ?? "";
  const last = parts[1];
  return last ? `${first} ${last[0]}.` : first;
}

/** ISO yyyy-mm-dd → "Jun 12" (parsed by parts to avoid TZ drift). */
function shortDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return "";
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
  });
}

/** Whole days the expected date is past today (>=0). */
function daysLate(iso: string | null | undefined): number {
  if (!iso) return 0;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return 0;
  const due = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.max(0, Math.round((today.getTime() - due.getTime()) / 86_400_000));
}

function money(v: string | null | undefined): string {
  if (v == null || v === "") return "";
  const n = Number(v);
  if (!Number.isFinite(n)) return "";
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

const ROW_DOT: Record<string, string> = {
  open: "bg-yellow-400",
  missed_promise: "bg-red-500",
  resolved: "bg-green-500",
};

/**
 * A situation whose expected payment lands in a FUTURE month (next month or
 * later) — an upcoming expected payment, not a current-month collection. These
 * are grouped and tinted green so they read as future, not actionable now.
 */
function isUpcomingSituation(note: TenantNote): boolean {
  if (note.status !== "open" || !note.expectedPaymentDate) return false;
  const now = new Date();
  const curYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return note.expectedPaymentDate.slice(0, 7) > curYm;
}

/** mm/dd from a Date. */
function mdShort(d: Date): string {
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

function CompactRow({
  note,
  onTap,
  onRemind,
}: {
  note: TenantNote;
  onTap: () => void;
  onRemind?: (note: TenantNote) => void;
}) {
  const resolved = note.status === "resolved";
  const missed = note.status === "missed_promise";
  const upcoming = isUpcomingSituation(note);

  let dateText: string;
  let dateClass: string;
  if (missed) {
    dateText = `${daysLate(note.expectedPaymentDate)}d late`;
    dateClass = "text-red-600 font-semibold";
  } else if (note.expectedPaymentDate) {
    dateText = shortDate(note.expectedPaymentDate);
    dateClass = "text-foreground";
  } else {
    dateText = "No date";
    dateClass = "text-muted-foreground";
  }

  const reminded = lastReminderAt(note);
  const hasPhone = !!note.tenantPhone;
  const d = daysUntilExpected(note.expectedPaymentDate);
  // Highlight today, dim one day before, otherwise available-but-quiet.
  const remindClass = !hasPhone
    ? "text-muted-foreground/40"
    : d === 0
      ? "bg-primary text-primary-foreground"
      : d === 1
        ? "bg-primary/15 text-primary"
        : "text-muted-foreground";

  return (
    <div className={`w-full flex items-center gap-2 ${resolved ? "opacity-60" : ""}`}>
      <button
        type="button"
        onClick={onTap}
        className="flex items-center gap-2 py-2.5 text-left flex-1 min-w-0"
      >
        <span className={`w-2 h-2 rounded-full shrink-0 ${upcoming ? "bg-green-500" : ROW_DOT[note.status] ?? "bg-gray-400"}`} />
        <span className={`text-xs tabular-nums w-16 shrink-0 ${dateClass}`}>{dateText}</span>
        <span className="text-sm font-medium truncate flex-1 min-w-0">
          {shortAddress(note.propertyAddress)}
        </span>
        <span className="text-xs text-muted-foreground truncate w-16 shrink-0">
          {shortName(note.tenantName)}
        </span>
        {note.ledgerFlag ? (
          <span className="flex items-center gap-1 text-xs font-semibold tabular-nums shrink-0">
            <span
              className={`w-1.5 h-1.5 rounded-full ${note.ledgerFlag.kind === "returned" ? "bg-red-500" : "bg-blue-500"}`}
            />
            <span className="text-muted-foreground line-through">
              {money(note.expectedPaymentAmount)}
            </span>
            <span className={note.ledgerFlag.kind === "returned" ? "text-red-600" : "text-blue-600"}>
              {usdShort(note.ledgerFlag.currentBalance)}
            </span>
          </span>
        ) : (
          <span className="text-sm font-semibold tabular-nums shrink-0 text-right">
            {money(note.expectedPaymentAmount)}
          </span>
        )}
      </button>

      {reminded && (
        <span className="text-[10px] font-medium text-green-600 shrink-0" title="Reminder sent">
          ✓ {mdShort(reminded)}
        </span>
      )}

      {!resolved && onRemind && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onRemind(note); }}
          disabled={!hasPhone}
          title={hasPhone ? "Send reminder text" : "No phone on file"}
          className={`shrink-0 rounded-full p-1.5 ${remindClass}`}
          aria-label="Send reminder"
        >
          <MessageSquare className="w-3.5 h-3.5" />
        </button>
      )}

      <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
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

  const remindMutation = useMutation({
    mutationFn: (id: number) => sendReminderLog(id),
    onSuccess: invalidate,
  });

  // Open iOS Messages with the reminder, then log it (same pattern as the
  // Awaiting Communication checklist — log on tap, can't confirm delivery).
  const handleRemind = (note: TenantNote) => {
    if (!note.tenantPhone) {
      toast.error("No phone on file");
      return;
    }
    const msg = note.reminderMessage ?? "";
    window.location.href = `sms:${note.tenantPhone}&body=${encodeURIComponent(msg)}`;
    remindMutation.mutate(note.id);
    toast.success("Reminder logged");
  };

  // Sort: missed promises first (most overdue first), then open with a date
  // (soonest first), then open with no date, then resolved (collapsed).
  const missedNotes = notes
    .filter((n) => n.status === "missed_promise")
    .sort((a, b) => daysLate(b.expectedPaymentDate) - daysLate(a.expectedPaymentDate));
  const openDated = notes
    .filter((n) => n.status === "open" && n.expectedPaymentDate)
    .sort((a, b) => (a.expectedPaymentDate ?? "").localeCompare(b.expectedPaymentDate ?? ""));
  // Future-month situations are split off into their own green "Upcoming" group.
  const upcomingDated = openDated.filter(isUpcomingSituation);
  const currentDated = openDated.filter((n) => !isUpcomingSituation(n));
  const openNoDate = notes.filter((n) => n.status === "open" && !n.expectedPaymentDate);
  const resolvedNotes = notes
    .filter((n) => n.status === "resolved")
    .sort((a, b) => (b.resolvedAt ?? "").localeCompare(a.resolvedAt ?? ""));

  const currentRows = [...missedNotes, ...currentDated, ...openNoDate];
  const upcomingRows = upcomingDated;
  const openCount = currentRows.length + upcomingRows.length;
  const hasNotes = notes.length > 0;

  if (!hasNotes && !isJacob) return null;

  return (
    <div className="border-t border-border pt-3">
      <div className="flex items-center justify-between px-0.5 mb-1">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold">Payment Situations</h3>
          {openCount > 0 && (
            <span className="text-[10px] font-bold text-white bg-red-500 rounded-full px-1.5 py-0.5 min-w-[18px] text-center">
              {openCount}
            </span>
          )}
        </div>
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

      {openCount === 0 && resolvedNotes.length === 0 ? (
        <p className="text-sm text-muted-foreground px-0.5 py-1">No active payment situations</p>
      ) : (
        <div>
          {currentRows.length > 0 && (
            <div className="divide-y divide-border">
              {currentRows.map((n) => (
                <CompactRow
                  key={n.id}
                  note={n}
                  onTap={() => setSelectedNoteId(n.id)}
                  onRemind={handleRemind}
                />
              ))}
            </div>
          )}

          {upcomingRows.length > 0 && (
            <div className="pt-1">
              <div className="flex items-center gap-1.5 py-2 px-0.5">
                <span className="w-2 h-2 rounded-full bg-green-500 shrink-0" />
                <span className="text-xs font-semibold text-green-700">Upcoming · next month</span>
              </div>
              <div className="divide-y divide-border">
                {upcomingRows.map((n) => (
                  <CompactRow
                    key={n.id}
                    note={n}
                    onTap={() => setSelectedNoteId(n.id)}
                    onRemind={handleRemind}
                  />
                ))}
              </div>
            </div>
          )}

          {openCount === 0 && (
            <p className="text-sm text-muted-foreground px-0.5 py-2">No active payment situations</p>
          )}

          {resolvedNotes.length > 0 && (
            <div className="pt-1">
              <button
                type="button"
                onClick={() => setResolvedExpanded((v) => !v)}
                className="flex items-center gap-1 text-xs font-medium text-muted-foreground py-2 px-0.5"
              >
                <ChevronRight
                  className={`w-3 h-3 transition-transform ${resolvedExpanded ? "rotate-90" : ""}`}
                />
                Resolved ({resolvedNotes.length})
              </button>
              {resolvedExpanded && (
                <div className="divide-y divide-border">
                  {resolvedNotes.map((n) => (
                    <CompactRow key={n.id} note={n} onTap={() => setSelectedNoteId(n.id)} />
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
        onRemind={handleRemind}
      />
    </div>
  );
}
