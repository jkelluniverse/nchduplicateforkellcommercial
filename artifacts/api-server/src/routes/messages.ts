import { Router, type IRouter, type Response } from "express";
import { eq, sql, and, lt, isNull, desc, inArray, or, like } from "drizzle-orm";
import path from "node:path";
import fs from "node:fs";
import {
  db,
  messagesTable,
  messageReadsTable,
  messageReactionsTable,
  jobsTable,
  usersTable,
  type Message,
} from "@workspace/db";
import { z } from "zod/v4";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { chatUpload, CHAT_UPLOAD_DIR, publicUrlForFilename } from "../lib/chat-upload";
import { emit, getOnlineRoles, isUserOnline } from "../lib/socket";
import { fetchLinkPreview } from "../lib/link-preview";
import { notifyOfflineUsers } from "../lib/web-push";
import { findOrCreateSubfolder, resolveOrCreateFolderPath, uploadFileToDrive } from "../lib/google-drive";

const router: IRouter = Router();

type Role = "mike" | "jack" | "jacob";

// ---------- helpers ----------

interface ClientMessage {
  id: number;
  content: string | null;
  author: string;
  authorRole: Role;
  messageType: Message["messageType"];
  mentions: string[];
  linkedJobId: number | null;
  linkedJobNumber: string | null;
  attachmentUrl: string | null;
  attachmentName: string | null;
  attachmentSize: number | null;
  attachmentMime: string | null;
  attachmentMeta: unknown;
  driveSaved: boolean;
  driveUrl: string | null;
  replyToId: number | null;
  replyTo: { id: number; author: string; content: string | null; messageType: string } | null;
  createdAt: Date;
  reactions: Array<{ emoji: string; userRoles: Role[] }>;
  readBy: Role[];
}

async function loadReactionsAndReads(
  messageIds: number[],
): Promise<{
  reactionsByMsg: Map<number, Array<{ emoji: string; userRoles: Role[] }>>;
  readsByMsg: Map<number, Role[]>;
}> {
  const reactionsByMsg = new Map<number, Array<{ emoji: string; userRoles: Role[] }>>();
  const readsByMsg = new Map<number, Role[]>();
  if (messageIds.length === 0) return { reactionsByMsg, readsByMsg };

  const [reactionRows, readRows] = await Promise.all([
    db.select().from(messageReactionsTable).where(inArray(messageReactionsTable.messageId, messageIds)),
    db.select().from(messageReadsTable).where(inArray(messageReadsTable.messageId, messageIds)),
  ]);

  for (const r of reactionRows) {
    const list = reactionsByMsg.get(r.messageId) ?? [];
    let entry = list.find((e) => e.emoji === r.emoji);
    if (!entry) {
      entry = { emoji: r.emoji, userRoles: [] };
      list.push(entry);
    }
    if (!entry.userRoles.includes(r.userRole as Role)) entry.userRoles.push(r.userRole as Role);
    reactionsByMsg.set(r.messageId, list);
  }
  for (const r of readRows) {
    const list = readsByMsg.get(r.messageId) ?? [];
    if (!list.includes(r.userRole as Role)) list.push(r.userRole as Role);
    readsByMsg.set(r.messageId, list);
  }
  return { reactionsByMsg, readsByMsg };
}

async function buildClientMessages(rows: Message[]): Promise<ClientMessage[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((m) => m.id);
  const replyIds = rows.map((m) => m.replyToId).filter((id): id is number => !!id);
  const linkedJobIds = rows.map((m) => m.linkedJobId).filter((id): id is number => !!id);

  const [{ reactionsByMsg, readsByMsg }, replyRows, jobRows] = await Promise.all([
    loadReactionsAndReads(ids),
    replyIds.length
      ? db
          .select()
          .from(messagesTable)
          .where(and(inArray(messagesTable.id, replyIds), isNull(messagesTable.deletedAt)))
      : Promise.resolve([] as Message[]),
    linkedJobIds.length
      ? db.select().from(jobsTable).where(inArray(jobsTable.id, linkedJobIds))
      : Promise.resolve([]),
  ]);

  const replyMap = new Map(replyRows.map((r) => [r.id, r]));
  const jobMap = new Map(jobRows.map((j) => [j.id, j.jobNumber]));

  return rows.map((m): ClientMessage => {
    const replied = m.replyToId ? replyMap.get(m.replyToId) : undefined;
    return {
      id: m.id,
      content: m.content,
      author: m.author,
      authorRole: m.authorRole as Role,
      messageType: m.messageType,
      mentions: m.mentions,
      linkedJobId: m.linkedJobId,
      linkedJobNumber: m.linkedJobId ? jobMap.get(m.linkedJobId) ?? null : null,
      attachmentUrl: m.attachmentUrl,
      attachmentName: m.attachmentName,
      attachmentSize: m.attachmentSize,
      attachmentMime: m.attachmentMime,
      attachmentMeta: m.attachmentMeta,
      driveSaved: m.driveSaved,
      driveUrl: m.driveUrl,
      replyToId: m.replyToId,
      replyTo: replied
        ? {
            id: replied.id,
            author: replied.author,
            content: replied.content,
            messageType: replied.messageType,
          }
        : null,
      createdAt: m.createdAt,
      reactions: reactionsByMsg.get(m.id) ?? [],
      readBy: readsByMsg.get(m.id) ?? [],
    };
  });
}

/**
 * Safely resolve a chat attachment URL to an absolute file path inside CHAT_UPLOAD_DIR.
 * Returns null if the URL is malformed or attempts path traversal.
 */
function safeAttachmentPath(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/\/chat-files\/([^/?#]+)$/);
  if (!m) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(m[1]!);
  } catch {
    return null;
  }
  const base = path.basename(decoded);
  if (base !== decoded || base.includes("/") || base.includes("\\") || base.includes("..") || base.length === 0) {
    return null;
  }
  const full = path.resolve(CHAT_UPLOAD_DIR, base);
  if (full !== path.join(CHAT_UPLOAD_DIR, base)) return null;
  if (!full.startsWith(CHAT_UPLOAD_DIR + path.sep)) return null;
  return full;
}

/**
 * Validate a client-supplied attachment URL on write. Must point to /api/chat-files/<safe>.
 */
function isValidAttachmentUrl(url: string): boolean {
  if (!url.startsWith("/api/chat-files/")) return false;
  return safeAttachmentPath(url) !== null;
}

function previewText(m: ClientMessage): string {
  if (m.messageType === "text" || m.messageType === "link") return (m.content ?? "").slice(0, 80);
  if (m.messageType === "image") return "📷 Photo";
  if (m.messageType === "voice" || m.messageType === "audio") return "🎤 Voice message";
  if (m.messageType === "file") return `📎 ${m.attachmentName ?? "Attachment"}`;
  return "📎 Attachment";
}

// ---------- routes ----------

/**
 * GET /messages?before=<id>&limit=50
 * Returns messages oldest-first within the page (so client can append).
 * `before` is exclusive; omit for the latest page.
 */
router.get("/messages", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const limit = Math.min(Number(req.query.limit) || 50, 100);
  const before = Number(req.query.before) || 0;

  const where = before
    ? and(isNull(messagesTable.deletedAt), lt(messagesTable.id, before))
    : isNull(messagesTable.deletedAt);

  const rows = await db
    .select()
    .from(messagesTable)
    .where(where)
    .orderBy(desc(messagesTable.id))
    .limit(limit);

  const ordered = rows.reverse();
  const items = await buildClientMessages(ordered);
  res.json({ items, hasMore: rows.length === limit });
});

/**
 * GET /messages/unread-count
 * Preserved for the nav badge.
 */
router.get("/messages/unread-count", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userRole = req.user!.role as Role;

  const totalRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(messagesTable)
    .where(and(isNull(messagesTable.deletedAt), sql`${messagesTable.authorRole} != ${userRole}`));

  const readRows = await db
    .select({ count: sql<number>`count(*)` })
    .from(messageReadsTable)
    .where(eq(messageReadsTable.userRole, userRole));

  const total = Number(totalRows[0]?.count) || 0;
  const read = Number(readRows[0]?.count) || 0;
  res.json({ count: Math.max(0, total - read) });
});

/**
 * POST /messages/mark-read
 * Marks ALL unread messages from others as read. Preserved.
 */
router.post("/messages/mark-read", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const userRole = req.user!.role as Role;

  const allMessages = await db
    .select({ id: messagesTable.id })
    .from(messagesTable)
    .where(and(isNull(messagesTable.deletedAt), sql`${messagesTable.authorRole} != ${userRole}`));

  const reads = await db
    .select({ messageId: messageReadsTable.messageId })
    .from(messageReadsTable)
    .where(eq(messageReadsTable.userRole, userRole));

  const readSet = new Set(reads.map((r) => r.messageId));
  const unread = allMessages.filter((m) => !readSet.has(m.id));

  if (unread.length > 0) {
    await db
      .insert(messageReadsTable)
      .values(unread.map((m) => ({ messageId: m.id, userRole })))
      .onConflictDoNothing();
    for (const m of unread) {
      emit("message_read", { messageId: m.id, role: userRole });
    }
  }

  res.json({ success: true, marked: unread.length });
});

/**
 * POST /messages/:id/read — mark a single message as read.
 */
router.post("/messages/:id/read", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const messageId = Number(req.params.id);
  if (!messageId) {
    res.status(400).json({ error: "Invalid message id" });
    return;
  }
  const userRole = req.user!.role as Role;

  const inserted = await db
    .insert(messageReadsTable)
    .values({ messageId, userRole })
    .onConflictDoNothing()
    .returning({ id: messageReadsTable.id });
  if (inserted.length > 0) {
    emit("message_read", { messageId, role: userRole });
  }
  res.json({ success: true });
});

/**
 * POST /messages — send a text / link / file message.
 * For attachments, upload first via /messages/upload, then call this with the metadata.
 */
const sendBodySchema = z.object({
  content: z.string().nullable().optional(),
  messageType: z.enum(["text", "image", "file", "link", "voice", "audio"]).optional().default("text"),
  mentions: z.array(z.string()).optional().default([]),
  linkedJobId: z.number().nullable().optional(),
  attachmentUrl: z.string().nullable().optional(),
  attachmentName: z.string().nullable().optional(),
  attachmentSize: z.number().nullable().optional(),
  attachmentMime: z.string().nullable().optional(),
  attachmentMeta: z.unknown().optional(),
  replyToId: z.number().nullable().optional(),
});

router.post("/messages", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const parsed = sendBodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = parsed.data;
  if (!data.content && !data.attachmentUrl) {
    res.status(400).json({ error: "Either content or attachment is required" });
    return;
  }
  if (data.attachmentUrl && !isValidAttachmentUrl(data.attachmentUrl)) {
    res.status(400).json({ error: "Invalid attachmentUrl — must be a server-issued /api/chat-files/<filename>" });
    return;
  }

  const [message] = await db
    .insert(messagesTable)
    .values({
      content: data.content ?? null,
      author: req.user!.username,
      authorRole: req.user!.role as Role,
      messageType: data.messageType ?? "text",
      mentions: data.mentions,
      linkedJobId: data.linkedJobId ?? null,
      attachmentUrl: data.attachmentUrl ?? null,
      attachmentName: data.attachmentName ?? null,
      attachmentSize: data.attachmentSize ?? null,
      attachmentMime: data.attachmentMime ?? null,
      attachmentMeta: (data.attachmentMeta as object | null) ?? null,
      replyToId: data.replyToId ?? null,
    })
    .returning();

  const [client] = await buildClientMessages([message]);
  emit("new_message", client);

  // Push to offline users
  void notifyOfflineUsers(req.user!.role, {
    title: req.user!.username,
    body: previewText(client!),
    url: "/messages",
    messageId: message.id,
  });

  res.status(201).json(client);
});

/**
 * POST /messages/upload — multipart upload, returns metadata for use in POST /messages.
 */
router.post(
  "/messages/upload",
  requireAuth,
  chatUpload.single("file"),
  async (req: AuthRequest, res: Response): Promise<void> => {
    const file = (req as AuthRequest & { file?: Express.Multer.File }).file;
    if (!file) {
      res.status(400).json({ error: "No file uploaded" });
      return;
    }
    res.json({
      url: publicUrlForFilename(file.filename),
      filename: file.filename,
      originalName: file.originalname,
      size: file.size,
      mime: file.mimetype,
    });
  },
);

/**
 * DELETE /messages/:id — soft-delete a message (own only).
 */
router.delete("/messages/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [m] = await db.select().from(messagesTable).where(eq(messagesTable.id, id));
  if (!m) {
    res.status(404).json({ error: "Message not found" });
    return;
  }
  if (m.authorRole !== req.user!.role) {
    res.status(403).json({ error: "Only the sender can delete this message" });
    return;
  }
  await db
    .update(messagesTable)
    .set({ deletedAt: new Date() })
    .where(eq(messagesTable.id, id));

  // Best-effort attachment file removal — only if the URL safely resolves inside CHAT_UPLOAD_DIR.
  const filePath = safeAttachmentPath(m.attachmentUrl);
  if (filePath) {
    fs.promises.unlink(filePath).catch(() => {});
  }

  emit("message_deleted", { messageId: id });
  res.json({ success: true });
});

/**
 * POST /messages/:id/react { emoji } — toggle a reaction.
 */
const reactBody = z.object({ emoji: z.string().min(1).max(16) });

router.post("/messages/:id/react", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!id) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = reactBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid emoji" });
    return;
  }
  const userRole = req.user!.role as Role;
  const emoji = parsed.data.emoji;

  // Race-safe toggle: DELETE first; if it returned a row, the toggle is "remove".
  // Otherwise INSERT (with conflict guard) — if inserted, the toggle is "add".
  // Concurrent toggles on the same reaction can never both succeed in the same direction.
  const deleted = await db
    .delete(messageReactionsTable)
    .where(
      and(
        eq(messageReactionsTable.messageId, id),
        eq(messageReactionsTable.userRole, userRole),
        eq(messageReactionsTable.emoji, emoji),
      ),
    )
    .returning({ id: messageReactionsTable.id });

  let action: "added" | "removed";
  if (deleted.length > 0) {
    action = "removed";
  } else {
    const inserted = await db
      .insert(messageReactionsTable)
      .values({ messageId: id, userRole, emoji })
      .onConflictDoNothing()
      .returning({ id: messageReactionsTable.id });
    if (inserted.length > 0) {
      action = "added";
    } else {
      // Lost a race with another insert — final state is "added", report as such.
      action = "added";
    }
  }

  emit("message_reaction", { messageId: id, emoji, role: userRole, action });
  res.json({ success: true, action });
});

/**
 * GET /messages/search?q=... — content + attachmentName match within retention window.
 */
router.get("/messages/search", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const q = (req.query.q as string | undefined)?.trim() ?? "";
  if (q.length < 2) {
    res.json({ items: [] });
    return;
  }
  const pattern = `%${q.replace(/[%_]/g, (c) => `\\${c}`)}%`;

  const rows = await db
    .select()
    .from(messagesTable)
    .where(
      and(
        isNull(messagesTable.deletedAt),
        or(like(messagesTable.content, pattern), like(messagesTable.attachmentName, pattern)),
      ),
    )
    .orderBy(desc(messagesTable.id))
    .limit(50);

  const items = await buildClientMessages(rows);
  res.json({ items });
});

/**
 * GET /messages/presence — current online roles + last_seen timestamps.
 */
router.get("/messages/presence", requireAuth, async (_req: AuthRequest, res): Promise<void> => {
  const team: Role[] = ["mike", "jack", "jacob"];
  const users = await db.select().from(usersTable).where(inArray(usersTable.role, team));
  const userMap = new Map(users.map((u) => [u.role as Role, u]));
  res.json({
    online: getOnlineRoles(),
    users: team.map((role) => {
      const u = userMap.get(role);
      return {
        role,
        name: u?.name ?? role,
        online: isUserOnline(role),
        lastSeen: u?.lastSeen ?? null,
      };
    }),
  });
});

/**
 * GET /link-preview?url=...
 */
router.get("/link-preview", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const url = (req.query.url as string | undefined)?.trim();
  if (!url) {
    res.status(400).json({ error: "url required" });
    return;
  }
  try {
    const preview = await fetchLinkPreview(url);
    res.json(preview);
  } catch (err: any) {
    res.status(400).json({ error: err.message || "Invalid url" });
  }
});

/**
 * POST /messages/:id/save-to-drive
 * Saves the attachment to Drive at:
 *   Nice City Homes Expansion / Chat Attachments / <YYYY-MM-DD> / <filename>
 */
router.post(
  "/messages/:id/save-to-drive",
  requireAuth,
  async (req: AuthRequest, res): Promise<void> => {
    const id = Number(req.params.id);
    if (!id) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    const [m] = await db.select().from(messagesTable).where(eq(messagesTable.id, id));
    if (!m) {
      res.status(404).json({ error: "Message not found" });
      return;
    }
    if (!m.attachmentUrl) {
      res.status(400).json({ error: "No attachment to save" });
      return;
    }
    if (m.driveSaved && m.driveUrl) {
      res.json({ success: true, driveUrl: m.driveUrl });
      return;
    }
    const filePath = safeAttachmentPath(m.attachmentUrl);
    if (!filePath) {
      res.status(400).json({ error: "Cannot resolve attachment file" });
      return;
    }
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "Attachment file missing on disk" });
      return;
    }

    try {
      const date = new Date(m.createdAt);
      const dateFolder = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
      const root = await resolveOrCreateFolderPath(["Chat Attachments"]);
      const dayFolder = await findOrCreateSubfolder(root, dateFolder);
      const filename = m.attachmentName || path.basename(filePath);
      const result = await uploadFileToDrive(
        filePath,
        filename,
        dayFolder,
        m.attachmentMime ?? "application/octet-stream",
      );

      await db
        .update(messagesTable)
        .set({ driveSaved: true, driveUrl: result.webViewLink })
        .where(eq(messagesTable.id, id));

      emit("drive_saved", { messageId: id, driveUrl: result.webViewLink });
      res.json({ success: true, driveUrl: result.webViewLink });
    } catch (err: any) {
      req.log.error({ err, id }, "Save to Drive failed");
      res.status(500).json({ error: err.message || "Save to Drive failed" });
    }
  },
);

export default router;
