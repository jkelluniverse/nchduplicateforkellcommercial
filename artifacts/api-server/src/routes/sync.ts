import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import { hasApiKey, ping, diagnose } from "../services/rentec";
import { getLastSyncStatus } from "../lib/directory-sync";

const router: IRouter = Router();

/**
 * Sync status for the dashboard widget. Reflects the Rentec connection and the
 * last directory sync. Exposed at /api/sync-status (legacy widget shape) and at
 * /api/rentec/sync-status (spec shape).
 */
async function buildPayloads() {
  const configured = hasApiKey();
  const reachable = configured ? await ping() : false;
  const last = getLastSyncStatus();
  return {
    legacy: {
      lastSyncAt: last.lastSyncAt,
      pendingCount: 0,
      recentLogs: [] as unknown[],
    },
    spec: {
      last_sync: last.lastSyncAt,
      pending_queue: 0,
      recent_writes: [] as unknown[],
      connected: configured && reachable,
    },
  };
}

router.get("/sync-status", requireAuth, async (_req, res): Promise<void> => {
  const { legacy } = await buildPayloads();
  res.json(legacy);
});

router.get("/rentec/sync-status", requireAuth, async (_req, res): Promise<void> => {
  const { spec } = await buildPayloads();
  res.json(spec);
});

/**
 * Live Rentec connection probe — reports which auth scheme the account accepts
 * and the raw record shapes, so the integration can be matched to the account's
 * actual API. Read-only; safe to run anytime.
 */
router.get("/rentec/diag", requireAuth, async (_req, res): Promise<void> => {
  const result = await diagnose();
  res.json(result);
});

export default router;
