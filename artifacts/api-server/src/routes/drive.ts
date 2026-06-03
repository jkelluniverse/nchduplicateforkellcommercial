import { Router, type IRouter } from "express";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import {
  searchInFolder,
  getFileMetadata,
  getFileContent,
  getRawFileContent,
  trashFile,
  isFileInFolder,
} from "../lib/google-drive";

const router: IRouter = Router();

function getNchFolder(): string {
  const id = process.env.NICE_CITY_HOMES_FOLDER_ID;
  if (!id) throw new Error("NICE_CITY_HOMES_FOLDER_ID is not set");
  return id;
}

// 60-second server-side search cache
const searchCache = new Map<string, { ts: number; data: unknown }>();
const SEARCH_TTL = 60_000;

/**
 * GET /api/drive/search?q=term
 * Search within the NCH folder and all subfolders. Returns max 30 results.
 */
router.get("/drive/search", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const q = (req.query.q as string | undefined)?.trim();
  if (!q || q.length < 2) {
    res.status(400).json({ error: "Query must be at least 2 characters" });
    return;
  }

  const cacheKey = q.toLowerCase();
  const cached = searchCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < SEARCH_TTL) {
    res.json(cached.data);
    return;
  }

  try {
    const files = await searchInFolder(getNchFolder(), q, 30);
    const result = { files, query: q, count: files.length };
    searchCache.set(cacheKey, { ts: Date.now(), data: result });
    res.json(result);
  } catch (err: any) {
    req.log.error({ err }, "Drive search failed");
    res.status(500).json({ error: err.message || "Search failed" });
  }
});

/**
 * GET /api/drive/preview/:fileId
 * Stream file content inline for in-app viewing.
 * Google Docs/Sheets/Slides → exported as PDF.
 * Office files (Word/Excel/PPT) → converted to PDF via LibreOffice.
 * Plain PDFs/images → returned as-is.
 *
 * Caching:
 * - Server-side scope and content caches make warm opens fast (and
 *   survive API server restarts via the on-disk content cache).
 * - Strong ETag of `${fileId}:${modifiedTime}` enables 304 Not Modified
 *   on revalidation, so the browser can serve repeats from its own
 *   disk cache after just a tiny revalidation round-trip.
 * - `Cache-Control: private, no-cache` stores the response but forces
 *   the browser to revalidate every time (via the ETag). We avoid
 *   `immutable` / long max-age on this stable URL because an edit
 *   would otherwise keep the browser pinned to stale bytes for the
 *   full TTL — `no-cache` keeps edits visible immediately.
 */
router.get("/drive/preview/:fileId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const fileId = req.params.fileId as string;
  try {
    const nchFolder = getNchFolder();
    const [meta, allowed] = await Promise.all([
      getFileMetadata(fileId),
      isFileInFolder(fileId, nchFolder),
    ]);

    if (!allowed) {
      res.status(403).json({ error: "File not accessible" });
      return;
    }

    const etag = `"${fileId}:${meta.modifiedTime ?? ""}"`;
    res.setHeader("ETag", etag);
    res.setHeader("Cache-Control", "private, no-cache");

    const ifNoneMatch = req.headers["if-none-match"];
    if (ifNoneMatch && ifNoneMatch === etag) {
      res.status(304).end();
      return;
    }

    const { buffer, contentType } = await getFileContent(fileId, meta.mimeType, meta.modifiedTime);
    const safeName = (meta.name || fileId).replace(/[^\w\s.\-()]/g, "_");

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(safeName)}"`);
    res.send(buffer);
  } catch (err: any) {
    req.log.error({ err, fileId }, "Drive preview failed");
    res.status(500).json({ error: err.message || "Preview failed" });
  }
});

/**
 * GET /api/drive/prefetch/:fileId
 * Lightweight no-content endpoint that warms the server-side scope
 * cache (and the descendant folder set, on the very first call) for a
 * fileId. Called from the client after a search returns, for the top
 * results — by the time the user taps one, the ancestor walk is
 * already done.
 *
 * We deliberately do NOT cache file metadata server-side (see
 * getFileMetadata in google-drive.ts), so the user's tap will still
 * pay one Drive metadata round-trip — but that's a single, small call.
 * The big saver here is the scope/ancestor walk.
 *
 * Always responds 204 even on internal failure so prefetch traffic
 * never surfaces user-visible errors.
 */
router.get("/drive/prefetch/:fileId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const fileId = req.params.fileId as string;
  try {
    const nchFolder = getNchFolder();
    await isFileInFolder(fileId, nchFolder);
  } catch (err) {
    req.log.debug({ err, fileId }, "Drive prefetch warm failed (ignored)");
  }
  res.status(204).end();
});

/**
 * GET /api/drive/download/:fileId
 * Stream file content as a download attachment (original format, not converted).
 */
router.get("/drive/download/:fileId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const fileId = req.params.fileId as string;
  try {
    const meta = await getFileMetadata(fileId);

    // Verify the file is within the NCH folder
    const allowed = await isFileInFolder(fileId, getNchFolder());
    if (!allowed) {
      res.status(403).json({ error: "File not accessible" });
      return;
    }

    const { buffer, contentType } = await getRawFileContent(fileId, meta.mimeType);
    const safeName = (meta.name || fileId).replace(/[^\w\s.\-()]/g, "_");
    const ext = contentType === "application/pdf" && !safeName.endsWith(".pdf") ? ".pdf" : "";

    res.setHeader("Content-Type", contentType);
    res.setHeader("Content-Disposition", `attachment; filename="${encodeURIComponent(safeName + ext)}"`);
    res.send(buffer);
  } catch (err: any) {
    req.log.error({ err, fileId }, "Drive download failed");
    res.status(500).json({ error: err.message || "Download failed" });
  }
});

/**
 * DELETE /api/drive/delete/:fileId
 * Move a file to trash. Jacob only. Verifies NCH folder membership.
 */
router.delete("/drive/delete/:fileId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  if (req.user?.role !== "jacob") {
    res.status(403).json({ error: "Only Jacob can delete files" });
    return;
  }

  const fileId = req.params.fileId as string;
  try {
    // Verify the file is within the NCH folder before deletion
    const allowed = await isFileInFolder(fileId, getNchFolder());
    if (!allowed) {
      res.status(403).json({ error: "File not accessible" });
      return;
    }

    await trashFile(fileId);
    searchCache.clear();
    res.json({ success: true });
  } catch (err: any) {
    req.log.error({ err, fileId }, "Drive delete failed");
    res.status(500).json({ error: err.message || "Delete failed" });
  }
});

export default router;
