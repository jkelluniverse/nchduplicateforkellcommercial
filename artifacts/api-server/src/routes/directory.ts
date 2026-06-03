import { Router, type IRouter } from "express";
import { db, propertiesTable } from "@workspace/db";
import { eq, or, ilike } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { syncDirectory, getLastSyncStatus } from "../lib/directory-sync";

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

  const syncStatus = getLastSyncStatus();
  res.json({ entries: rows, syncStatus });
});

/** POST /api/directory/sync — manual sync trigger */
router.post("/directory/sync", requireAuth, async (_req: AuthRequest, res): Promise<void> => {
  const result = await syncDirectory();
  res.json(result);
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

export default router;
