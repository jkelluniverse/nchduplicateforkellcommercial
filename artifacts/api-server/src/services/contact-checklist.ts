/**
 * Monthly Communication Checklist — tracks which unpaid tenants Jacob has
 * reached out to this month about their payment status, and supplies a
 * pre-written follow-up SMS for each one.
 *
 * Source of truth is live Rentec (unpaid/delinquent leases + tenant phone),
 * cross-referenced with two local tables that mark a property "communicated":
 *   - monthly_contact_log    (an explicit "I contacted them" entry)
 *   - tenant_payment_notes   (a payment situation logged this month)
 *
 * Read-only against Rentec (GET only); only the local contact log is written,
 * and only via the route handlers.
 *
 * DoorLoop → Rentec mapping: the reference resolved unpaid leases + tenant phone
 * + outstanding balance from DoorLoop. Here `rentec.getRentStatus` supplies the
 * unpaid set, `rentec.getLeases` supplies the authoritative outstanding balance
 * (Rentec lease balance), and `selectPrimaryLeaseTenant` over `rentec.getTenants`
 * supplies the resident phone. Rentec does not surface returned/NSF payments in
 * the rent-status snapshot, so returned-payment fields are always absent here.
 */
import { and, eq, gte, lt } from "drizzle-orm";
import {
  db,
  monthlyContactLogTable,
  tenantPaymentNotesTable,
  tenantNoteCommentsTable,
  type MonthlyContactLog,
  type TenantPaymentNote,
} from "@workspace/db";
import {
  getRentStatus,
  getLeases,
  getTenants,
  buildLeaseTenantLookup,
  selectPrimaryLeaseTenant,
  hasApiKey,
} from "./rentec";
import { getOverrideMap } from "./rent-overrides";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** The pre-written follow-up text Jacob sends to an unpaid tenant. */
export function generateSmsMessage(tenantFirstName: string, month: string): string {
  return `Hey ${tenantFirstName}, just checking in on ${month} rent — when can I expect payment? Please let me know so I can note it down. Thanks, Jacob`;
}

/** The pre-written text for a returned/bounced payment (different framing). */
export function generateReturnedPaymentSms(firstName: string, amount: string): string {
  return `Hey ${firstName}, your recent payment of ${amount} was returned by your bank. Please reach out so we can get this resolved. Thanks, Jacob`;
}

function usd(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

/** First name = everything before the first space (for SMS personalization). */
export function firstNameOf(full: string | null | undefined): string {
  const trimmed = (full ?? "").trim();
  if (!trimmed) return "there";
  return trimmed.split(/\s+/)[0] || "there";
}

export interface ContactChecklistItem {
  property_address: string;
  tenant_name: string | null;
  tenant_first_name: string;
  tenant_phone: string | null;
  monthly_rent: number;
  balance_due: number;
  days_unpaid: number;
  has_payment_situation: boolean;
  has_contact_log: boolean;
  needs_followup: boolean;
  awaiting_reply: boolean;
  returned_payment: boolean;
  returned_date: string | null;
  returned_original_amount: number | null;
  returned_original_date: string | null;
  doorloop_lease_id: string | null;
  contact_log: MonthlyContactLog | null;
  payment_situation: TenantPaymentNote | null;
  sms_message: string;
}

/**
 * Build the checklist of unpaid/delinquent properties for the given month with
 * each property's communication status. No date gating here — callers (the GET
 * route and the daily reminder) decide whether to surface it.
 */
export async function getContactChecklist(
  month: number,
  year: number,
): Promise<ContactChecklistItem[]> {
  if (!hasApiKey()) return [];

  const snap = await getRentStatus(month, year);
  if (!snap) return [];

  // Unpaid and delinquent properties belong on the follow-up checklist — but
  // never one that's been manually resolved (override). Rentec's rent-status
  // snapshot has no returned-payment status, so that bucket never appears here.
  const overrides = await getOverrideMap(month, year);
  const unpaidRows = snap.rows.filter(
    (r) =>
      (r.status === "unpaid" || r.status === "delinquent") &&
      !overrides.has(r.address),
  );
  if (unpaidRows.length === 0) return [];

  // Tenant phone + outstanding balance come from Rentec: resolve the current
  // resident per lease and read the authoritative Rentec lease balance.
  const [leases, tenants] = await Promise.all([getLeases(), getTenants()]);
  const leaseById = new Map(leases.map((l) => [l.id, l]));
  const tenantByPropertyUnit = buildLeaseTenantLookup(tenants);
  const tenantById = new Map(tenants.map((t) => [t.id, t]));

  const monthName = MONTH_NAMES[month - 1] ?? "this month";

  // Communication signals for THIS month.
  const logs = await db
    .select()
    .from(monthlyContactLogTable)
    .where(and(eq(monthlyContactLogTable.month, month), eq(monthlyContactLogTable.year, year)));
  const logByAddress = new Map(logs.map((l) => [l.propertyAddress, l]));

  // A property counts as "communicated via situation" when a payment situation
  // saw any activity this month: created, resolved, or commented on. Each of
  // these means Jacob has the tenant's status, so the property leaves the list.
  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 1);
  const allNotes = await db.select().from(tenantPaymentNotesTable);
  const inMonth = (d: Date | null | undefined): boolean =>
    !!d && d >= monthStart && d < monthEnd;

  const noteIdToAddress = new Map<number, string>();
  for (const note of allNotes) noteIdToAddress.set(note.id, note.propertyAddress);

  const comments = await db
    .select()
    .from(tenantNoteCommentsTable)
    .where(
      and(
        gte(tenantNoteCommentsTable.createdAt, monthStart),
        lt(tenantNoteCommentsTable.createdAt, monthEnd),
      ),
    );
  const commentedAddresses = new Set<string>();
  for (const c of comments) {
    const addr = noteIdToAddress.get(c.noteId);
    if (addr) commentedAddresses.add(addr);
  }

  // Per-address situation signals + a representative note for the response.
  const situationByAddress = new Map<
    string,
    { communicated: boolean; createdThisMonth: boolean; note: TenantPaymentNote }
  >();
  for (const note of allNotes) {
    const createdThisMonth = inMonth(note.createdAt);
    const resolvedThisMonth = inMonth(note.resolvedAt);
    const commentedThisMonth = commentedAddresses.has(note.propertyAddress);
    const communicated = createdThisMonth || resolvedThisMonth || commentedThisMonth;
    if (!communicated) continue;
    const existing = situationByAddress.get(note.propertyAddress);
    // Prefer a situation actually created this month as the representative note.
    if (!existing || (createdThisMonth && !existing.createdThisMonth)) {
      situationByAddress.set(note.propertyAddress, { communicated, createdThisMonth, note });
    }
  }

  const items: ContactChecklistItem[] = unpaidRows.map((r) => {
    const lease = r.leaseId ? leaseById.get(r.leaseId) : undefined;
    let phone: string | null = null;
    if (lease) {
      const byRenter = lease.renterId ? tenantById.get(lease.renterId) : undefined;
      const t = byRenter ?? selectPrimaryLeaseTenant(lease, tenantByPropertyUnit);
      if (t) phone = t.e164PhoneMobileNumber ?? t.phones?.[0]?.number ?? null;
    }

    const tenantFirstName = firstNameOf(r.tenantName);
    const log = logByAddress.get(r.address) ?? null;
    const situation = situationByAddress.get(r.address) ?? null;
    const hasContactLog = log !== null;
    const hasPaymentSituation = situation !== null;

    // State machine:
    //   communicated  → contact log marked 'done', OR any situation activity
    //                   this month → fully handled, drop from list.
    //   awaiting_reply → a text was sent (status 'awaiting_reply', or — as a
    //                   fallback when the status column didn't persist — a
    //                   contact log that stamped sms_sent_at and isn't 'done')
    //                   and no situation logged yet → stays in waiting state.
    //   needs_followup → none of the above → no contact yet.
    const isAwaitingLog =
      hasContactLog &&
      (log!.status === "awaiting_reply" ||
        (log!.status !== "done" && log!.smsSentAt != null));
    const logDone = hasContactLog && !isAwaitingLog;
    const communicated = logDone || hasPaymentSituation;
    const awaitingReply = isAwaitingLog && !hasPaymentSituation;
    const needsFollowup = !communicated && !awaitingReply;

    const smsMessage = generateSmsMessage(tenantFirstName, monthName);

    return {
      property_address: r.address,
      tenant_name: r.tenantName,
      tenant_first_name: tenantFirstName,
      tenant_phone: phone,
      monthly_rent: r.monthlyRent,
      // Authoritative amount owed (Rentec lease balance) — falls back to one
      // month's rent when no lease balance is available.
      balance_due: Math.round(((lease?.outstandingBalance ?? r.monthlyRent) || 0) * 100) / 100,
      days_unpaid: r.daysOverdue,
      has_payment_situation: hasPaymentSituation,
      has_contact_log: hasContactLog,
      needs_followup: needsFollowup,
      awaiting_reply: awaitingReply,
      // Rentec's rent-status snapshot does not expose returned/NSF payments, so
      // these are always absent here (kept for output-shape parity).
      returned_payment: false,
      returned_date: null,
      returned_original_amount: null,
      returned_original_date: null,
      doorloop_lease_id: r.leaseId ?? null,
      contact_log: log,
      payment_situation: situation?.note ?? null,
      sms_message: smsMessage,
    };
  });

  // Needs-contact first, then awaiting-reply, then handled; within each, most
  // overdue first, then alphabetical.
  const rank = (i: ContactChecklistItem) =>
    i.needs_followup ? 0 : i.awaiting_reply ? 1 : 2;
  items.sort(
    (a, b) =>
      rank(a) - rank(b) ||
      b.days_unpaid - a.days_unpaid ||
      a.property_address.localeCompare(b.property_address),
  );

  return items;
}
