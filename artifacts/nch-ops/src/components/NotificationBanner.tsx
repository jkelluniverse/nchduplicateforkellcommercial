import { useEffect, useState } from "react";
import { Bell, X } from "lucide-react";
import { setupPushNotifications, pushSupported } from "@/lib/push";

const DISMISSED_KEY = "nch_notif_banner_dismissed";

function isIosPwa(): boolean {
  if (typeof window === "undefined") return false;
  // navigator.standalone is true when launched from iOS Home Screen
  const nav = window.navigator as Navigator & { standalone?: boolean };
  if (nav.standalone === true) return true;
  // Fallback: matchMedia display-mode standalone (works on some iOS versions)
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  return false;
}

export function NotificationBanner() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!pushSupported()) return;
    if (!isIosPwa()) return;
    if (Notification.permission !== "default") return;
    if (localStorage.getItem(DISMISSED_KEY)) return;
    setVisible(true);
  }, []);

  if (!visible) return null;

  const dismiss = () => {
    localStorage.setItem(DISMISSED_KEY, "1");
    setVisible(false);
  };

  const enable = async () => {
    setVisible(false);
    await setupPushNotifications();
  };

  return (
    <div className="flex items-start gap-3 bg-[#B23A2E] text-white px-4 py-3 text-sm">
      <Bell className="w-5 h-5 mt-0.5 flex-shrink-0" />
      <p className="flex-1 leading-snug">
        Get notified when tasks are assigned to you.{" "}
        <button
          onClick={enable}
          className="underline font-semibold"
        >
          Enable notifications
        </button>
      </p>
      <button onClick={dismiss} aria-label="Dismiss" className="flex-shrink-0 mt-0.5">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
