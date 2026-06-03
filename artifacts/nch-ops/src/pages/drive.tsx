import { useState, useEffect, useRef, useCallback } from "react";
import {
  ChevronLeft, ChevronRight, Search, X, Clock, HardDrive,
  FileSpreadsheet, FileText, File, FileImage,
  MoreVertical, Maximize2, Share2, Trash2,
  AlertTriangle, Loader2,
} from "lucide-react";
import { Link } from "wouter";
import { useAuth } from "@/lib/auth";
import * as pdfjsLib from "pdfjs-dist";
import { getCachedPreview, putCachedPreview } from "@/lib/preview-cache";

// pdfjs-dist@5.x uses TC39 Stage-2 proposals that aren't yet available in
// older Chromium / WebKit versions. Polyfill them before any PDF rendering
// happens (otherwise "getOrInsertComputed is not a function" /
// "Math.sumPrecise is not a function" errors fire mid-render).
if (typeof (Map.prototype as unknown as { getOrInsertComputed?: unknown }).getOrInsertComputed !== "function") {
  Object.defineProperty(Map.prototype, "getOrInsertComputed", {
    value: function <K, V>(this: Map<K, V>, key: K, callback: (key: K) => V): V {
      if (!this.has(key)) this.set(key, callback(key));
      return this.get(key)!;
    },
    writable: true,
    configurable: true,
  });
}
if (typeof (Math as unknown as { sumPrecise?: unknown }).sumPrecise !== "function") {
  (Math as unknown as { sumPrecise: (values: Iterable<number>) => number }).sumPrecise = (values) => {
    let sum = 0;
    for (const v of values) sum += Number(v);
    return sum;
  };
}

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.mjs",
  import.meta.url,
).href;

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null;
  size: string | null;
  folderPath?: string;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
const RECENT_KEY = "nch_drive_recent_searches";
const MAX_RECENT = 8;

function authHeaders(): Record<string, string> {
  const t = localStorage.getItem("nch_token");
  return t ? { Authorization: `Bearer ${t}` } : {};
}

async function driveGet(path: string) {
  const res = await fetch(`${BASE}/api${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Drive error: ${res.status}`);
  return res.json();
}

async function fetchBlob(path: string): Promise<{ blob: Blob; contentType: string }> {
  const res = await fetch(`${BASE}/api${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Preview error: ${res.status}`);
  const blob = await res.blob();
  return { blob, contentType: res.headers.get("content-type") || blob.type };
}

/**
 * Fire low-priority prefetch warmups for the top search results so the
 * server-side metadata + scope caches are warm by the time a user taps
 * one. Uses requestIdleCallback so it never competes with rendering.
 */
function prefetchPreviewMetadata(files: DriveFile[]): void {
  const ids = files.slice(0, 5).map((f) => f.id);
  if (ids.length === 0) return;
  const headers = authHeaders();
  const run = () => {
    for (const id of ids) {
      // Best-effort, no error handling — prefetch failures are silent.
      void fetch(`${BASE}/api/drive/prefetch/${id}`, { headers }).catch(() => {});
    }
  };
  const ric = (window as unknown as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
  }).requestIdleCallback;
  if (typeof ric === "function") ric(run, { timeout: 2000 });
  else setTimeout(run, 200);
}

async function downloadWithAuth(fileId: string, filename: string): Promise<void> {
  const res = await fetch(`${BASE}/api/drive/download/${fileId}`, { headers: authHeaders() });
  if (!res.ok) throw new Error(`Download error: ${res.status}`);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function driveDelete(fileId: string): Promise<void> {
  const res = await fetch(`${BASE}/api/drive/delete/${fileId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!res.ok) throw new Error(`Delete error: ${res.status}`);
}

function getIcon(mimeType: string) {
  if (mimeType === "application/vnd.google-apps.spreadsheet")
    return <FileSpreadsheet className="w-5 h-5 text-emerald-600" />;
  if (
    mimeType === "application/vnd.google-apps.document" ||
    mimeType === "application/vnd.google-apps.presentation"
  )
    return <FileText className="w-5 h-5 text-blue-600" />;
  if (mimeType === "application/pdf")
    return <FileText className="w-5 h-5 text-red-600" />;
  if (mimeType.startsWith("image/"))
    return <FileImage className="w-5 h-5 text-purple-500" />;
  return <File className="w-5 h-5 text-gray-400" />;
}

function typeLabel(mimeType: string): string {
  const map: Record<string, string> = {
    "application/vnd.google-apps.spreadsheet": "Sheet",
    "application/vnd.google-apps.document": "Doc",
    "application/vnd.google-apps.presentation": "Slides",
    "application/pdf": "PDF",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "Word",
    "application/msword": "Word",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "Excel",
    "application/vnd.ms-excel": "Excel",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPT",
    "image/png": "PNG",
    "image/jpeg": "JPG",
    "image/heic": "HEIC",
  };
  if (mimeType.startsWith("image/")) return map[mimeType] ?? "Image";
  return map[mimeType] ?? "File";
}

function typeBadgeColor(mimeType: string): string {
  if (mimeType === "application/vnd.google-apps.spreadsheet") return "bg-emerald-100 text-emerald-800";
  if (mimeType.includes("document") || mimeType.includes("presentation") || mimeType.includes("word")) return "bg-blue-100 text-blue-800";
  if (mimeType === "application/pdf") return "bg-red-100 text-red-800";
  if (mimeType.startsWith("image/")) return "bg-purple-100 text-purple-800";
  if (mimeType.includes("excel") || mimeType.includes("spreadsheet")) return "bg-emerald-100 text-emerald-800";
  return "bg-gray-100 text-gray-700";
}

function formatDate(iso: string | null) {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  const diff = (now.getTime() - d.getTime()) / 1000;
  if (diff < 86400) return "Today";
  if (diff < 172800) return "Yesterday";
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function SkeletonCard() {
  return (
    <div className="flex items-center gap-3 p-3 rounded-2xl border bg-card animate-pulse">
      <div className="w-10 h-10 rounded-xl bg-muted shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-3.5 bg-muted rounded w-3/4" />
        <div className="h-3 bg-muted rounded w-1/2" />
      </div>
    </div>
  );
}

function FileCard({ file, onTap }: { file: DriveFile; onTap: () => void }) {
  return (
    <button
      onClick={onTap}
      className="w-full flex items-center gap-3 p-3 rounded-2xl border bg-card shadow-sm hover:shadow-md active:scale-[0.98] transition-all text-left"
    >
      <div className="shrink-0 w-10 h-10 rounded-xl bg-muted flex items-center justify-center">
        {getIcon(file.mimeType)}
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm leading-snug line-clamp-2 text-foreground">{file.name}</p>
        <div className="flex items-center gap-2 mt-1 flex-wrap">
          <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${typeBadgeColor(file.mimeType)}`}>
            {typeLabel(file.mimeType)}
          </span>
          {file.folderPath && (
            <span className="text-xs text-muted-foreground truncate max-w-[140px]">{file.folderPath}</span>
          )}
          {file.modifiedTime && (
            <span className="text-xs text-muted-foreground ml-auto shrink-0">{formatDate(file.modifiedTime)}</span>
          )}
        </div>
      </div>
    </button>
  );
}

function getTouchDistance(touches: React.TouchList): number {
  const dx = touches[0].clientX - touches[1].clientX;
  const dy = touches[0].clientY - touches[1].clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

function PinchZoomImage({ src, alt }: { src: string; alt: string }) {
  const [scale, setScale] = useState(1);
  const lastDistRef = useRef<number | null>(null);

  function onTouchStart(e: React.TouchEvent) {
    if (e.touches.length === 2) {
      lastDistRef.current = getTouchDistance(e.touches);
    }
  }

  function onTouchMove(e: React.TouchEvent) {
    if (e.touches.length === 2 && lastDistRef.current !== null) {
      const newDist = getTouchDistance(e.touches);
      const ratio = newDist / lastDistRef.current;
      setScale((s) => Math.min(5, Math.max(1, s * ratio)));
      lastDistRef.current = newDist;
    }
  }

  function onTouchEnd(e: React.TouchEvent) {
    if (e.touches.length < 2) lastDistRef.current = null;
  }

  return (
    <div
      className="w-full h-full overflow-auto flex items-center justify-center bg-black/5"
      style={{ touchAction: scale > 1 ? "none" : "auto" }}
    >
      <img
        src={src}
        alt={alt}
        style={{
          transform: `scale(${scale})`,
          transformOrigin: "center",
          transition: "transform 0.05s",
          maxWidth: "100%",
          maxHeight: "100%",
          objectFit: "contain",
        }}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onDoubleClick={() => setScale((s) => (s > 1 ? 1 : 2.5))}
        draggable={false}
      />
    </div>
  );
}

interface PdfViewerProps { blobUrl: string }

function PdfViewer({ blobUrl }: PdfViewerProps) {
  const [numPages, setNumPages] = useState(0);
  const [pageNum, setPageNum] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pdfDocRef = useRef<pdfjsLib.PDFDocumentProxy | null>(null);
  const renderTaskRef = useRef<pdfjsLib.RenderTask | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    pdfjsLib.getDocument(blobUrl).promise.then((pdf) => {
      if (cancelled) return;
      pdfDocRef.current = pdf;
      setNumPages(pdf.numPages);
      setPageNum(1);
      setLoading(false);
    }).catch((err: Error) => {
      if (cancelled) return;
      setError(err.message);
      setLoading(false);
    });

    return () => { cancelled = true; };
  }, [blobUrl]);

  useEffect(() => {
    if (!pdfDocRef.current || !canvasRef.current || loading) return;

    if (renderTaskRef.current) {
      renderTaskRef.current.cancel();
      renderTaskRef.current = null;
    }

    pdfDocRef.current.getPage(pageNum).then((page) => {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const dpr = window.devicePixelRatio || 1;
      const viewport = page.getViewport({ scale: dpr * 1.5 });
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      canvas.style.width = "100%";
      canvas.style.height = "auto";

      const task = page.render({ canvas, viewport });
      renderTaskRef.current = task;
      task.promise.catch(() => {});
    });
  }, [pageNum, loading]);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
        <Loader2 className="w-8 h-8 animate-spin" />
        <p className="text-sm">Loading PDF...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2 px-8 text-center">
        <AlertTriangle className="w-8 h-8 text-destructive" />
        <p className="text-sm font-semibold">Failed to load PDF</p>
        <p className="text-xs text-muted-foreground">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto bg-gray-100 p-2">
        <canvas ref={canvasRef} className="mx-auto rounded shadow" />
      </div>
      {numPages > 1 && (
        <div className="flex items-center justify-center gap-4 py-2 border-t bg-background shrink-0">
          <button
            onClick={() => setPageNum((p) => Math.max(1, p - 1))}
            disabled={pageNum <= 1}
            className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <span className="text-sm font-medium tabular-nums">
            Page {pageNum} of {numPages}
          </span>
          <button
            onClick={() => setPageNum((p) => Math.min(numPages, p + 1))}
            disabled={pageNum >= numPages}
            className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30 transition-colors"
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      )}
    </div>
  );
}

interface PreviewState {
  blobUrl: string | null;
  contentType: string | null;
  loading: boolean;
  error: string | null;
}

function PreviewSheet({
  file,
  isJacob,
  onClose,
  onDeleted,
}: {
  file: DriveFile;
  isJacob: boolean;
  onClose: () => void;
  onDeleted: (fileId: string) => void;
}) {
  const [preview, setPreview] = useState<PreviewState>({
    blobUrl: null,
    contentType: null,
    loading: true,
    error: null,
  });
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [fullScreen, setFullScreen] = useState(false);
  const blobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setPreview({ blobUrl: null, contentType: null, loading: true, error: null });

    const present = (blob: Blob, contentType: string) => {
      if (cancelled) return;
      const url = URL.createObjectURL(blob);
      blobUrlRef.current = url;
      setPreview({ blobUrl: url, contentType, loading: false, error: null });
    };

    // Try local cache first so a warm reopen renders without a spinner
    // and without any network call (survives hard reloads via IDB).
    (async () => {
      try {
        const hit = await getCachedPreview(file.id, file.modifiedTime);
        if (cancelled) return;
        if (hit) {
          present(hit.blob, hit.contentType);
          return;
        }
      } catch {
        // fall through to network fetch
      }

      try {
        const { blob, contentType } = await fetchBlob(`/drive/preview/${file.id}`);
        if (cancelled) return;
        // Cache for next time before presenting; IDB write is fast and
        // failures are swallowed by the cache helper.
        void putCachedPreview(file.id, file.modifiedTime, blob, contentType);
        present(blob, contentType);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Preview failed";
        setPreview({ blobUrl: null, contentType: null, loading: false, error: message });
      }
    })();

    return () => {
      cancelled = true;
      if (blobUrlRef.current) {
        URL.revokeObjectURL(blobUrlRef.current);
        blobUrlRef.current = null;
      }
    };
  }, [file.id, file.modifiedTime]);

  const isPdf = preview.contentType === "application/pdf";
  const isImage = file.mimeType.startsWith("image/");

  async function handleShare() {
    try {
      if (navigator.share && preview.blobUrl) {
        // Fetch blob from local object URL (already authenticated — no extra request)
        const raw = await fetch(preview.blobUrl).then((r) => r.blob());
        const mimeType = raw.type || preview.contentType || "application/octet-stream";
        // @ts-ignore — @types/node overrides browser File constructor in this tsconfig
        const shareFile = new File([raw], file.name, { type: mimeType });
        if (navigator.canShare?.({ files: [shareFile] })) {
          await navigator.share({ files: [shareFile], title: file.name });
          return;
        }
      }
      // canShare not supported or no blob yet — trigger authenticated download
      await downloadWithAuth(file.id, file.name);
    } catch {
      // User cancelled or share failed; fall back to download
      try { await downloadWithAuth(file.id, file.name); } catch { }
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await driveDelete(file.id);
      onDeleted(file.id);
      onClose();
    } catch (err: any) {
      alert(err.message || "Delete failed");
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  const previewContent = () => {
    if (preview.loading) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
          <Loader2 className="w-8 h-8 animate-spin" />
          <p className="text-sm">Loading preview...</p>
        </div>
      );
    }
    if (preview.error) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-2 px-8 text-center">
          <AlertTriangle className="w-8 h-8 text-destructive" />
          <p className="font-semibold text-sm">Preview unavailable</p>
          <p className="text-xs text-muted-foreground">{preview.error}</p>
        </div>
      );
    }
    if (!preview.blobUrl) return null;
    if (isImage) return <PinchZoomImage src={preview.blobUrl} alt={file.name} />;
    if (isPdf) return <PdfViewer blobUrl={preview.blobUrl} />;
    return (
      <iframe src={preview.blobUrl} title={file.name} className="w-full h-full border-0" />
    );
  };

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-[65]" onClick={onClose} />

      <div
        className="fixed inset-x-0 bottom-0 z-[70] bg-background rounded-t-2xl shadow-2xl flex flex-col"
        style={{ maxHeight: "92vh" }}
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-4 py-3 border-b shrink-0">
          <button onClick={onClose} className="p-1 -ml-1 rounded-lg hover:bg-muted">
            <X className="w-5 h-5" />
          </button>
          <p className="flex-1 font-semibold text-sm truncate text-center">{file.name}</p>
          {isJacob ? (
            <div className="relative">
              <button
                onClick={() => setMenuOpen((v) => !v)}
                className="p-1 rounded-lg hover:bg-muted"
              >
                <MoreVertical className="w-5 h-5" />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-[75]" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 top-8 z-[76] bg-card border rounded-xl shadow-lg w-44 py-1 overflow-hidden">
                    <button
                      onClick={() => { setMenuOpen(false); setConfirmDelete(true); }}
                      className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-destructive hover:bg-destructive/10"
                    >
                      <Trash2 className="w-4 h-4" />
                      Move to Trash
                    </button>
                  </div>
                </>
              )}
            </div>
          ) : (
            <div className="w-7" />
          )}
        </div>

        {/* Preview content */}
        <div className="flex-1 overflow-hidden relative min-h-0">
          {previewContent()}
        </div>

        {/* Bottom action bar */}
        <div className="flex gap-3 px-4 py-3 border-t bg-background shrink-0">
          <button
            disabled={!preview.blobUrl}
            onClick={() => setFullScreen(true)}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl border font-medium text-sm hover:bg-muted disabled:opacity-40 transition-colors"
          >
            <Maximize2 className="w-4 h-4" />
            View Full Screen
          </button>
          <button
            disabled={!preview.blobUrl && !file.id}
            onClick={handleShare}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 disabled:opacity-40 transition-colors"
          >
            <Share2 className="w-4 h-4" />
            Download Copy for print or send
          </button>
        </div>
      </div>

      {/* Full-screen overlay */}
      {fullScreen && preview.blobUrl && (
        <div className="fixed inset-0 z-[90] bg-black flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 bg-black/80 shrink-0">
            <p className="text-white text-sm font-medium truncate flex-1 pr-4">{file.name}</p>
            <button onClick={() => setFullScreen(false)} className="text-white/80 hover:text-white">
              <X className="w-6 h-6" />
            </button>
          </div>
          <div className="flex-1 overflow-hidden">
            {isImage
              ? <PinchZoomImage src={preview.blobUrl} alt={file.name} />
              : isPdf
                ? <PdfViewer blobUrl={preview.blobUrl} />
                : <iframe src={preview.blobUrl} title={file.name} className="w-full h-full border-0" />
            }
          </div>
        </div>
      )}

      {/* Delete confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center p-6 bg-black/50">
          <div className="bg-background rounded-2xl shadow-2xl p-6 w-full max-w-sm">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center shrink-0">
                <Trash2 className="w-5 h-5 text-destructive" />
              </div>
              <div>
                <p className="font-semibold">Move to Trash?</p>
                <p className="text-sm text-muted-foreground">This will move the file to Google Drive trash.</p>
              </div>
            </div>
            <p className="text-sm font-medium text-foreground bg-muted rounded-lg px-3 py-2 line-clamp-2 mb-4">
              {file.name}
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
                className="flex-1 py-2.5 rounded-xl border text-sm font-medium hover:bg-muted disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="flex-1 py-2.5 rounded-xl bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Move to Trash
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const QUICK_SEARCHES = ["Invoice", "Receipt", "Estimate", "Land Contract", "Survey", "BSMK", "2025"];

export default function Drive() {
  const { user } = useAuth();
  const isJacob = user?.role === "jacob";

  const [query, setQuery] = useState("");
  const [activeQuery, setActiveQuery] = useState("");
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([]);
  const [selectedFile, setSelectedFile] = useState<DriveFile | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
      setRecentSearches(Array.isArray(stored) ? stored : []);
    } catch {}
  }, []);

  function saveRecent(q: string) {
    setRecentSearches((prev) => {
      const updated = [q, ...prev.filter((r) => r.toLowerCase() !== q.toLowerCase())].slice(0, MAX_RECENT);
      localStorage.setItem(RECENT_KEY, JSON.stringify(updated));
      return updated;
    });
  }

  function clearRecent() {
    setRecentSearches([]);
    localStorage.removeItem(RECENT_KEY);
  }

  const runSearch = useCallback(async (term: string) => {
    if (abortRef.current) abortRef.current.abort();
    const ac = new AbortController();
    abortRef.current = ac;

    setLoading(true);
    setError(null);
    setSearched(true);
    setActiveQuery(term);

    try {
      const data = await driveGet(`/drive/search?q=${encodeURIComponent(term)}`);
      if (ac.signal.aborted) return;
      const results: DriveFile[] = data.files ?? [];
      setFiles(results);
      setLoading(false);
      // Warm the server-side metadata + scope caches for the top results
      // so the first tap feels nearly instant.
      prefetchPreviewMetadata(results);
    } catch (err: any) {
      if (ac.signal.aborted) return;
      setError(err.message || "Search failed");
      setLoading(false);
    }
  }, []);

  function handleInput(val: string) {
    setQuery(val);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = val.trim();
    if (trimmed.length >= 2) {
      debounceRef.current = setTimeout(() => {
        saveRecent(trimmed);
        runSearch(trimmed);
      }, 400);
    } else {
      setSearched(false);
      setFiles([]);
      setActiveQuery("");
    }
  }

  function applyQuery(q: string) {
    setQuery(q);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    saveRecent(q);
    runSearch(q);
    inputRef.current?.focus();
  }

  function clearSearch() {
    setQuery("");
    setActiveQuery("");
    setSearched(false);
    setFiles([]);
    setError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (abortRef.current) abortRef.current.abort();
    inputRef.current?.focus();
  }

  function handleDeleted(fileId: string) {
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
  }

  return (
    <div className="pb-24 bg-background min-h-screen">

      {/* Header */}
      <div className="bg-primary text-primary-foreground sticky top-0 z-20 shadow-lg">
        <div className="flex items-center gap-3 px-4 pt-4 pb-3">
          <Link href="/more">
            <ChevronLeft className="w-6 h-6" />
          </Link>
          <div className="flex items-center gap-2 flex-1">
            <HardDrive className="w-5 h-5 opacity-80" />
            <h1 className="text-xl font-bold">Drive Search</h1>
          </div>
        </div>

        <div className="px-4 pb-4">
          <div className="relative">
            {loading ? (
              <Loader2 className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-primary-foreground/50 animate-spin" />
            ) : (
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-primary-foreground/50" />
            )}
            <input
              ref={inputRef}
              className="w-full bg-white text-gray-900 placeholder:text-gray-400 rounded-xl pl-10 pr-10 py-3 text-base outline-none shadow-sm focus:ring-2 focus:ring-white/40"
              placeholder="Search address, client, file name..."
              value={query}
              onChange={(e) => handleInput(e.target.value)}
              autoFocus
              autoComplete="off"
              spellCheck={false}
            />
            {query && (
              <button
                onClick={clearSearch}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Body */}
      {!searched ? (
        <div className="p-4 space-y-6">
          {recentSearches.length > 0 && (
            <section>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" /> Recent
                </h2>
                <button onClick={clearRecent} className="text-xs text-muted-foreground hover:text-destructive">
                  Clear
                </button>
              </div>
              <div className="flex flex-wrap gap-2">
                {recentSearches.map((r) => (
                  <button
                    key={r}
                    onClick={() => applyQuery(r)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border bg-card text-sm hover:bg-muted transition-colors"
                  >
                    <Clock className="w-3 h-3 text-muted-foreground" />
                    {r}
                  </button>
                ))}
              </div>
            </section>
          )}

          <section>
            <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
              Quick Searches
            </h2>
            <div className="flex flex-wrap gap-2">
              {QUICK_SEARCHES.map((s) => (
                <button
                  key={s}
                  onClick={() => applyQuery(s)}
                  className="px-3 py-1.5 rounded-full border bg-card text-sm hover:bg-primary hover:text-primary-foreground transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          </section>
        </div>
      ) : (
        <div className="p-4">
          {loading && (
            <div className="space-y-2">
              {[...Array(5)].map((_, i) => <SkeletonCard key={i} />)}
            </div>
          )}

          {!loading && error && (
            <div className="text-center py-12">
              <AlertTriangle className="w-8 h-8 text-destructive mx-auto mb-2" />
              <p className="font-semibold text-destructive">Search failed</p>
              <p className="text-sm text-muted-foreground mt-1">{error}</p>
            </div>
          )}

          {!loading && !error && (
            <>
              <p className="text-xs text-muted-foreground mb-3 px-1">
                {files.length === 0
                  ? `No files found for "${activeQuery}"`
                  : `${files.length} result${files.length === 1 ? "" : "s"} for "${activeQuery}"`}
              </p>
              <div className="space-y-2">
                {files.map((file) => (
                  <FileCard
                    key={file.id}
                    file={file}
                    onTap={() => setSelectedFile(file)}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {selectedFile && (
        <PreviewSheet
          file={selectedFile}
          isJacob={isJacob}
          onClose={() => setSelectedFile(null)}
          onDeleted={handleDeleted}
        />
      )}
    </div>
  );
}
