import { google, drive_v3 } from "googleapis";
import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";
import { promisify } from "util";
import { logger } from "./logger";

const execFileAsync = promisify(execFile);

let _driveRead: drive_v3.Drive | null = null;
let _driveWrite: drive_v3.Drive | null = null;

function buildCredentials(): { client_email: string; private_key: string } {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;

  if (!email || !rawKey) {
    throw new Error("Google Drive credentials not configured (GOOGLE_CLIENT_EMAIL / GOOGLE_PRIVATE_KEY)");
  }

  let privateKey = rawKey;
  const jsonMatch = rawKey.match(/"private_key"\s*:\s*"([\s\S]+?)(?<!\\)"\s*[,}]?/);
  if (jsonMatch) {
    privateKey = jsonMatch[1];
  }
  privateKey = privateKey.replace(/\\n/g, "\n").trim();
  return { client_email: email, private_key: privateKey };
}

function buildAuth(scopes: string[]): InstanceType<typeof google.auth.GoogleAuth> | InstanceType<typeof google.auth.JWT> {
  const creds = buildCredentials();
  const impersonate = process.env.GOOGLE_IMPERSONATE_USER;
  if (impersonate) {
    // Domain-wide delegation: the service account acts on behalf of a real
    // user who owns storage quota. Required when writing to My Drive folders
    // (service accounts have no quota of their own).
    return new google.auth.JWT({
      email: creds.client_email,
      key: creds.private_key,
      scopes,
      subject: impersonate,
    });
  }
  return new google.auth.GoogleAuth({ credentials: creds, scopes });
}

function getDrive(): drive_v3.Drive {
  if (_driveRead) return _driveRead;
  const auth = buildAuth(["https://www.googleapis.com/auth/drive.readonly"]);
  _driveRead = google.drive({ version: "v3", auth: auth as never });
  return _driveRead;
}

export function getWriteDrive(): drive_v3.Drive {
  if (_driveWrite) return _driveWrite;
  const auth = buildAuth(["https://www.googleapis.com/auth/drive"]);
  _driveWrite = google.drive({ version: "v3", auth: auth as never });
  return _driveWrite;
}

const ROOT_FOLDER = process.env.GOOGLE_DRIVE_FOLDER_ID || "";
const NCH_FOLDER = process.env.NICE_CITY_HOMES_FOLDER_ID || "";
const SHARED_DRIVE_ID = process.env.SHARED_DRIVE_ID || "";

// Shared Drive params applied to every Drive API call. `supportsAllDrives`
// is safe to set unconditionally (it's a no-op for My Drive); the
// `driveId`/`corpora` pair is only valid on list queries when a Shared
// Drive ID is configured.
const SAD = { supportsAllDrives: true, includeItemsFromAllDrives: true } as const;
function listDriveScope(): { driveId?: string; corpora?: string } {
  return SHARED_DRIVE_ID ? { driveId: SHARED_DRIVE_ID, corpora: "drive" } : {};
}

export interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  webViewLink: string | null;
  modifiedTime: string | null;
  size: string | null;
  parents?: string[];
  folderPath?: string;
}

const FILE_FIELDS = "files(id,name,mimeType,webViewLink,modifiedTime,size,parents)";

// Caches folder name lookups to minimize API calls per request
const _folderNameCache = new Map<string, string>();

async function getFolderNameCached(folderId: string): Promise<string> {
  if (_folderNameCache.has(folderId)) return _folderNameCache.get(folderId)!;
  try {
    const drive = getDrive();
    const resp = await drive.files.get({ fileId: folderId, fields: "id,name", supportsAllDrives: true });
    const name = resp.data.name ?? folderId;
    _folderNameCache.set(folderId, name);
    return name;
  } catch {
    return folderId;
  }
}

// Short TTL cache for the per-file in-folder check. Folder-tree topology
// changes are rare (and the existing descendant cache already had a 5m
// TTL), so it's safe to memoize the boolean answer per fileId. Repeat
// previews within the window cost zero Drive round-trips.
//
// Bounded: Map iteration order is insertion order, so we evict the
// oldest entry on insert once we hit MAX_SCOPE_ENTRIES. Combined with
// the TTL, this keeps the cache size flat under high unique-fileId
// traffic.
const SCOPE_TTL = 5 * 60_000;
const MAX_SCOPE_ENTRIES = 1000;
const _scopeCache = new Map<string, { ts: number; ok: boolean }>();

function setScopeCache(fileId: string, ok: boolean, ts: number): void {
  // Re-insert to push to the most-recent position so LRU-ish eviction
  // by insertion order doesn't penalize hot fileIds.
  if (_scopeCache.has(fileId)) _scopeCache.delete(fileId);
  _scopeCache.set(fileId, { ts, ok });
  while (_scopeCache.size > MAX_SCOPE_ENTRIES) {
    const oldestKey = _scopeCache.keys().next().value;
    if (oldestKey === undefined) break;
    _scopeCache.delete(oldestKey);
  }
}

/**
 * Verify that a file is a descendant of rootFolderId.
 *
 * Fast path: lazy-load the descendant folder set of rootFolderId (cached
 * BFS) and short-circuit as soon as any walked ancestor is inside that
 * set — avoids walking all the way to the real Drive root.
 *
 * Slow path: walk the parent chain via Drive API as before.
 *
 * Result is itself cached per-fileId for SCOPE_TTL so repeat previews
 * within the cache window cost zero Drive round-trips.
 */
export async function isFileInFolder(fileId: string, rootFolderId: string): Promise<boolean> {
  if (!rootFolderId) return true; // If no root configured, allow (fail-open for dev)

  const now = Date.now();
  const cached = _scopeCache.get(fileId);
  if (cached && now - cached.ts < SCOPE_TTL) return cached.ok;

  const drive = getDrive();
  const visited = new Set<string>();
  let currentId: string | null = fileId;
  let descendantIds: Set<string> | null = null;

  while (currentId && !visited.has(currentId)) {
    if (currentId === rootFolderId) {
      setScopeCache(fileId, true, now);
      return true;
    }
    if (descendantIds && descendantIds.has(currentId)) {
      setScopeCache(fileId, true, now);
      return true;
    }
    visited.add(currentId);

    let parentList: string[] = [];
    try {
      const fileData = (await drive.files.get({ fileId: currentId, fields: "parents", supportsAllDrives: true })).data;
      parentList = (fileData.parents as string[] | undefined) ?? [];
    } catch {
      setScopeCache(fileId, false, now);
      return false;
    }

    if (parentList.length === 0) break;

    // Lazy-load the descendant set on the first hop so we can short-circuit
    // immediately if a parent is anywhere inside the NCH tree.
    if (!descendantIds) {
      try {
        descendantIds = await getDescendantFolderIds(rootFolderId);
      } catch {
        descendantIds = new Set<string>([rootFolderId]);
      }
    }

    if (parentList.some((p) => descendantIds!.has(p))) {
      setScopeCache(fileId, true, now);
      return true;
    }

    currentId = parentList[0];
  }

  setScopeCache(fileId, false, now);
  return false;
}

async function resolveFolderPath(parents: string[] | undefined, rootFolderId: string): Promise<string> {
  if (!parents || parents.length === 0) return "";
  const drive = getDrive();
  const segments: string[] = [];
  let currentId = parents[0];

  const visited = new Set<string>();
  while (currentId && currentId !== rootFolderId && !visited.has(currentId)) {
    visited.add(currentId);
    const name = await getFolderNameCached(currentId);
    segments.unshift(name);
    try {
      const resp = await drive.files.get({ fileId: currentId, fields: "parents", supportsAllDrives: true });
      const p = resp.data.parents;
      if (!p || p.length === 0) break;
      currentId = p[0];
    } catch {
      break;
    }
  }
  return segments.join(" › ");
}

export async function listFolderContents(folderId?: string): Promise<DriveFile[]> {
  const drive = getDrive();
  const folder = folderId || ROOT_FOLDER;
  if (!folder) throw new Error("No folder ID provided and GOOGLE_DRIVE_FOLDER_ID is not set");

  const resp = await drive.files.list({
    q: `'${folder}' in parents and trashed = false`,
    fields: FILE_FIELDS,
    orderBy: "name",
    pageSize: 200,
    ...SAD,
    ...listDriveScope(),
  });

  return (resp.data.files || []) as DriveFile[];
}

// Note: we intentionally do NOT cache getFileMetadata. The preview route
// uses meta.modifiedTime for both the ETag and the content cache key, so
// stale metadata would cause changed files to incorrectly serve 304 or
// stale bytes. The Drive metadata round-trip is small and fast; the big
// savings (skipping the ancestor walk, skipping the content download)
// come from _scopeCache and the preview content cache below — both of
// which remain valid in the face of a freshly fetched modifiedTime.
export async function getFileMetadata(fileId: string): Promise<DriveFile> {
  const drive = getDrive();
  const resp = await drive.files.get({
    fileId,
    fields: "id,name,mimeType,webViewLink,modifiedTime,size,parents",
    supportsAllDrives: true,
  });
  return resp.data as DriveFile;
}

export async function listSubfolders(folderId?: string): Promise<DriveFile[]> {
  const all = await listFolderContents(folderId);
  return all.filter((f) => f.mimeType === "application/vnd.google-apps.folder");
}

export async function searchDrive(
  query: string,
  opts: { mimeType?: string; pageSize?: number } = {},
): Promise<DriveFile[]> {
  const drive = getDrive();
  const escaped = query.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

  const nameClause = `name contains '${escaped}'`;
  const textClause = `fullText contains '${escaped}'`;
  const searchClause = `(${nameClause} or ${textClause})`;

  const mimeClause = opts.mimeType ? ` and mimeType = '${opts.mimeType}'` : "";
  const q = `${searchClause}${mimeClause} and trashed = false`;

  const resp = await drive.files.list({
    q,
    fields: FILE_FIELDS,
    orderBy: "modifiedTime desc",
    pageSize: opts.pageSize ?? 50,
    ...SAD,
    ...listDriveScope(),
  });

  return (resp.data.files || []) as DriveFile[];
}

// Cache of descendant folder IDs (root + all subfolders) per NCH root.
// `in ancestors` only works on Shared Drives; for My Drive we must
// enumerate the folder tree and post-filter search results by parent.
const _descendantCache = new Map<string, { ts: number; ids: Set<string> }>();
const DESCENDANT_TTL = 5 * 60_000;

async function getDescendantFolderIds(rootFolderId: string): Promise<Set<string>> {
  const cached = _descendantCache.get(rootFolderId);
  if (cached && Date.now() - cached.ts < DESCENDANT_TTL) return cached.ids;

  const drive = getDrive();
  const ids = new Set<string>([rootFolderId]);
  const queue: string[] = [rootFolderId];

  while (queue.length > 0) {
    const batch = queue.splice(0, 10);
    const batchResults = await Promise.all(
      batch.map(async (parentId) => {
        const found: string[] = [];
        let pageToken: string | undefined = undefined;
        do {
          const resp: { data: { files?: { id?: string | null; name?: string | null }[]; nextPageToken?: string | null } } =
            await drive.files.list({
              q: `'${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
              fields: "nextPageToken, files(id,name)",
              pageSize: 1000,
              pageToken,
              ...SAD,
              ...listDriveScope(),
            });
          for (const f of resp.data.files || []) {
            if (f.id) {
              found.push(f.id);
              if (f.name) _folderNameCache.set(f.id, f.name);
            }
          }
          pageToken = resp.data.nextPageToken ?? undefined;
        } while (pageToken);
        return found;
      }),
    );
    for (const found of batchResults) {
      for (const id of found) {
        if (!ids.has(id)) {
          ids.add(id);
          queue.push(id);
        }
      }
    }
  }

  _descendantCache.set(rootFolderId, { ts: Date.now(), ids });
  return ids;
}

/**
 * Search within the NCH folder and all its subfolders.
 *
 * Drive's `'<id>' in ancestors` operator only works on Shared Drives,
 * so for a My Drive root we instead enumerate every descendant folder
 * (cached BFS) and run the search as a true folder-scoped query: the
 * descendant IDs are OR'd into chunks of `'<id>' in parents` clauses,
 * each chunk dispatched in parallel and exhaustively paginated. This
 * is deterministic — every match anywhere in the folder tree is
 * considered, regardless of how many newer out-of-folder files match
 * the same term — and we then sort by modifiedTime desc and cap at
 * `maxResults`. Results include a human-readable folderPath.
 */
const PARENT_CHUNK_SIZE = 50;
const MAX_HITS_PER_CHUNK = 500;
const MAX_PARALLEL_SEARCH_CHUNKS = 4;

// Drive's Schema$File has nullable id/name/mimeType; our DriveFile is the
// loose shape used elsewhere in this file. Centralize the conversion so the
// loosening lives in exactly one place.
function toDriveFile(f: drive_v3.Schema$File): DriveFile {
  return {
    id: f.id ?? "",
    name: f.name ?? "",
    mimeType: f.mimeType ?? "",
    webViewLink: f.webViewLink ?? null,
    modifiedTime: f.modifiedTime ?? null,
    size: f.size ?? null,
    parents: f.parents ?? undefined,
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const idx = nextIndex++;
      if (idx >= items.length) return;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(runners);
  return results;
}

export async function searchInFolder(
  folderId: string,
  term: string,
  maxResults = 30,
): Promise<DriveFile[]> {
  const drive = getDrive();
  const escaped = term.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

  const descendantIds = Array.from(await getDescendantFolderIds(folderId));
  const baseClause = [
    `(name contains '${escaped}' or fullText contains '${escaped}')`,
    `mimeType != 'application/vnd.google-apps.folder'`,
    `trashed = false`,
  ].join(" and ");

  // Chunk descendant folder IDs into OR'd `in parents` groups so the query
  // stays well within Drive's URL length limit while still being exhaustive.
  const chunks: string[][] = [];
  for (let i = 0; i < descendantIds.length; i += PARENT_CHUNK_SIZE) {
    chunks.push(descendantIds.slice(i, i + PARENT_CHUNK_SIZE));
  }

  // Bounded concurrency to avoid hammering Drive / hitting rate limits on
  // large folder trees, while still benefiting from parallelism.
  const perChunk = await mapWithConcurrency(chunks, MAX_PARALLEL_SEARCH_CHUNKS, async (chunk) => {
    const parentsClause = chunk.map((id) => `'${id}' in parents`).join(" or ");
    const q = `${baseClause} and (${parentsClause})`;
    const collected: DriveFile[] = [];
    let pageToken: string | undefined = undefined;
    do {
      const params: drive_v3.Params$Resource$Files$List = {
        q,
        fields: `nextPageToken, ${FILE_FIELDS}`,
        orderBy: "modifiedTime desc",
        pageSize: 200,
        ...SAD,
        ...listDriveScope(),
      };
      if (pageToken) params.pageToken = pageToken;
      const resp = await drive.files.list(params);
      for (const f of resp.data.files || []) collected.push(toDriveFile(f));
      pageToken = resp.data.nextPageToken ?? undefined;
      if (collected.length >= MAX_HITS_PER_CHUNK) break;
    } while (pageToken);
    return collected;
  });

  // Merge, dedupe, sort by modifiedTime desc, cap.
  const seen = new Set<string>();
  const merged: DriveFile[] = [];
  for (const list of perChunk) {
    for (const f of list) {
      if (f.id && !seen.has(f.id)) {
        seen.add(f.id);
        merged.push(f);
      }
    }
  }
  merged.sort((a, b) => {
    const ta = a.modifiedTime ? Date.parse(a.modifiedTime) : 0;
    const tb = b.modifiedTime ? Date.parse(b.modifiedTime) : 0;
    return tb - ta;
  });
  const top = merged.slice(0, maxResults);

  // Resolve human-readable folder paths in parallel
  const resolved = await Promise.all(
    top.map(async (file) => ({
      ...file,
      folderPath: await resolveFolderPath(file.parents, folderId),
    })),
  );

  return resolved;
}

export interface FileContent {
  buffer: Buffer;
  contentType: string;
  filename: string;
}

const GOOGLE_DOC_EXPORTS: Record<string, string> = {
  "application/vnd.google-apps.document":     "application/pdf",
  "application/vnd.google-apps.spreadsheet":  "application/pdf",
  "application/vnd.google-apps.presentation": "application/pdf",
  "application/vnd.google-apps.drawing":      "application/pdf",
};

const OFFICE_EXTENSIONS: Record<string, string> = {
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.ms-powerpoint": "ppt",
};

// =============================================================
// Preview content cache (warm opens are near-instant)
// =============================================================
//
// Stores PDF/image/converted-Office bytes by fileId. Each entry remembers
// its source modifiedTime, so callers validate freshness against the
// current Drive metadata: if it changed, the entry is treated as a miss
// and replaced.
//
// In-memory layer is bounded LRU on total bytes. A best-effort on-disk
// copy under os.tmpdir() lets the cache survive API server restarts —
// after a restart the in-memory index is rehydrated from disk and
// buffers are loaded lazily on first hit.
//
// Per-file size cap prevents one giant file from evicting the entire
// working set.

const PREVIEW_DISK_DIR = path.join(os.tmpdir(), "nch_preview_cache");
const MAX_PREVIEW_FILE_BYTES = 25 * 1024 * 1024;
const MAX_PREVIEW_MEM_BYTES = 100 * 1024 * 1024;
const MAX_PREVIEW_DISK_BYTES = 200 * 1024 * 1024;

interface PreviewCacheEntry {
  buffer: Buffer | null; // null = on-disk only, will be loaded lazily
  contentType: string;
  sizeBytes: number;
  modifiedTime: string;
  diskPath: string | null;
  lastAccess: number;
}

const _previewCache = new Map<string, PreviewCacheEntry>();
let _previewMemBytes = 0;

function diskFilenames(fileId: string, modifiedTime: string): { bin: string; meta: string } {
  const safe = modifiedTime.replace(/[^0-9A-Za-z]/g, "_");
  const base = path.join(PREVIEW_DISK_DIR, `${fileId}__${safe}`);
  return { bin: `${base}.bin`, meta: `${base}.meta.json` };
}

function rmDiskEntry(diskPath: string | null): void {
  if (!diskPath) return;
  try {
    fs.rmSync(diskPath, { force: true });
    fs.rmSync(diskPath.replace(/\.bin$/, ".meta.json"), { force: true });
  } catch {
    // ignore
  }
}

let _previewDiskHydrated = false;
function hydratePreviewCacheFromDisk(): void {
  if (_previewDiskHydrated) return;
  _previewDiskHydrated = true;
  try {
    fs.mkdirSync(PREVIEW_DISK_DIR, { recursive: true });
    const entries = fs.readdirSync(PREVIEW_DISK_DIR);
    for (const name of entries) {
      if (!name.endsWith(".meta.json")) continue;
      const metaPath = path.join(PREVIEW_DISK_DIR, name);
      try {
        const raw = fs.readFileSync(metaPath, "utf8");
        const m = JSON.parse(raw) as {
          fileId: string;
          modifiedTime: string;
          contentType: string;
          sizeBytes: number;
        };
        const { bin } = diskFilenames(m.fileId, m.modifiedTime);
        if (!fs.existsSync(bin)) {
          fs.rmSync(metaPath, { force: true });
          continue;
        }
        const stat = fs.statSync(bin);
        const existing = _previewCache.get(m.fileId);
        // If multiple disk entries exist for the same fileId (different
        // modifiedTime values), keep the newest by modifiedTime string
        // and discard the rest.
        if (existing) {
          if (existing.modifiedTime >= m.modifiedTime) {
            fs.rmSync(bin, { force: true });
            fs.rmSync(metaPath, { force: true });
            continue;
          }
          rmDiskEntry(existing.diskPath);
        }
        _previewCache.set(m.fileId, {
          buffer: null,
          contentType: m.contentType,
          sizeBytes: stat.size,
          modifiedTime: m.modifiedTime,
          diskPath: bin,
          lastAccess: stat.mtimeMs,
        });
      } catch {
        // skip malformed entry
      }
    }
  } catch {
    // disk unusable; proceed with memory-only caching
  }
}

function evictPreviewMemIfNeeded(): void {
  if (_previewMemBytes <= MAX_PREVIEW_MEM_BYTES) return;
  const entries = Array.from(_previewCache.entries())
    .filter(([, e]) => e.buffer !== null)
    .sort((a, b) => a[1].lastAccess - b[1].lastAccess);
  for (const [, e] of entries) {
    if (_previewMemBytes <= MAX_PREVIEW_MEM_BYTES) break;
    if (e.buffer) {
      _previewMemBytes -= e.sizeBytes;
      e.buffer = null; // drop from memory; disk copy (if any) remains
    }
  }
}

function evictPreviewDiskIfNeeded(): void {
  let total = 0;
  for (const e of _previewCache.values()) {
    if (e.diskPath) total += e.sizeBytes;
  }
  if (total <= MAX_PREVIEW_DISK_BYTES) return;
  const entries = Array.from(_previewCache.entries())
    .filter(([, e]) => e.diskPath !== null)
    .sort((a, b) => a[1].lastAccess - b[1].lastAccess);
  for (const [k, e] of entries) {
    if (total <= MAX_PREVIEW_DISK_BYTES) break;
    if (e.diskPath) {
      rmDiskEntry(e.diskPath);
      total -= e.sizeBytes;
      e.diskPath = null;
      if (e.buffer === null) _previewCache.delete(k);
    }
  }
}

function readPreviewFromCache(
  fileId: string,
  modifiedTime: string | null,
): { buffer: Buffer; contentType: string } | null {
  hydratePreviewCacheFromDisk();
  const entry = _previewCache.get(fileId);
  if (!entry) return null;
  if (entry.modifiedTime !== (modifiedTime ?? "")) return null;

  let buffer = entry.buffer;
  if (!buffer && entry.diskPath) {
    try {
      buffer = fs.readFileSync(entry.diskPath);
      entry.buffer = buffer;
      _previewMemBytes += entry.sizeBytes;
    } catch {
      _previewCache.delete(fileId);
      return null;
    }
  }
  if (!buffer) return null;

  entry.lastAccess = Date.now();
  evictPreviewMemIfNeeded();
  return { buffer, contentType: entry.contentType };
}

function writePreviewToCache(
  fileId: string,
  modifiedTime: string | null,
  buffer: Buffer,
  contentType: string,
): void {
  hydratePreviewCacheFromDisk();
  if (buffer.length > MAX_PREVIEW_FILE_BYTES) return;

  const mt = modifiedTime ?? "";

  // Drop any older entry for this fileId (likely a different modifiedTime
  // we're now superseding) before installing the new one.
  const existing = _previewCache.get(fileId);
  if (existing) {
    if (existing.buffer) _previewMemBytes -= existing.sizeBytes;
    rmDiskEntry(existing.diskPath);
    _previewCache.delete(fileId);
  }

  const entry: PreviewCacheEntry = {
    buffer,
    contentType,
    sizeBytes: buffer.length,
    modifiedTime: mt,
    diskPath: null,
    lastAccess: Date.now(),
  };
  _previewCache.set(fileId, entry);
  _previewMemBytes += buffer.length;

  // Best-effort on-disk persistence so warm opens survive restarts.
  try {
    fs.mkdirSync(PREVIEW_DISK_DIR, { recursive: true });
    const { bin, meta } = diskFilenames(fileId, mt);
    fs.writeFileSync(bin, buffer);
    fs.writeFileSync(
      meta,
      JSON.stringify({ fileId, modifiedTime: mt, contentType, sizeBytes: buffer.length }),
    );
    entry.diskPath = bin;
  } catch {
    // memory-only is still valid
  }

  evictPreviewMemIfNeeded();
  evictPreviewDiskIfNeeded();
}

// Hydrate the on-disk preview cache index at module load so the very
// first preview after a server restart can hit the cache without paying
// the discovery cost on its critical path.
hydratePreviewCacheFromDisk();

async function convertWithSoffice(inputBuffer: Buffer, ext: string): Promise<Buffer> {
  const tmpDir = os.tmpdir();
  const inputPath = path.join(tmpDir, `nch_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
  const expectedPdf = inputPath.replace(`.${ext}`, ".pdf");

  fs.writeFileSync(inputPath, inputBuffer);
  try {
    await execFileAsync("soffice", [
      "--headless",
      "--convert-to", "pdf",
      "--outdir", tmpDir,
      inputPath,
    ], { timeout: 30_000 });
    const pdfBuffer = fs.readFileSync(expectedPdf);
    return pdfBuffer;
  } finally {
    fs.rmSync(inputPath, { force: true });
    fs.rmSync(expectedPdf, { force: true });
  }
}

function previewFilename(fileId: string, contentType: string): string {
  return contentType === "application/pdf" ? `${fileId}.pdf` : fileId;
}

/**
 * Download a file from Drive and return its binary content for preview.
 * - Google Workspace files (Docs/Sheets/Slides) → exported as PDF via Drive API
 * - Office files (Word/Excel/PowerPoint) → converted to PDF via LibreOffice
 * - All other files (PDFs, images, etc.) → returned as-is
 *
 * Result is cached (in-memory + on-disk) by fileId, validated against
 * the source modifiedTime. PDFs and images are now cached too — not just
 * converted Office/Google files.
 */
export async function getFileContent(
  fileId: string,
  mimeType: string,
  modifiedTime?: string | null,
): Promise<FileContent> {
  const cached = readPreviewFromCache(fileId, modifiedTime ?? null);
  if (cached) {
    return {
      buffer: cached.buffer,
      contentType: cached.contentType,
      filename: previewFilename(fileId, cached.contentType),
    };
  }

  const drive = getDrive();
  const exportMime = GOOGLE_DOC_EXPORTS[mimeType];
  const officeExt = OFFICE_EXTENSIONS[mimeType];

  if (exportMime) {
    const resp = await drive.files.export(
      { fileId, mimeType: exportMime },
      { responseType: "arraybuffer" },
    );
    const buffer = Buffer.from(resp.data as ArrayBuffer);
    writePreviewToCache(fileId, modifiedTime ?? null, buffer, exportMime);
    return { buffer, contentType: exportMime, filename: `${fileId}.pdf` };
  }

  // Download binary content (used for both Office conversion and raw download)
  const rawResp = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" },
  );
  const rawBuffer = Buffer.from(rawResp.data as ArrayBuffer);

  if (officeExt) {
    try {
      const pdfBuffer = await convertWithSoffice(rawBuffer, officeExt);
      writePreviewToCache(fileId, modifiedTime ?? null, pdfBuffer, "application/pdf");
      return { buffer: pdfBuffer, contentType: "application/pdf", filename: `${fileId}.pdf` };
    } catch {
      // If conversion fails, return original binary (browser will handle or show error).
      // Don't cache the failure — next attempt should re-try LibreOffice.
      return { buffer: rawBuffer, contentType: mimeType || "application/octet-stream", filename: fileId };
    }
  }

  // Plain PDFs, images, and other binary previews: now cached too so a
  // warm reopen doesn't re-download from Drive.
  const contentType = mimeType || "application/octet-stream";
  writePreviewToCache(fileId, modifiedTime ?? null, rawBuffer, contentType);
  return { buffer: rawBuffer, contentType, filename: fileId };
}

/**
 * Download a file in its original format (for download/share, not preview).
 */
export async function getRawFileContent(fileId: string, mimeType: string): Promise<FileContent> {
  const drive = getDrive();
  const exportMime = GOOGLE_DOC_EXPORTS[mimeType];

  if (exportMime) {
    const resp = await drive.files.export(
      { fileId, mimeType: exportMime },
      { responseType: "arraybuffer" },
    );
    return {
      buffer: Buffer.from(resp.data as ArrayBuffer),
      contentType: exportMime,
      filename: `${fileId}.pdf`,
    };
  }

  const resp = await drive.files.get(
    { fileId, alt: "media", supportsAllDrives: true },
    { responseType: "arraybuffer" },
  );
  return {
    buffer: Buffer.from(resp.data as ArrayBuffer),
    contentType: mimeType || "application/octet-stream",
    filename: fileId,
  };
}

/**
 * Move a file to trash (requires write scope).
 */
export async function trashFile(fileId: string): Promise<void> {
  const drive = getWriteDrive();
  await drive.files.update({
    fileId,
    requestBody: { trashed: true },
    supportsAllDrives: true,
  });
}

async function findSubfolder(parentId: string, name: string): Promise<string | null> {
  const drive = getWriteDrive();
  const escaped = name.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  const resp = await drive.files.list({
    q: `'${parentId}' in parents and name = '${escaped}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
    fields: "files(id,name)",
    pageSize: 5,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });
  const files = resp.data.files || [];
  return files.length > 0 ? files[0].id! : null;
}

export async function findOrCreateSubfolder(parentId: string, name: string): Promise<string> {
  const existing = await findSubfolder(parentId, name);
  if (existing) return existing;

  const drive = getWriteDrive();
  const created = await drive.files.create({
    requestBody: {
      name,
      mimeType: "application/vnd.google-apps.folder",
      parents: [parentId],
    },
    fields: "id",
    supportsAllDrives: true,
  });

  return created.data.id!;
}

export async function resolveOrCreateFolderPath(segments: string[]): Promise<string> {
  if (!ROOT_FOLDER) throw new Error("GOOGLE_DRIVE_FOLDER_ID is not set");
  let current = ROOT_FOLDER;
  for (const segment of segments) {
    current = await findOrCreateSubfolder(current, segment);
  }
  return current;
}

export async function resolveOrCreateNchFolderPath(segments: string[]): Promise<string> {
  const root = NCH_FOLDER || ROOT_FOLDER;
  if (!root) throw new Error("NICE_CITY_HOMES_FOLDER_ID is not set");
  let current = root;
  for (const segment of segments) {
    current = await findOrCreateSubfolder(current, segment);
  }
  return current;
}

export interface UploadResult {
  fileId: string;
  webViewLink: string;
  filename: string;
}

export async function uploadFileToDrive(
  localPath: string,
  filename: string,
  parentFolderId: string,
  mimeType = "application/pdf",
): Promise<UploadResult> {
  const drive = getWriteDrive();

  const resp = await drive.files.create(
    {
      requestBody: {
        name: filename,
        mimeType,
        parents: [parentFolderId],
      },
      media: {
        mimeType,
        body: fs.createReadStream(localPath),
      },
      fields: "id,webViewLink",
      supportsAllDrives: true,
    },
    {
      onUploadProgress: () => {},
    },
  );

  const fileId = resp.data.id!;
  const webViewLink = resp.data.webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`;

  try {
    await drive.permissions.create({
      fileId,
      requestBody: { role: "reader", type: "anyone" },
      supportsAllDrives: true,
    });
  } catch {
    // Non-fatal
  }

  return { fileId, webViewLink, filename };
}

export async function getFolderName(folderId: string): Promise<string> {
  return getFolderNameCached(folderId);
}

export async function uploadBase64ToDrive(
  base64: string,
  filename: string,
  folderPath?: string[],
  explicitFolderId?: string,
): Promise<string | null> {
  try {
    if (!process.env.GOOGLE_CLIENT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
      logger.error({ filename }, "Drive upload failed: GOOGLE_CLIENT_EMAIL or GOOGLE_PRIVATE_KEY not set");
      return null;
    }
    if (!explicitFolderId && folderPath && !NCH_FOLDER && !ROOT_FOLDER) {
      logger.error({ filename, folderPath }, "Drive upload failed: NICE_CITY_HOMES_FOLDER_ID not set");
      return null;
    }

    const { Readable } = await import("stream");
    // An explicit folder id (already resolved by the caller) wins — used by the
    // eviction flow to file documents under its own dedicated Drive folder.
    const folderId = explicitFolderId
      ? explicitFolderId
      : folderPath
        ? await resolveOrCreateNchFolderPath(folderPath)
        : await resolveOrCreateFolderPath(["Receipts"]);
    const drive = getWriteDrive();

    const mimeMatch = base64.match(/^data:([a-zA-Z0-9+/]+\/[a-zA-Z0-9+/]+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : "image/jpeg";
    const raw = base64.replace(/^data:[^;]+;base64,/, "");
    const buffer = Buffer.from(raw, "base64");
    const stream = Readable.from(buffer);

    const resp = await drive.files.create(
      {
        requestBody: { name: filename, mimeType, parents: [folderId] },
        media: { mimeType, body: stream },
        fields: "id,webViewLink",
        supportsAllDrives: true,
      },
      { onUploadProgress: () => {} },
    );

    const fileId = resp.data.id!;
    const webViewLink = resp.data.webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`;

    try {
      await drive.permissions.create({
        fileId,
        requestBody: { role: "reader", type: "anyone" },
      });
    } catch (permErr: any) {
      logger.warn({ filename, fileId, err: String(permErr?.message ?? permErr) }, "Drive permission grant failed (non-fatal)");
    }

    logger.info({ filename, fileId, folderPath }, "Drive upload succeeded");
    return webViewLink;
  } catch (err: any) {
    logger.error(
      {
        filename,
        folderPath,
        err: String(err?.message ?? err),
        stack: err?.stack,
      },
      "Drive upload failed",
    );
    return null;
  }
}
