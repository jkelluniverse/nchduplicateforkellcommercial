import fs from "node:fs/promises";
import path from "node:path";
import { db, messagesTable } from "@workspace/db";
import { lt, isNull, and, isNotNull } from "drizzle-orm";
import { logger } from "./logger";
import { CHAT_UPLOAD_DIR } from "./chat-upload";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Soft-delete messages older than 30 days, then purge their attachment files
 * from disk if they had one.
 */
export async function cleanupOldMessages(): Promise<void> {
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS);
  try {
    const stale = await db
      .select({ id: messagesTable.id, attachmentUrl: messagesTable.attachmentUrl })
      .from(messagesTable)
      .where(and(lt(messagesTable.createdAt, cutoff), isNull(messagesTable.deletedAt)));

    if (stale.length === 0) {
      logger.debug("Chat cleanup: no stale messages");
      return;
    }

    await db
      .update(messagesTable)
      .set({ deletedAt: new Date() })
      .where(and(lt(messagesTable.createdAt, cutoff), isNull(messagesTable.deletedAt)));

    // Best-effort attachment file removal
    for (const m of stale) {
      if (!m.attachmentUrl) continue;
      // Extract local filename from URL like /api/chat-files/<filename>
      const match = m.attachmentUrl.match(/\/chat-files\/([^/?#]+)$/);
      if (!match) continue;
      const filePath = path.join(CHAT_UPLOAD_DIR, match[1]!);
      try {
        await fs.unlink(filePath);
      } catch {
        // ignore
      }
    }

    logger.info({ count: stale.length }, "Chat cleanup: soft-deleted old messages");
  } catch (err) {
    logger.error({ err }, "Chat cleanup failed");
  }
}

/**
 * Schedule daily cleanup at midnight (server time), and run immediately at startup.
 */
export function scheduleChatCleanup(): void {
  void cleanupOldMessages();

  const now = new Date();
  const nextMidnight = new Date(now);
  nextMidnight.setHours(24, 0, 0, 0);
  const msUntilMidnight = nextMidnight.getTime() - now.getTime();

  setTimeout(() => {
    void cleanupOldMessages();
    setInterval(() => {
      void cleanupOldMessages();
    }, 24 * 60 * 60 * 1000);
  }, msUntilMidnight);
}

// Suppress unused import warning (isNotNull is reserved for future use)
void isNotNull;
