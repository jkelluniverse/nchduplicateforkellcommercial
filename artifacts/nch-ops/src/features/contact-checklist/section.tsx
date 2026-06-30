import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/lib/auth";
import { MessageSquare, Check, Plus, History, TriangleAlert as AlertTriangle, X } from "lucide-react";
import {
  fetchChecklist,
  fetchHistory,
  markContacted,
  createPaymentSituation,
  contactKeys,
  fmtMoney,
  type ChecklistItem,
  type ContactLog,
} from "./api";
import { AddNoteSheet, tenantNoteKeys } from "@/features/rent-status/payment-notes";

/** Format a contact-log timestamp as e.g. "Jun 8". */
function fmtShort(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const CONTACT_METHODS = ["Call", "Text", "In Person", "Voicemail", "Other"] as const;

// ── Lightweight bottom-sheet / dialog ─────────────────────────────────────────

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

// ── "Did you send the message?" confirm ───────────────────────────────────────

function SmsConfirm({
  item,
  onNotYet,
  onSent,
  pending,
}: {
  item: ChecklistItem;
  onNotYet: () => void;
  onSent: () => void;
  pending: boolean;
}) {
  return (
    <Overlay onClose={onNotYet}>
      <div className="p-5">
        <h3 className="text-base font-bold">Did you send the message?</h3>
        <p className="text-sm text-muted-foreground mt-1">
          {item.tenant_name ?? item.property_address}
        </p>
        <div className="flex gap-3 mt-5">
          <button
            type="button"
            onClick={onNotYet}
            disabled={pending}
            className="flex-1 border border-border rounded-xl py-3 text-sm font-semibold bg-background text-foreground disabled:opacity-50"
          >
            Not yet
          </button>
          <button
            type="button"
            onClick={onSent}
            disabled={pending}
            className="flex-1 rounded-xl py-3 text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: "#16a34a" }}
          >
            {pending ? "Saving…" : "Yes, sent ✓"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

// ── "How did you reach out?" sheet ────────────────────────────────────────────

function ContactedSheet({
  item,
  onCancel,
  onConfirm,
  pending,
}: {
  item: ChecklistItem;
  onCancel: () => void;
  onConfirm: (method: string | undefined, notes: string | undefined) => void;
  pending: boolean;
}) {
  const [method, setMethod] = useState<string>("");
  const [notes, setNotes] = useState("");

  return (
    <Overlay onClose={onCancel}>
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-border">
        <h3 className="text-base font-bold truncate pr-4">{item.property_address}</h3>
        <button type="button" onClick={onCancel} className="p-1 rounded-full hover:bg-muted">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="p-4 space-y-4">
        <div>
          <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
            How did you reach out? (optional)
          </label>
          <div className="flex flex-wrap gap-2 mt-2">
            {CONTACT_METHODS.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMethod((cur) => (cur === m ? "" : m))}
                className={`px-3 py-1.5 rounded-full text-sm font-medium border ${
                  method === m
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-foreground bg-background"
                }`}
              >
                {m}
              </button>
            ))}
          </div>
          <p className="text-[11px] text-muted-foreground mt-2">
            {/^(text|sms)$/i.test(method)
              ? "🔵 Text keeps this property on the list as “Awaiting reply” until they respond."
              : "Call, In Person, Voicemail & Other mark it done and remove it from the list."}
          </p>
        </div>
        <div>
          <label className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide">
            Notes (optional)
          </label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            className="w-full mt-1 border border-border rounded-lg px-3 py-2.5 text-sm bg-background resize-none"
            placeholder="Anything worth noting…"
          />
        </div>
        <div className="flex gap-3 pt-1">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="flex-1 border border-border rounded-xl py-3 text-sm font-semibold bg-background disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onConfirm(method || undefined, notes.trim() || undefined)}
            disabled={pending}
            className="flex-1 rounded-xl py-3 text-sm font-semibold text-white disabled:opacity-50"
            style={{ backgroundColor: "#B23A2E" }}
          >
            {pending ? "Saving…" : "Confirm"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

// ── History modal ─────────────────────────────────────────────────────────────

const MONTH_LABEL = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

function fmtTs(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function HistoryModal({ onClose }: { onClose: () => void }) {
  const { data: logs = [], isLoading } = useQuery<ContactLog[]>({
    queryKey: contactKeys.history(),
    queryFn: fetchHistory,
  });

  // Group by year-month for readable section headers.
  const groups = new Map<string, ContactLog[]>();
  for (const l of logs) {
    const key = `${l.year}-${String(l.month).padStart(2, "0")}`;
    const arr = groups.get(key) ?? [];
    arr.push(l);
    groups.set(key, arr);
  }

  return (
    <Overlay onClose={onClose}>
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-border shrink-0">
        <h3 className="text-base font-bold">Communication History</h3>
        <button type="button" onClick={onClose} className="p-1 rounded-full hover:bg-muted">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="overflow-y-auto p-4 space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : logs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No contact history yet.</p>
        ) : (
          [...groups.entries()].map(([key, rows]) => {
            const [y, m] = key.split("-");
            return (
              <div key={key}>
                <p className="text-[11px] font-bold text-muted-foreground uppercase tracking-wide mb-2">
                  {MONTH_LABEL[parseInt(m, 10) - 1]} {y}
                </p>
                <div className="space-y-2">
                  {rows.map((l) => (
                    <div key={l.id} className="border border-border rounded-lg p-3">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-sm font-semibold truncate">{l.propertyAddress}</p>
                        <span className="text-xs text-muted-foreground shrink-0">
                          {fmtTs(l.contactedAt)}
                        </span>
                      </div>
                      {l.tenantName && (
                        <p className="text-xs text-muted-foreground">{l.tenantName}</p>
                      )}
                      <p className="text-xs text-foreground mt-1">
                        {l.smsSentAt ? "💬 Text sent" : l.contactMethod ? `Via ${l.contactMethod}` : "Contacted"}
                      </p>
                      {l.notes && <p className="text-xs text-muted-foreground mt-1 italic">{l.notes}</p>}
                    </div>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </Overlay>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────────

function ChecklistRow({
  item,
  onSendText,
  onContacted,
  onAddSituation,
}: {
  item: ChecklistItem;
  onSendText: (item: ChecklistItem) => void;
  onContacted: (item: ChecklistItem) => void;
  onAddSituation: (item: ChecklistItem) => void;
}) {
  const returned = item.returned_payment;
  return (
    <div
      className={`border border-border border-l-4 rounded-xl p-3 ${
        returned ? "border-l-amber-500 bg-amber-50" : "border-l-[#B23A2E]"
      }`}
    >
      <div className="flex items-start gap-2">
        {returned ? (
          <span aria-hidden className="text-sm leading-none mt-0.5 shrink-0">🔄</span>
        ) : (
          <span className="w-2 h-2 rounded-full mt-1.5 shrink-0 bg-[#B23A2E]" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{item.property_address}</p>
          {returned ? (
            <>
              <p className="text-xs text-amber-800 mt-0.5 truncate">
                {item.tenant_name ?? "Unknown tenant"} · {fmtMoney(item.balance_due)} · Payment
                returned {fmtShort(item.returned_date)}
              </p>
              <p className="text-[11px] text-amber-700">
                Paid {fmtShort(item.returned_original_date)} → Returned {fmtShort(item.returned_date)}
              </p>
            </>
          ) : (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {item.tenant_name ?? "Unknown tenant"} · {fmtMoney(item.monthly_rent)} ·{" "}
              {item.days_unpaid}d unpaid
            </p>
          )}
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 mt-3">
        <button
          type="button"
          onClick={() => onSendText(item)}
          disabled={!item.tenant_phone}
          className="flex items-center justify-center gap-1 rounded-lg py-2 text-xs font-semibold text-white disabled:opacity-40"
          style={{ backgroundColor: "#B23A2E" }}
          title={item.tenant_phone ? "Send a follow-up text" : "No phone number on file"}
        >
          <MessageSquare className="w-3.5 h-3.5" /> Send Text
        </button>
        <button
          type="button"
          onClick={() => onContacted(item)}
          className="flex items-center justify-center gap-1 rounded-lg py-2 text-xs font-semibold border border-border bg-background"
        >
          <Check className="w-3.5 h-3.5" /> Contacted
        </button>
        <button
          type="button"
          onClick={() => onAddSituation(item)}
          className="flex items-center justify-center gap-1 rounded-lg py-2 text-xs font-semibold border border-border bg-background"
        >
          <Plus className="w-3.5 h-3.5" /> Sit
        </button>
      </div>
    </div>
  );
}

// ── "Got Response" sheet ──────────────────────────────────────────────────────

function GotResponseSheet({
  item,
  onCancel,
  onSave,
  pending,
}: {
  item: ChecklistItem;
  onCancel: () => void;
  onSave: (response: string) => void;
  pending: boolean;
}) {
  const [text, setText] = useState("");
  return (
    <Overlay onClose={onCancel}>
      <div className="flex items-center justify-between px-4 pt-4 pb-3 border-b border-border">
        <h3 className="text-base font-bold truncate pr-4">What did they say?</h3>
        <button type="button" onClick={onCancel} className="p-1 rounded-full hover:bg-muted">
          <X className="w-5 h-5" />
        </button>
      </div>
      <div className="p-4 space-y-4">
        <p className="text-xs text-muted-foreground">
          {item.tenant_name ?? item.property_address}
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          autoFocus
          className="w-full border border-border rounded-lg px-3 py-2.5 text-sm bg-background resize-none"
          placeholder="What was the response?"
        />
        <div className="flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={pending}
            className="flex-1 border border-border rounded-xl py-3 text-sm font-semibold bg-background disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSave(text.trim())}
            disabled={pending || !text.trim()}
            className="flex-1 rounded-xl py-3 text-sm font-semibold text-white disabled:opacity-40"
            style={{ backgroundColor: "#B23A2E" }}
          >
            {pending ? "Saving…" : "Save as Payment Situation"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

// ── Awaiting-reply row (blue) ─────────────────────────────────────────────────

function AwaitingRow({
  item,
  onAddSituation,
  onGotResponse,
}: {
  item: ChecklistItem;
  onAddSituation: (item: ChecklistItem) => void;
  onGotResponse: (item: ChecklistItem) => void;
}) {
  const sentAt = fmtShort(item.contact_log?.smsSentAt ?? item.contact_log?.contactedAt);
  return (
    <div className="border border-border border-l-4 border-l-blue-500 rounded-xl p-3">
      <div className="flex items-start gap-2">
        <span className="w-2 h-2 rounded-full mt-1.5 shrink-0 bg-blue-500" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold truncate">{item.property_address}</p>
          <p className="text-xs text-muted-foreground mt-0.5 truncate">
            {item.tenant_name ?? "Unknown tenant"} · {fmtMoney(item.monthly_rent)} ·{" "}
            {item.days_unpaid}d unpaid
          </p>
          <p className="text-xs font-medium text-blue-700 mt-1">
            ✉️ Text sent{sentAt ? ` ${sentAt}` : ""} · Awaiting reply
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 mt-3">
        <button
          type="button"
          onClick={() => onAddSituation(item)}
          className="flex items-center justify-center gap-1 rounded-lg py-2 text-xs font-semibold text-white"
          style={{ backgroundColor: "#B23A2E" }}
        >
          <Plus className="w-3.5 h-3.5" /> Add Situation
        </button>
        <button
          type="button"
          onClick={() => onGotResponse(item)}
          className="flex items-center justify-center gap-1 rounded-lg py-2 text-xs font-semibold border border-border bg-background"
        >
          <Check className="w-3.5 h-3.5" /> Got Response
        </button>
      </div>
    </div>
  );
}

// ── Section header (title + red/blue counts + history link) ───────────────────

function SectionHeader({
  needs,
  awaiting,
  onHistory,
}: {
  needs: number;
  awaiting: number;
  onHistory: () => void;
}) {
  return (
    <>
      <div className="flex items-center justify-between px-0.5">
        <div className="flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4 text-[#B23A2E]" />
          <h3 className="text-sm font-bold">Awaiting Communication</h3>
        </div>
        <button
          type="button"
          onClick={onHistory}
          className="text-xs font-medium text-primary flex items-center gap-1"
        >
          <History className="w-3 h-3" />
          Prior Months
        </button>
      </div>
      <p className="text-[11px] text-muted-foreground px-0.5 mb-2">
        Unpaid tenants with no status update this month
      </p>
      {(needs > 0 || awaiting > 0) && (
        <p className="text-xs font-semibold px-0.5 mb-2 flex items-center gap-2 flex-wrap">
          {needs > 0 && (
            <span className="inline-flex items-center gap-1 text-[#B23A2E]">
              <span className="w-2 h-2 rounded-full bg-[#B23A2E]" />
              {needs} need contact
            </span>
          )}
          {needs > 0 && awaiting > 0 && <span className="text-muted-foreground">·</span>}
          {awaiting > 0 && (
            <span className="inline-flex items-center gap-1 text-blue-600">
              <span className="w-2 h-2 rounded-full bg-blue-500" />
              {awaiting} awaiting reply
            </span>
          )}
        </p>
      )}
    </>
  );
}

// ── Main section ──────────────────────────────────────────────────────────────

export function AwaitingCommunicationSection() {
  const { user } = useAuth();
  const isJacob = user?.role === "jacob";
  const qc = useQueryClient();

  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const { data } = useQuery({
    queryKey: contactKeys.list(month, year),
    queryFn: () => fetchChecklist(month, year),
    enabled: isJacob,
    refetchInterval: 5 * 60 * 1000,
  });

  const [smsPrompt, setSmsPrompt] = useState<ChecklistItem | null>(null);
  const [contactSheet, setContactSheet] = useState<ChecklistItem | null>(null);
  const [sitItem, setSitItem] = useState<ChecklistItem | null>(null);
  const [gotResponseItem, setGotResponseItem] = useState<ChecklistItem | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: contactKeys.list(month, year) });
    void qc.invalidateQueries({ queryKey: contactKeys.history() });
    void qc.invalidateQueries({ queryKey: tenantNoteKeys.all });
  };

  const mark = useMutation({
    mutationFn: markContacted,
    onSuccess: () => {
      invalidate();
      setSmsPrompt(null);
      setContactSheet(null);
    },
  });

  const saveResponse = useMutation({
    mutationFn: (vars: { item: ChecklistItem; response: string }) =>
      createPaymentSituation({
        propertyAddress: vars.item.property_address,
        tenantName: vars.item.tenant_name ?? vars.item.property_address,
        situation: vars.response,
        doorloopLeaseId: vars.item.doorloop_lease_id ?? undefined,
        expectedPaymentAmount: String(vars.item.balance_due),
      }),
    onSuccess: () => {
      invalidate();
      setGotResponseItem(null);
    },
  });

  // Hooks above; gating below.
  if (!isJacob) return null;
  if (!data || !data.active) return null; // dormant before the 6th
  const items = data.items;
  if (items.length === 0) return null; // no unpaid properties at all

  const needs = items.filter((i) => i.needs_followup);
  const awaiting = items.filter((i) => i.awaiting_reply);
  if (needs.length === 0 && awaiting.length === 0) {
    // Every unpaid property has been handled this month.
    return (
      <div className="border-t border-border pt-3" id="awaiting-communication">
        <SectionHeader needs={0} awaiting={0} onHistory={() => setHistoryOpen(true)} />
        <p className="text-sm font-semibold text-green-600 px-0.5 py-2">
          ✅ All unpaid tenants contacted this month
        </p>
        {historyOpen && <HistoryModal onClose={() => setHistoryOpen(false)} />}
      </div>
    );
  }

  const handleSendText = (item: ChecklistItem) => {
    if (item.tenant_phone) {
      // iOS Messages deep-link: pre-populates the number and the message body.
      const smsUri = `sms:${item.tenant_phone}&body=${encodeURIComponent(item.sms_message)}`;
      window.location.href = smsUri;
    }
    setSmsPrompt(item);
  };

  return (
    <div className="border-t border-border pt-3" id="awaiting-communication">
      <SectionHeader
        needs={needs.length}
        awaiting={awaiting.length}
        onHistory={() => setHistoryOpen(true)}
      />

      <div className="space-y-2">
        {needs.map((item) => (
          <ChecklistRow
            key={item.property_address}
            item={item}
            onSendText={handleSendText}
            onContacted={setContactSheet}
            onAddSituation={setSitItem}
          />
        ))}
        {awaiting.map((item) => (
          <AwaitingRow
            key={item.property_address}
            item={item}
            onAddSituation={setSitItem}
            onGotResponse={setGotResponseItem}
          />
        ))}
      </div>

      {gotResponseItem && (
        <GotResponseSheet
          item={gotResponseItem}
          pending={saveResponse.isPending}
          onCancel={() => setGotResponseItem(null)}
          onSave={(response) => saveResponse.mutate({ item: gotResponseItem, response })}
        />
      )}

      {smsPrompt && (
        <SmsConfirm
          item={smsPrompt}
          pending={mark.isPending}
          onNotYet={() => setSmsPrompt(null)}
          onSent={() =>
            mark.mutate({
              property_address: smsPrompt.property_address,
              tenant_name: smsPrompt.tenant_name ?? undefined,
              doorloop_lease_id: smsPrompt.doorloop_lease_id ?? undefined,
              sms_sent: true,
            })
          }
        />
      )}

      {contactSheet && (
        <ContactedSheet
          item={contactSheet}
          pending={mark.isPending}
          onCancel={() => setContactSheet(null)}
          onConfirm={(methodVal, notesVal) =>
            mark.mutate({
              property_address: contactSheet.property_address,
              tenant_name: contactSheet.tenant_name ?? undefined,
              doorloop_lease_id: contactSheet.doorloop_lease_id ?? undefined,
              contact_method: methodVal,
              notes: notesVal,
            })
          }
        />
      )}

      <AddNoteSheet
        open={sitItem !== null}
        onOpenChange={(v) => { if (!v) setSitItem(null); }}
        initialAddress={sitItem?.property_address}
        initialTenantName={sitItem?.tenant_name ?? ""}
        initialLeaseId={sitItem?.doorloop_lease_id ?? ""}
        initialAmount={sitItem ? String(sitItem.balance_due) : undefined}
        onSaved={() => {
          invalidate();
          void qc.invalidateQueries({ queryKey: tenantNoteKeys.all });
          setSitItem(null);
        }}
      />

      {historyOpen && <HistoryModal onClose={() => setHistoryOpen(false)} />}
    </div>
  );
}
