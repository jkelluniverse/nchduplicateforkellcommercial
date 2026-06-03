import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import path from "node:path";
import fs from "node:fs";
import router from "./routes";
import { logger } from "./lib/logger";
import { CHAT_UPLOAD_DIR } from "./lib/chat-upload";
import { requireAuth } from "./middlewares/auth";

const app: Express = express();

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true }));

// Chat attachment files — auth required (Bearer header or ?token= query param).
// Non-inline-renderable types are forced to download to mitigate stored-XSS.
const INLINE_EXTENSIONS = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".heic",
  ".mp3", ".m4a", ".webm", ".ogg", ".wav",
  ".mp4", ".mov",
  ".pdf",
]);
app.get("/api/chat-files/:filename", requireAuth, (req, res) => {
  const raw = String(req.params.filename ?? "");
  const basename = path.basename(raw);
  if (basename !== raw || basename.includes("/") || basename.includes("..")) {
    res.status(400).json({ error: "Invalid filename" });
    return;
  }
  const fullPath = path.join(CHAT_UPLOAD_DIR, basename);
  if (!fullPath.startsWith(CHAT_UPLOAD_DIR + path.sep) && fullPath !== CHAT_UPLOAD_DIR) {
    res.status(400).json({ error: "Invalid path" });
    return;
  }
  if (!fs.existsSync(fullPath)) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  const ext = path.extname(basename).toLowerCase();
  res.setHeader("Cache-Control", "private, max-age=604800");
  res.setHeader("X-Content-Type-Options", "nosniff");
  if (!INLINE_EXTENSIONS.has(ext)) {
    res.setHeader("Content-Disposition", `attachment; filename="${basename}"`);
  }
  res.sendFile(fullPath, (err) => {
    if (err && !res.headersSent) {
      res.status(500).end();
    }
  });
});

app.use("/api", router);

// Global JSON error handler for /api routes.  Without this, Express's default
// handler returns an HTML "Internal Server Error" page, which our typed
// fetch client cannot parse — the client sees the HTML body and surfaces
// only "HTTP 500" with no detail, making production debugging impossible.
// This middleware logs the full error (including stack) via pino and returns
// a JSON envelope the client can render.
app.use(
  "/api",
  (
    err: Error & {
      status?: number;
      statusCode?: number;
      code?: string;
      cause?: unknown;
    },
    req: express.Request,
    res: express.Response,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _next: express.NextFunction,
  ) => {
    const status = err.status ?? err.statusCode ?? 500;
    const log = (req as express.Request & { log?: typeof logger }).log ?? logger;
    // Drizzle wraps the underlying `pg` PostgresError on `err.cause`. The
    // outer `err.message` is just `Failed query: <SQL>`, which doesn't tell
    // us why Postgres rejected the query. Unpack `cause` so logs surface
    // the real reason (e.g. `column "X" of relation "Y" does not exist`,
    // along with Postgres `code`, `detail`, `column`, `constraint`).
    const cause = err.cause as
      | (Error & {
          code?: string;
          detail?: string;
          column?: string;
          table?: string;
          constraint?: string;
          schema?: string;
          hint?: string;
        })
      | undefined;
    const causePayload = cause
      ? {
          message: cause.message,
          code: cause.code,
          detail: cause.detail,
          column: cause.column,
          table: cause.table,
          constraint: cause.constraint,
          schema: cause.schema,
          hint: cause.hint,
        }
      : undefined;
    log.error(
      {
        err: { message: err.message, stack: err.stack, code: err.code, name: err.name },
        cause: causePayload,
        method: req.method,
        url: req.originalUrl,
      },
      "API request failed",
    );
    if (res.headersSent) return;
    res.status(status).json({
      error: cause?.message || err.message || "Internal Server Error",
      code: cause?.code || err.code,
      detail: cause?.detail,
      column: cause?.column,
    });
  },
);

// Single-process production deployment (e.g. Railway): if the built React
// frontend exists alongside this compiled server, serve it for any non-/api
// route so one Node process can serve both API and SPA.
//
// On Replit the frontend is served by its own Vite dev/static service via the
// shared proxy and FRONTEND_DIST will not exist here, so this block is a
// no-op locally.
const FRONTEND_DIST = path.resolve(__dirname, "../../nch-ops/dist/public");
if (fs.existsSync(path.join(FRONTEND_DIST, "index.html"))) {
  app.use(express.static(FRONTEND_DIST));
  // SPA fallback for any non-API GET — return index.html so client-side
  // routing can take over. Express 5 requires a regex/named wildcard rather
  // than a bare "*".
  app.get(/.*/, (req, res, next) => {
    if (req.path.startsWith("/api/") || req.path === "/api") return next();
    res.sendFile(path.join(FRONTEND_DIST, "index.html"));
  });
  logger.info({ frontendDist: FRONTEND_DIST }, "Serving built frontend from Express");
}

export default app;
