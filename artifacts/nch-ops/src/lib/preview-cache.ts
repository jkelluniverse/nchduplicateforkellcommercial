/**
 * Local blob cache for Drive previews, backed by IndexedDB.
 *
 * Why: the existing flow refetches a preview blob from the API every
 * time the user reopens a file, even seconds later, because nothing
 * lives in the browser between sheet open/close cycles. This cache lets
 * a warm reopen render instantly with zero network calls — even after
 * a hard page reload, since IDB is persistent.
 *
 * Keying: `${fileId}:${modifiedTime}`. When the file is edited, its
 * modifiedTime changes, the key changes, and the stale entry naturally
 * falls out of use (and is eventually evicted by the LRU sweep).
 *
 * Bounds: ~50 MB total, simple LRU by lastAccess. Files larger than
 * ~25 MB are not cached so one giant file can't blow the budget.
 *
 * All operations are best-effort — IDB failures (quota, private mode,
 * etc.) silently degrade to "no cache" so the app still works.
 */

const DB_NAME = "nch_preview_cache";
const DB_VERSION = 1;
const STORE = "blobs";

const MAX_TOTAL_BYTES = 50 * 1024 * 1024;
const MAX_FILE_BYTES = 25 * 1024 * 1024;

interface CacheRecord {
  blob: Blob;
  contentType: string;
  bytes: number;
  modifiedTime: string;
  lastAccess: number;
}

let _dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB not available"));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((err) => {
    _dbPromise = null;
    throw err;
  });
  return _dbPromise;
}

function buildKey(fileId: string, modifiedTime: string | null): string {
  return `${fileId}:${modifiedTime ?? ""}`;
}

function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getCachedPreview(
  fileId: string,
  modifiedTime: string | null,
): Promise<{ blob: Blob; contentType: string } | null> {
  try {
    const db = await openDb();
    const key = buildKey(fileId, modifiedTime);
    const tx = db.transaction(STORE, "readwrite");
    const store = tx.objectStore(STORE);
    const rec = (await reqToPromise(store.get(key))) as CacheRecord | undefined;
    if (!rec) return null;
    // Bump lastAccess so the LRU sweep keeps frequently used entries.
    store.put({ ...rec, lastAccess: Date.now() }, key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    return { blob: rec.blob, contentType: rec.contentType };
  } catch {
    return null;
  }
}

export async function putCachedPreview(
  fileId: string,
  modifiedTime: string | null,
  blob: Blob,
  contentType: string,
): Promise<void> {
  try {
    if (blob.size === 0 || blob.size > MAX_FILE_BYTES) return;
    const db = await openDb();
    const key = buildKey(fileId, modifiedTime);
    const rec: CacheRecord = {
      blob,
      contentType,
      bytes: blob.size,
      modifiedTime: modifiedTime ?? "",
      lastAccess: Date.now(),
    };
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(rec, key);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    void evictIfNeeded();
  } catch {
    // Quota exceeded, private browsing, etc. — just skip caching.
  }
}

export async function clearPreviewCache(): Promise<void> {
  try {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).clear();
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    // Best-effort: if IDB is unavailable there's nothing to clear.
  }
}

async function evictIfNeeded(): Promise<void> {
  try {
    const db = await openDb();
    const all: { key: IDBValidKey; record: CacheRecord }[] = [];

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readonly");
      const cursor = tx.objectStore(STORE).openCursor();
      cursor.onsuccess = () => {
        const c = cursor.result;
        if (c) {
          all.push({ key: c.key, record: c.value as CacheRecord });
          c.continue();
        } else {
          resolve();
        }
      };
      cursor.onerror = () => reject(cursor.error);
    });

    let total = all.reduce((sum, e) => sum + (e.record.bytes ?? 0), 0);
    if (total <= MAX_TOTAL_BYTES) return;

    all.sort((a, b) => (a.record.lastAccess ?? 0) - (b.record.lastAccess ?? 0));
    const toDelete: IDBValidKey[] = [];
    for (const e of all) {
      if (total <= MAX_TOTAL_BYTES) break;
      toDelete.push(e.key);
      total -= e.record.bytes ?? 0;
    }
    if (toDelete.length === 0) return;

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      for (const k of toDelete) store.delete(k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } catch {
    // ignore
  }
}
