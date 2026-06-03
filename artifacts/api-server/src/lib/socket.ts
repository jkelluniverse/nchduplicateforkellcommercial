import { Server as SocketIOServer, type Socket } from "socket.io";
import type { Server as HttpServer } from "node:http";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { verifyToken } from "../routes/auth";
import { logger } from "./logger";

export interface SocketUser {
  id: number;
  role: "mike" | "jack" | "jacob";
  username: string;
}

let io: SocketIOServer | null = null;

const socketUsers = new Map<string, SocketUser>();
const onlineByRole = new Map<string, Set<string>>();
const typingByRole = new Map<string, NodeJS.Timeout>();

function addOnline(role: string, socketId: string): void {
  if (!onlineByRole.has(role)) onlineByRole.set(role, new Set());
  onlineByRole.get(role)!.add(socketId);
}

function removeOnline(role: string, socketId: string): boolean {
  const set = onlineByRole.get(role);
  if (!set) return false;
  set.delete(socketId);
  if (set.size === 0) {
    onlineByRole.delete(role);
    return true;
  }
  return false;
}

export function getOnlineRoles(): string[] {
  return Array.from(onlineByRole.keys());
}

export function isUserOnline(role: string): boolean {
  return onlineByRole.has(role);
}

export function getIO(): SocketIOServer {
  if (!io) throw new Error("Socket.io not initialized");
  return io;
}

export function emit<T = unknown>(event: string, payload: T): void {
  io?.emit(event, payload);
}

export function emitToRole<T = unknown>(role: string, event: string, payload: T): void {
  const set = onlineByRole.get(role);
  if (!set) return;
  for (const socketId of set) {
    io?.to(socketId).emit(event, payload);
  }
}

function broadcastPresence(): void {
  emit("presence", { online: getOnlineRoles() });
}

export function initSocket(server: HttpServer): SocketIOServer {
  io = new SocketIOServer(server, {
    path: "/api/socket.io",
    cors: { origin: true, credentials: true },
    maxHttpBufferSize: 1e8, // 100 MB just in case (we use REST upload but be safe)
  });

  io.use((socket: Socket, next) => {
    const token = (socket.handshake.auth?.token as string | undefined) ?? "";
    if (!token) return next(new Error("Unauthorized"));
    const decoded = verifyToken(token);
    if (!decoded) return next(new Error("Invalid token"));
    socketUsers.set(socket.id, decoded as SocketUser);
    next();
  });

  io.on("connection", (socket: Socket) => {
    const user = socketUsers.get(socket.id);
    if (!user) {
      socket.disconnect();
      return;
    }

    addOnline(user.role, socket.id);
    broadcastPresence();

    socket.on("typing", (payload: { isTyping: boolean }) => {
      socket.broadcast.emit("user_typing", {
        userId: user.id,
        userName: user.username,
        role: user.role,
        isTyping: !!payload?.isTyping,
      });
      // Auto-clear typing flag after 3s of no signal
      const existing = typingByRole.get(user.role);
      if (existing) clearTimeout(existing);
      if (payload?.isTyping) {
        typingByRole.set(
          user.role,
          setTimeout(() => {
            socket.broadcast.emit("user_typing", {
              userId: user.id,
              userName: user.username,
              role: user.role,
              isTyping: false,
            });
            typingByRole.delete(user.role);
          }, 3000),
        );
      }
    });

    socket.on("mark_read", (payload: { messageId: number }) => {
      // The actual DB write is done by REST endpoint; we just relay
      socket.broadcast.emit("message_read", {
        messageId: payload?.messageId,
        role: user.role,
      });
    });

    socket.on("disconnect", () => {
      socketUsers.delete(socket.id);
      const wentOffline = removeOnline(user.role, socket.id);
      if (wentOffline) {
        db.update(usersTable)
          .set({ lastSeen: new Date() })
          .where(eq(usersTable.id, user.id))
          .catch((err) => logger.error({ err }, "Failed to update last_seen"));
      }
      broadcastPresence();
    });
  });

  return io;
}
