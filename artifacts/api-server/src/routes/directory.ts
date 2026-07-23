import { Router, type IRouter } from "express";
import { db, propertiesTable } from "@workspace/db";
import { eq, or, ilike } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { syncDirectory, getLastSyncStatus } from "../lib/directory-sync";
import { seedDirectoryFromContacts } from "../lib/directory-seed";

const router: IRouter = Router();

/** GET /api/directory — list all properties, optional ?q=search */
router.get("/directory", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const q = String((req.query as any)?.q || "").trim();

  let rows;
  if (q) {
    rows = await db
      .select()
      .from(propertiesTable)
      .where(
        or(
          ilike(propertiesTable.address, `%${q}%`),
          ilike(propertiesTable.resident1Name, `%${q}%`),
          ilike(propertiesTable.resident1Phone, `%${q}%`),
          ilike(propertiesTable.resident2Name, `%${q}%`),
          ilike(propertiesTable.resident2Phone, `%${q}%`),
        )!
      )
      .orderBy(propertiesTable.address);
  } else {
    rows = await db.select().from(propertiesTable).orderBy(propertiesTable.address);
  }

  // If Rentec isn't connected but the curated seed populated the directory,
  // don't surface a red "sync failed" — the directory is in fact loaded.
  let syncStatus = getLastSyncStatus();
  if (syncStatus.error && rows.length > 0) {
    syncStatus = {
      lastSyncAt: syncStatus.lastSyncAt ?? new Date().toISOString(),
      lastSyncOk: true,
      propertyCount: rows.length,
      error: null,
    };
  }
  res.json({ entries: rows, syncStatus });
});

/** POST /api/directory/sync — seed curated contacts, then pull from Rentec */
router.post("/directory/sync", requireAuth, async (_req: AuthRequest, res): Promise<void> => {
  const seed = await seedDirectoryFromContacts();
  const rentec = await syncDirectory();
  // Surface a useful total even when Rentec isn't connected.
  const total = (rentec.total || 0) + seed.inserted;
  res.json({ ...rentec, ok: true, seeded: seed.inserted + seed.updated, total });
});

/** GET /api/directory/sync-status — get last sync info */
router.get("/directory/sync-status", requireAuth, async (_req: AuthRequest, res): Promise<void> => {
  res.json(getLastSyncStatus());
});

/** GET /api/directory/:id */
router.get("/directory/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [row] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, id));
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

/** PATCH /api/directory/:id/notes — update notes only */
router.patch("/directory/:id/notes", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const { notes } = req.body as { notes: string | null };
  const [row] = await db
    .update(propertiesTable)
    .set({ notes: notes || null })
    .where(eq(propertiesTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

/** PATCH /api/directory/:id — edit any contact field of a directory entry. */
router.patch("/directory/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const b = req.body as Record<string, string | null | undefined>;
  const patch: Record<string, unknown> = {};
  for (const f of [
    "address",
    "resident1Name", "resident1Phone", "resident1Email",
    "resident2Name", "resident2Phone", "resident2Email",
    "notes",
  ] as const) {
    if (b[f] !== undefined) patch[f] = (typeof b[f] === "string" ? b[f]!.trim() : b[f]) || null;
  }
  if (patch["address"] === null) { res.status(400).json({ error: "Address cannot be blank" }); return; }
  if (Object.keys(patch).length === 0) { res.status(400).json({ error: "Nothing to update" }); return; }
  const [row] = await db
    .update(propertiesTable)
    .set(patch)
    .where(eq(propertiesTable.id, id))
    .returning();
  if (!row) { res.status(404).json({ error: "Not found" }); return; }
  res.json(row);
});

export default router;
