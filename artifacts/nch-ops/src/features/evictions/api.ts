const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
function authHeaders(): HeadersInit {
  return { Authorization: `Bearer ${localStorage.getItem("kc_token") ?? ""}`, "Content-Type": "application/json" };
}
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${API_BASE}/api${path}`, { ...init, headers: { ...authHeaders(), ...(init?.headers ?? {}) } });
  if (!r.ok) throw new Error((await r.json().catch(() => ({} as any))).error || `Request failed (${r.status})`);
  return r.json() as Promise<T>;
}

export const STAGES: { key: string; label: string }[] = [
  { key: "notice_filed", label: "Notice Filed" },
  { key: "court_date_set", label: "Court Date Set" },
  { key: "hearing_complete", label: "Hearing" },
  { key: "judgment_issued", label: "Judgment" },
  { key: "vacated", label: "Vacated" },
  { key: "closed", label: "Closed" },
];

export interface EvictionCase {
  id: number;
  propertyAddress: string;
  tenantName: string;
  doorloopLeaseId: string | null;
  doorloopPropertyId: string | null;
  balanceAtFiling: number | null;
  monthlyRent: number | null;
  balanceWrittenOff: number | null;
  writtenOffAt: string | null;
  writtenOffNotes: string | null;
  status: string;
  statusLabel: string;
  noticeFiledDate: string | null;
  noticeType: string | null;
  courtDate: string | null;
  courtTime: string | null;
  courtLocation: string | null;
  hearingOutcome: string | null;
  judgmentDate: string | null;
  judgmentNotes: string | null;
  vacatedDate: string | null;
  notes: string | null;
  createdAt: string | null;
  closedAt: string | null;
  noticeExpiryDate?: string | null;
  attorneySentAt?: string | null;
  contractDriveUrl?: string | null;
  contractDriveFileId?: string | null;
  // Latest court payment agreement status for this case (list badge), if any.
  paymentPlanStatus?: string | null;
}

// ─── Court Payment Agreement (magistrate-approved installment plan) ──────────
export interface PaymentAgreement {
  id: number;
  evictionCaseId: number;
  propertyAddress: string;
  tenantName: string;
  agreementDate: string | null;
  courtRef: string | null;
  notes: string | null;
  status: string; // active | completed | defaulted | cancelled
  setoutFiledAt: string | null;
  createdAt: string | null;
}
export interface Installment {
  id: number;
  dueDate: string;
  amount: number;
  status: string; // pending | paid | missed
  paidDate: string | null;
  paidAmount: number | null;
  manuallyMarked: boolean;
  notes: string | null;
}
export const paymentAgreementKey = (caseId: number) => ["payment-agreement", caseId] as const;
export function fetchPaymentAgreement(caseId: number): Promise<{ agreement: PaymentAgreement | null; installments: Installment[] }> {
  return api(`/evictions/${caseId}/payment-agreement`);
}
export function createPaymentAgreement(caseId: number, body: { agreementDate: string; courtRef?: string; notes?: string; installments: { dueDate: string; amount: number }[] }): Promise<{ id: number }> {
  return api(`/evictions/${caseId}/payment-agreement`, { method: "POST", body: JSON.stringify(body) });
}
export function updatePaymentAgreement(caseId: number, body: { agreementDate?: string; courtRef?: string | null; notes?: string | null; installments: { id?: number; dueDate: string; amount: number }[] }): Promise<{ ok: true }> {
  return api(`/evictions/${caseId}/payment-agreement`, { method: "PUT", body: JSON.stringify(body) });
}
export function markInstallmentPaid(aid: number, iid: number, body: { paidDate?: string; amount?: number; notes?: string }): Promise<{ ok: true }> {
  return api(`/payment-agreements/${aid}/installments/${iid}/mark-paid`, { method: "POST", body: JSON.stringify(body) });
}
export function setAgreementStatus(aid: number, body: { status: "active" | "completed" | "defaulted" | "cancelled"; setoutFiled?: boolean; notes?: string }): Promise<{ ok: true }> {
  return api(`/payment-agreements/${aid}/status`, { method: "POST", body: JSON.stringify(body) });
}

export interface ReadyStatus {
  ready: boolean;
  requiredDays: number;
  daysPassed: number;
  periodComplete: boolean;
  isBusinessDays: boolean;
  noticeType: string | null;
  noticeFiledDate: string | null;
  missingDocs: string[];
  hasNotice: boolean;
  hasBalance: boolean;
  hasContract: boolean;
  contractUrl: string | null;
  balanceAtFiling: number | null;
  attorneySentAt: string | null;
  attorneyName: string;
  attorneyEmail: string;
}

export function deleteDocument(caseId: number, docId: number): Promise<{ ok: true }> {
  return api(`/evictions/${caseId}/documents/${docId}`, { method: "DELETE" });
}
export const readyKey = (id: number) => ["eviction-ready", id] as const;
export function fetchReady(id: number): Promise<ReadyStatus> { return api(`/evictions/${id}/ready`); }
export function findContract(id: number): Promise<{ found: boolean; fileName?: string; webViewLink?: string }> {
  return api(`/evictions/${id}/find-contract`, { method: "POST" });
}
export function sendAttorney(id: number): Promise<{ ok: true; sentAt: string }> {
  return api(`/evictions/${id}/send-attorney`, { method: "POST" });
}
export interface TimelineEntry { id: number; stage: string; stageDate: string | null; notes: string | null }
export interface CaseDocument { id: number; documentName: string; documentType: string; driveUrl: string | null; driveFileId?: string | null; mimeType?: string | null; hasContent?: boolean; postedAt?: string | null; uploadedAt: string | null }

/** The document's own bytes (base64 data URL) for inline preview / download. */
export function documentContent(caseId: number, docId: number): Promise<{ documentName: string; mimeType: string | null; fileBase64: string }> {
  return api(`/evictions/${caseId}/documents/${docId}/content`);
}

export const evictionsKey = ["evictions"] as const;
export const evictionKey = (id: number) => ["eviction", id] as const;

export function listEvictions(): Promise<{ active: EvictionCase[]; closed: EvictionCase[] }> {
  return api(`/evictions`);
}
export function fetchEviction(id: number): Promise<{ case: EvictionCase; timeline: TimelineEntry[]; documents: CaseDocument[] }> {
  return api(`/evictions/${id}`);
}
export function createEviction(body: Record<string, unknown>): Promise<{ id: number }> {
  return api(`/evictions`, { method: "POST", body: JSON.stringify(body) });
}
export function updateEviction(id: number, body: Record<string, unknown>): Promise<{ ok: true }> {
  return api(`/evictions/${id}`, { method: "PUT", body: JSON.stringify(body) });
}
export function advanceStage(id: number, body: Record<string, unknown>): Promise<{ ok: true }> {
  return api(`/evictions/${id}/stage`, { method: "PUT", body: JSON.stringify(body) });
}
export function writeOffBalance(id: number, body: { amount?: number; notes?: string }): Promise<{ ok: true; amount: number }> {
  return api(`/evictions/${id}/write-off`, { method: "POST", body: JSON.stringify(body) });
}
export function uploadDocument(id: number, body: { documentName: string; documentType: string; fileBase64: string; postedAt?: string; notes?: string }): Promise<{ id: number; driveUrl: string | null; driveFileId: string | null }> {
  return api(`/evictions/${id}/documents`, { method: "POST", body: JSON.stringify(body) });
}
export function closeCase(id: number): Promise<{ ok: true }> {
  return api(`/evictions/${id}`, { method: "DELETE" });
}
export function hardDeleteCase(id: number): Promise<{ ok: true; deleted: boolean }> {
  return api(`/evictions/${id}?hard=true`, { method: "DELETE" });
}
export interface AccountBalanceResult { filename: string; driveUrl: string; pdfBase64: string }
export function accountBalance(id: number): Promise<AccountBalanceResult> {
  return api(`/evictions/${id}/account-balance`);
}

export function downloadBase64Pdf(filename: string, base64: string): void {
  const bytes = atob(base64); const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  const url = URL.createObjectURL(new Blob([arr], { type: "application/pdf" }));
  const a = document.createElement("a"); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
export function fileToBase64(file: File): Promise<string> {
  // Full data URL (data:<mime>;base64,...) so Drive preserves the correct type.
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
