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

export interface ContactLog {
  id: number;
  propertyAddress: string;
  tenantName: string | null;
  doorloopLeaseId: string | null;
  month: number;
  year: number;
  status: string | null; // 'done' | 'awaiting_reply'
  contactedAt: string | null;
  contactedBy: string;
  contactMethod: string | null;
  notes: string | null;
  smsSentAt: string | null;
}

export interface ChecklistItem {
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
  contact_log: ContactLog | null;
  payment_situation: unknown | null;
  sms_message: string;
}

export interface ChecklistResponse {
  active: boolean;
  note?: string;
  month: number;
  year: number;
  items: ChecklistItem[];
}

export interface MarkContactedInput {
  property_address: string;
  tenant_name?: string | null;
  doorloop_lease_id?: string | null;
  contact_method?: string;
  notes?: string;
  sms_sent?: boolean;
}

export const contactKeys = {
  all: ["contact-checklist"] as const,
  list: (m: number, y: number) => [...contactKeys.all, "list", m, y] as const,
  history: () => [...contactKeys.all, "history"] as const,
};

export function fetchChecklist(month: number, year: number): Promise<ChecklistResponse> {
  return apiFetch<ChecklistResponse>(`/contact-checklist?month=${month}&year=${year}`);
}

export function markContacted(body: MarkContactedInput): Promise<ContactLog> {
  return apiFetch<ContactLog>("/contact-checklist/mark-contacted", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export function deleteContactLog(id: number): Promise<{ ok: true }> {
  return apiFetch<{ ok: true }>(`/contact-checklist/${id}`, { method: "DELETE" });
}

export function fetchHistory(): Promise<ContactLog[]> {
  return apiFetch<ContactLog[]>("/contact-checklist/history");
}

/** Log a payment situation from a tenant's response ("Got Response" flow). */
export function createPaymentSituation(body: {
  propertyAddress: string;
  tenantName: string;
  situation: string;
  doorloopLeaseId?: string;
  expectedPaymentAmount?: string;
}): Promise<unknown> {
  return apiFetch("/tenant-notes", { method: "POST", body: JSON.stringify(body) });
}

export function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}
