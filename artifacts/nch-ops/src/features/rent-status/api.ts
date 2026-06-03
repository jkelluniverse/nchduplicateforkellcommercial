import type {
  RentSummary,
  RentRow,
  RentPropertyDetail,
  RentMonthOption,
  RentMonthHistory,
} from "./types";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function authHeaders(): HeadersInit {
  return {
    Authorization: `Bearer ${localStorage.getItem("nch_token") ?? ""}`,
    "Content-Type": "application/json",
  };
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API_BASE}/api${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.headers ?? {}) },
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(text || `Request failed (${r.status})`);
  }
  return r.json() as Promise<T>;
}

export function fetchRentSummary(): Promise<RentSummary> {
  return request<RentSummary>("/rent-status/summary");
}

export function fetchRentDetail(): Promise<RentRow[]> {
  return request<RentRow[]>("/rent-status/detail");
}

export function fetchRentMonths(): Promise<RentMonthOption[]> {
  return request<RentMonthOption[]>("/rent-status/months");
}

export function fetchRentMonthHistory(month: number, year: number): Promise<RentMonthHistory> {
  return request<RentMonthHistory>(`/rent-status/history/${month}/${year}`);
}

export function fetchPropertyHistory(propertyId: number): Promise<RentPropertyDetail> {
  return request<RentPropertyDetail>(`/rent-status/${propertyId}`);
}

export interface LogPaymentInput {
  status?: "paid" | "unpaid" | "late" | "delinquent" | "partial";
  amount_paid?: number;
  late_fee_paid?: number;
  payment_date?: string | null;
  notes?: string | null;
}

export function logPayment(
  propertyId: number,
  month: number,
  year: number,
  body: LogPaymentInput,
): Promise<RentRow> {
  return request<RentRow>(`/rent-status/${propertyId}/month/${month}/year/${year}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
}

export const rentKeys = {
  all: ["rent-status"] as const,
  summary: () => [...rentKeys.all, "summary"] as const,
  detail: () => [...rentKeys.all, "detail"] as const,
  months: () => [...rentKeys.all, "months"] as const,
  history: (m: number, y: number) => [...rentKeys.all, "history", m, y] as const,
  property: (id: number) => [...rentKeys.all, "property", id] as const,
};

export function fmtMoney(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

export function fmtMoney2(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
