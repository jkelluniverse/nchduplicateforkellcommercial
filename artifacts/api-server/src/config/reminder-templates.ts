/**
 * Per-stage text-reminder templates (Kell Commercial).
 *
 * Each collection stage has its OWN wording so the one-tap native-Messages
 * reminder reads appropriately for where the tenant is in the flow. Templates
 * live here (config) rather than inline in the UI/route so they can be tuned
 * without touching feature code.
 *
 * Placeholders are substituted at render time:
 *   {tenant}   – resident name
 *   {property} – property address
 *   {amount}   – formatted amount (e.g. "$950.00"), when known
 *   {date}     – expected date (e.g. "Jun 11, 2026"), when known
 *
 * No real tenant/owner/property data lives here — only the message wording with
 * placeholders. Recipient name/phone are pulled from Rentec at send time.
 */
export type ReminderStage =
  | "situation_reminder"
  | "needs_contacted"
  | "missed_promise"
  | "payment_returned";

export interface ReminderTemplate {
  /** Short label shown on the reminder button / picker. */
  label: string;
  /** Message body with {placeholders}. */
  body: string;
}

export const REMINDER_TEMPLATES: Record<ReminderStage, ReminderTemplate> = {
  situation_reminder: {
    label: "Payment reminder",
    body:
      "Hi {tenant}, this is a friendly reminder about the rent payment for {property}. " +
      "We have {amount} expected on {date}. Please let us know if you have any questions. Thank you!",
  },
  needs_contacted: {
    label: "Initial outreach",
    body:
      "Hi {tenant}, we're reaching out regarding the rent balance on {property}. " +
      "When you have a moment, please give us a call so we can sort out a plan. Thank you!",
  },
  missed_promise: {
    label: "Past-due follow-up",
    body:
      "Hi {tenant}, we haven't yet received the expected payment for {property} ({amount} due {date}). " +
      "Please reach out today so we can get this resolved. Thank you!",
  },
  payment_returned: {
    label: "Returned payment",
    body:
      "Hi {tenant}, the recent payment for {property} was returned by the bank, so the balance is " +
      "now {amount}. Please contact us to arrange a replacement payment. Thank you!",
  },
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "the expected date";
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${MONTHS[parseInt(m[2]!, 10) - 1]} ${parseInt(m[3]!, 10)}, ${m[1]}`;
}

function fmtAmount(amount: number | string | null | undefined): string {
  if (amount === null || amount === undefined || amount === "") return "the outstanding balance";
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (Number.isNaN(n)) return "the outstanding balance";
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** Render a stage template with the given context. */
export function renderReminder(
  stage: ReminderStage,
  ctx: {
    tenant?: string | null;
    property?: string | null;
    amount?: number | string | null;
    date?: string | null;
  },
): { label: string; body: string } {
  const tpl = REMINDER_TEMPLATES[stage] ?? REMINDER_TEMPLATES.situation_reminder;
  const body = tpl.body
    .replaceAll("{tenant}", ctx.tenant?.trim() || "there")
    .replaceAll("{property}", ctx.property?.trim() || "your unit")
    .replaceAll("{amount}", fmtAmount(ctx.amount))
    .replaceAll("{date}", fmtDate(ctx.date));
  return { label: tpl.label, body };
}
