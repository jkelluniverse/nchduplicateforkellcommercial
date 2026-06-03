import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { getSyncStatus } from "../lib/sheets-sync";

const router: IRouter = Router();

/**
 * Sync status payload — last successful write timestamp, queued/pending
 * count, and the most recent 10 write log entries. Returned in two shapes:
 *   - The original `/api/sync-status` shape used by the dashboard widget
 *     (lastSyncAt / pendingCount / recentLogs).
 *   - The spec'd `/api/sheets/status` shape (last_sync / pending_queue /
 *     recent_writes / connected) for external integrations.
 */
async function buildPayloads() {
  const status = await getSyncStatus();
  // `connected` reflects: credentials are configured AND the most recent
  // write attempt did not fail. We deliberately don't probe the Google API
  // here (too expensive for a status endpoint) — but consumers also get the
  // raw `recent_writes` list and `pending_queue` count to draw their own
  // conclusions.
  const credsConfigured = Boolean(
    process.env["GOOGLE_CLIENT_EMAIL"] && process.env["GOOGLE_PRIVATE_KEY"],
  );
  const lastWriteOk =
    status.recentLogs.length === 0 || status.recentLogs[0]?.status === "success";
  const connected = credsConfigured && lastWriteOk;
  return {
    legacy: status,
    spec: {
      last_sync: status.lastSyncAt,
      pending_queue: status.pendingCount,
      recent_writes: status.recentLogs,
      connected,
    },
  };
}

router.get("/sync-status", requireAuth, async (_req, res): Promise<void> => {
  const { legacy } = await buildPayloads();
  res.json(legacy);
});

router.get("/sheets/status", requireAuth, async (_req, res): Promise<void> => {
  const { spec } = await buildPayloads();
  res.json(spec);
});

export default router;
