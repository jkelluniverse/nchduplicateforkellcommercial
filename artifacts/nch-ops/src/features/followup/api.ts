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

export interface FollowupTask {
  id: number;
  title: string;
  ageDays: number;
  snoozedUntil: string | null;
}

export interface NudgeSettings {
  time: string;
  digest: boolean;
}

export const followupKeys = {
  list: ["open-loops"] as const,
  settings: ["nudge-settings"] as const,
};

export function listFollowups(): Promise<FollowupTask[]> {
  return apiFetch<FollowupTask[]>("/followups");
}

export function quickTask(title: string, description?: string): Promise<{ id: number; title: string }> {
  return apiFetch("/quick-task", { method: "POST", body: JSON.stringify({ title, description }) });
}

export function setFollowup(taskId: number, needsFollowup: boolean): Promise<unknown> {
  return apiFetch(`/tasks/${taskId}/followup`, { method: "PUT", body: JSON.stringify({ needsFollowup }) });
}

export function snoozeTask(taskId: number): Promise<unknown> {
  return apiFetch(`/tasks/${taskId}/snooze`, { method: "POST" });
}

export function completeTask(taskId: number): Promise<unknown> {
  return apiFetch(`/tasks/${taskId}/complete`, { method: "PUT" });
}

export function getNudgeSettings(): Promise<NudgeSettings> {
  return apiFetch<NudgeSettings>("/nudge-settings");
}

export function setNudgeSettings(body: Partial<NudgeSettings>): Promise<NudgeSettings> {
  return apiFetch<NudgeSettings>("/nudge-settings", { method: "PUT", body: JSON.stringify(body) });
}
