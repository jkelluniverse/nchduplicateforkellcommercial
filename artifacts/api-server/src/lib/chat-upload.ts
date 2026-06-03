import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";

// Resolve relative to this file's directory so it works in both dev (src/) and prod (dist/)
const HERE = path.dirname(new URL(import.meta.url).pathname);
export const CHAT_UPLOAD_DIR = path.resolve(HERE, "..", "..", "uploads", "chat");

if (!fs.existsSync(CHAT_UPLOAD_DIR)) {
  fs.mkdirSync(CHAT_UPLOAD_DIR, { recursive: true });
}

function safeName(original: string): string {
  const base = path.basename(original);
  return base.replace(/[^\w.\-]+/g, "_").slice(0, 80);
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, CHAT_UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const ts = Date.now();
    const rand = crypto.randomBytes(8).toString("hex");
    const cleaned = safeName(file.originalname || "upload");
    cb(null, `${ts}-${rand}-${cleaned}`);
  },
});

// Allowed MIME types — images, audio, video, common docs. Anything else is rejected.
const ALLOWED_MIME_PREFIXES = ["image/", "audio/", "video/"];
const ALLOWED_MIME_EXACT = new Set([
  "application/pdf",
  "application/zip",
  "application/x-zip-compressed",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "text/plain",
  "text/csv",
]);

const DENIED_EXTENSIONS = new Set([
  ".html", ".htm", ".xhtml", ".svg", ".js", ".mjs", ".cjs", ".jsx",
  ".ts", ".tsx", ".php", ".phtml", ".sh", ".bat", ".exe", ".cmd",
]);

export const chatUpload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
  fileFilter: (_req, file, cb) => {
    const mime = (file.mimetype || "").toLowerCase();
    const ext = path.extname(file.originalname || "").toLowerCase();
    if (DENIED_EXTENSIONS.has(ext)) {
      cb(new Error(`File type not allowed: ${ext}`));
      return;
    }
    const allowed =
      ALLOWED_MIME_PREFIXES.some((p) => mime.startsWith(p)) || ALLOWED_MIME_EXACT.has(mime);
    if (!allowed) {
      cb(new Error(`File type not allowed: ${mime || "unknown"}`));
      return;
    }
    cb(null, true);
  },
});

export function publicUrlForFilename(filename: string): string {
  return `/api/chat-files/${encodeURIComponent(filename)}`;
}
