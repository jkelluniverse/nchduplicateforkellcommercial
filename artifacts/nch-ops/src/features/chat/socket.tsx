import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { useAuth } from "@/lib/auth";
import { getPresence } from "./api";
import type { PresenceUser, Role } from "./types";

interface TypingState {
  role: Role;
  userName: string;
  isTyping: boolean;
  ts: number;
}

interface ChatSocketCtx {
  socket: Socket | null;
  connected: boolean;
  presence: PresenceUser[];
  online: Set<Role>;
  typing: TypingState[];
  emitTyping: (isTyping: boolean) => void;
  refreshPresence: () => Promise<void>;
}

const Ctx = createContext<ChatSocketCtx | null>(null);

export function ChatSocketProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [online, setOnline] = useState<Set<Role>>(new Set());
  const [typing, setTyping] = useState<TypingState[]>([]);
  const typingTimerRef = useRef<number | null>(null);
  const lastTypingEmitRef = useRef(0);

  const refreshPresence = async () => {
    try {
      const res = await getPresence();
      setPresence(res.users);
      setOnline(new Set(res.online as Role[]));
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (!user) {
      setSocket(null);
      setConnected(false);
      return;
    }
    const tok = localStorage.getItem("nch_token") ?? "";
    if (!tok) return;

    const s = io({
      path: "/api/socket.io",
      auth: { token: tok },
      transports: ["websocket", "polling"],
    });

    s.on("connect", () => {
      setConnected(true);
      void refreshPresence();
    });
    s.on("disconnect", () => setConnected(false));
    s.on("presence", (data: { online: string[] }) => {
      setOnline(new Set(data.online as Role[]));
      setPresence((prev) =>
        prev.map((p) => ({ ...p, online: data.online.includes(p.role) })),
      );
    });
    s.on("user_typing", (data: { role: Role; userName: string; isTyping: boolean }) => {
      setTyping((prev) => {
        const filtered = prev.filter((t) => t.role !== data.role);
        if (data.isTyping) {
          return [...filtered, { ...data, ts: Date.now() }];
        }
        return filtered;
      });
    });

    setSocket(s);

    return () => {
      s.disconnect();
      setSocket(null);
      setConnected(false);
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-clear stale typing entries
  useEffect(() => {
    if (typing.length === 0) return;
    const t = window.setInterval(() => {
      setTyping((prev) => prev.filter((p) => Date.now() - p.ts < 4000));
    }, 1000);
    return () => window.clearInterval(t);
  }, [typing.length]);

  const emitTyping = (isTyping: boolean) => {
    if (!socket) return;
    const now = Date.now();
    if (isTyping) {
      // Throttle to once per second
      if (now - lastTypingEmitRef.current < 1000) return;
      lastTypingEmitRef.current = now;
      socket.emit("typing", { isTyping: true });
      if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
      typingTimerRef.current = window.setTimeout(() => {
        socket.emit("typing", { isTyping: false });
      }, 2500);
    } else {
      lastTypingEmitRef.current = 0;
      if (typingTimerRef.current) window.clearTimeout(typingTimerRef.current);
      socket.emit("typing", { isTyping: false });
    }
  };

  return (
    <Ctx.Provider value={{ socket, connected, presence, online, typing, emitTyping, refreshPresence }}>
      {children}
    </Ctx.Provider>
  );
}

export function useChatSocket(): ChatSocketCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useChatSocket must be inside ChatSocketProvider");
  return c;
}
