import { getVapidKey, pushSubscribe } from "./api";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

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

/**
 * Subscribe the current device to push notifications.
 * Requires that Notification.permission is already "granted".
 * Does NOT request permission — use setupPushNotifications() for that.
 */
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

/**
 * Full push setup: requests permission if not yet granted, then subscribes.
 * On iOS PWA, only call this from an explicit user action (e.g. a banner
 * "Enable notifications" button), NOT automatically on page load.
 * On desktop / Android the system prompt is less intrusive and calling
 * this directly is fine.
 */
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
