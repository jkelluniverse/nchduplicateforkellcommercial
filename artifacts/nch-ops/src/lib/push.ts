// Web-push subscription helpers (task / past-due alerts). Self-contained so it
// does not depend on any removed feature module.

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

function token(): string {
  return localStorage.getItem("kc_token") ?? "";
}

function authHeaders(json = true): HeadersInit {
  const h: Record<string, string> = { Authorization: `Bearer ${token()}` };
  if (json) h["Content-Type"] = "application/json";
  return h;
}

async function getVapidKey(): Promise<{ publicKey: string }> {
  const res = await fetch(`${BASE}/api/push/vapid-key`, { headers: authHeaders(false) });
  if (!res.ok) throw new Error(`vapid-key ${res.status}`);
  return res.json() as Promise<{ publicKey: string }>;
}

async function pushSubscribe(subscription: PushSubscriptionJSON): Promise<void> {
  const res = await fetch(`${BASE}/api/push/subscribe`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ subscription }),
  });
  if (!res.ok) throw new Error(`subscribe ${res.status}`);
}

function urlBase64ToUint8Array(base64String: string): Uint8Array {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

export function pushSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    "Notification" in window
  );
}

export async function ensureServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null;
  try {
    return await navigator.serviceWorker.register(`${BASE}/sw.js`);
  } catch {
    return null;
  }
}

/** Subscribe the current device. Requires Notification.permission === "granted". */
export async function subscribeIfGranted(): Promise<void> {
  if (!pushSupported()) return;
  if (Notification.permission !== "granted") return;

  const reg = await ensureServiceWorker();
  if (!reg) return;

  try {
    const { publicKey } = await getVapidKey();
    if (!publicKey) return;
    const existing = await reg.pushManager.getSubscription();
    if (existing) {
      await pushSubscribe(existing.toJSON());
      return;
    }
    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey).buffer as ArrayBuffer,
    });
    await pushSubscribe(sub.toJSON());
  } catch (err) {
    console.error("push subscribe failed", err);
  }
}

/** Full setup: request permission if needed, then subscribe. */
export async function setupPushNotifications(): Promise<"granted" | "denied" | "default" | "unsupported"> {
  if (!pushSupported()) return "unsupported";
  const reg = await ensureServiceWorker();
  if (!reg) return "unsupported";
  if (Notification.permission === "denied") return "denied";
  if (Notification.permission !== "granted") {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return perm as "denied" | "default";
  }
  await subscribeIfGranted();
  return "granted";
}
