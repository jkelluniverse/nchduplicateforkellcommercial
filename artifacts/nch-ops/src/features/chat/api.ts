import type { ChatMessage, LinkPreview, PresenceUser, UploadResult } from "./types";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function token(): string {
  return localStorage.getItem("nch_token") ?? "";
}

function headers(json = true): HeadersInit {
  const h: Record<string, string> = { Authorization: `Bearer ${token()}` };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

async function asJson<T>(resp: Response): Promise<T> {
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`${resp.status}: ${text || resp.statusText}`);
  }
  return resp.json() as Promise<T>;
}

export async function listMessages(
  before?: number,
  limit = 50,
): Promise<{ items: ChatMessage[]; hasMore: boolean }> {
  const qs = new URLSearchParams();
  if (before) qs.set("before", String(before));
  qs.set("limit", String(limit));
  return asJson(await fetch(`${BASE}/api/messages?${qs}`, { headers: headers(false) }));
}

export interface SendBody {
  content?: string | null;
  messageType?: ChatMessage["messageType"];
  mentions?: string[];
  linkedJobId?: number | null;
  attachmentUrl?: string | null;
  attachmentName?: string | null;
  attachmentSize?: number | null;
  attachmentMime?: string | null;
  attachmentMeta?: unknown;
  replyToId?: number | null;
}

export async function sendMessage(body: SendBody): Promise<ChatMessage> {
  return asJson(
    await fetch(`${BASE}/api/messages`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body),
    }),
  );
}

export async function uploadAttachment(file: File | Blob, filename?: string): Promise<UploadResult> {
  const fd = new FormData();
  fd.append("file", file, filename ?? (file as File).name ?? "upload");
  return asJson(
    await fetch(`${BASE}/api/messages/upload`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token()}` },
      body: fd,
    }),
  );
}

export async function deleteMessage(id: number): Promise<void> {
  await asJson(
    await fetch(`${BASE}/api/messages/${id}`, { method: "DELETE", headers: headers(false) }),
  );
}

export async function reactToMessage(id: number, emoji: string): Promise<{ action: "added" | "removed" }> {
  return asJson(
    await fetch(`${BASE}/api/messages/${id}/react`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ emoji }),
    }),
  );
}

export async function markRead(id: number): Promise<void> {
  await fetch(`${BASE}/api/messages/${id}/read`, { method: "POST", headers: headers(false) }).catch(
    () => {},
  );
}

export async function markAllRead(): Promise<void> {
  await fetch(`${BASE}/api/messages/mark-read`, { method: "POST", headers: headers() }).catch(
    () => {},
  );
}

export async function searchMessages(q: string): Promise<{ items: ChatMessage[] }> {
  return asJson(
    await fetch(`${BASE}/api/messages/search?q=${encodeURIComponent(q)}`, { headers: headers(false) }),
  );
}

export async function getPresence(): Promise<{ online: string[]; users: PresenceUser[] }> {
  return asJson(await fetch(`${BASE}/api/messages/presence`, { headers: headers(false) }));
}

export async function getLinkPreview(url: string): Promise<LinkPreview> {
  return asJson(
    await fetch(`${BASE}/api/link-preview?url=${encodeURIComponent(url)}`, { headers: headers(false) }),
  );
}

export async function saveAttachmentToDrive(messageId: number): Promise<{ driveUrl: string }> {
  return asJson(
    await fetch(`${BASE}/api/messages/${messageId}/save-to-drive`, {
      method: "POST",
      headers: headers(false),
    }),
  );
}

export async function getVapidKey(): Promise<{ publicKey: string }> {
  return asJson(await fetch(`${BASE}/api/push/vapid-key`, { headers: headers(false) }));
}

export async function pushSubscribe(subscription: PushSubscriptionJSON): Promise<void> {
  await asJson(
    await fetch(`${BASE}/api/push/subscribe`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ subscription }),
    }),
  );
}

export function attachmentAbsoluteUrl(path: string | null): string {
  if (!path) return "";
  if (path.startsWith("http")) return path;
  // Append auth token so <img>/<audio> tags can fetch protected attachments.
  const t = token();
  const sep = path.includes("?") ? "&" : "?";
  return `${BASE}${path}${t ? `${sep}token=${encodeURIComponent(t)}` : ""}`;
}
