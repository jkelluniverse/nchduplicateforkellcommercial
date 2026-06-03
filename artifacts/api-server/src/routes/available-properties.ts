import { Router, type IRouter } from "express";
import { eq, asc } from "drizzle-orm";
import { db, availablePropertiesTable } from "@workspace/db";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { resolveOrCreateFolderPath, uploadFileToDrive } from "../lib/google-drive";
import { buildAvailablePropertiesFilename } from "../lib/doc-filename";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";

const router: IRouter = Router();

const BACKEND_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "backend");

function mapRow(r: typeof availablePropertiesTable.$inferSelect) {
  return {
    id: r.id,
    number: r.number,
    address: r.address,
    cityStateZip: r.cityStateZip,
    beds: r.beds,
    baths: r.baths,
    notes: r.notes,
    active: r.active,
    sortOrder: r.sortOrder,
    addedAt: r.addedAt,
  };
}

/** Spawn the Python generator and resolve to the produced PDF path. */
function runPythonGenerator(properties: unknown[], outputPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const code = [
      "import json, sys",
      "sys.path.insert(0, '.')",
      "from doc_generators.gen_available_properties import generate_available_properties",
      "payload = json.loads(sys.stdin.read())",
      "out = generate_available_properties(payload['properties'], payload['output_path'])",
      "print(out)",
    ].join("\n");
    const proc = spawn("python3", ["-c", code], {
      cwd: BACKEND_DIR,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (b) => { stdout += b.toString(); });
    proc.stderr.on("data", (b) => { stderr += b.toString(); });
    proc.on("error", (err) => reject(new Error(`Failed to spawn python3: ${err.message}`)));
    proc.on("close", (exitCode) => {
      if (exitCode !== 0) {
        reject(new Error(`Python generator failed (code ${exitCode}): ${stderr || stdout}`));
        return;
      }
      const reportedPath = stdout.trim().split("\n").pop() || outputPath;
      resolve(reportedPath);
    });
    proc.stdin.write(JSON.stringify({ properties, output_path: outputPath }));
    proc.stdin.end();
  });
}

/** GET /api/available-properties — list active sorted by sort_order */
router.get("/available-properties", requireAuth, async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(availablePropertiesTable)
    .where(eq(availablePropertiesTable.active, true))
    .orderBy(asc(availablePropertiesTable.sortOrder), asc(availablePropertiesTable.id));
  res.json(rows.map(mapRow));
});

/** POST /api/available-properties — Mike or Jacob */
router.post(
  "/available-properties",
  requireAuth,
  requireRole("mike", "jacob"),
  async (req: AuthRequest, res): Promise<void> => {
    const body = (req.body ?? {}) as {
      number?: string | null;
      address?: string;
      cityStateZip?: string;
      city_state_zip?: string;
      beds?: number | null;
      baths?: number | null;
      notes?: string | null;
    };
    const address = (body.address ?? "").trim();
    const cityStateZip = (body.cityStateZip ?? body.city_state_zip ?? "").trim();
    if (!address) { res.status(400).json({ error: "address is required" }); return; }
    if (!cityStateZip) { res.status(400).json({ error: "city_state_zip is required" }); return; }

    // Append to the end of the active list.
    const [{ maxOrder }] = await db
      .select({ maxOrder: availablePropertiesTable.sortOrder })
      .from(availablePropertiesTable)
      .where(eq(availablePropertiesTable.active, true))
      .orderBy(asc(availablePropertiesTable.sortOrder))
      .limit(1)
      .then((rows) => (rows.length ? rows : [{ maxOrder: 0 }]))
      .catch(() => [{ maxOrder: 0 }]);

    const allActive = await db
      .select({ s: availablePropertiesTable.sortOrder })
      .from(availablePropertiesTable)
      .where(eq(availablePropertiesTable.active, true));
    const nextSort = allActive.length ? Math.max(...allActive.map((r) => r.s)) + 1 : 1;
    void maxOrder;

    const [created] = await db
      .insert(availablePropertiesTable)
      .values({
        number: body.number ?? null,
        address,
        cityStateZip,
        beds: body.beds ?? null,
        baths: body.baths ?? null,
        notes: body.notes ?? null,
        sortOrder: nextSort,
        active: true,
      })
      .returning();
    res.status(201).json(mapRow(created));
  },
);

/** PUT /api/available-properties/:id — Mike or Jacob */
router.put(
  "/available-properties/:id",
  requireAuth,
  requireRole("mike", "jacob"),
  async (req: AuthRequest, res): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id) || id <= 0) { res.status(400).json({ error: "Invalid id" }); return; }

    const body = (req.body ?? {}) as Record<string, unknown>;
    const updates: Partial<typeof availablePropertiesTable.$inferInsert> = {};
    if (body.number !== undefined) updates.number = body.number === null ? null : String(body.number);
    if (body.address !== undefined) {
      const v = String(body.address).trim();
      if (!v) { res.status(400).json({ error: "address cannot be empty" }); return; }
      updates.address = v;
    }
    if (body.cityStateZip !== undefined || body.city_state_zip !== undefined) {
      const raw = (body.cityStateZip ?? body.city_state_zip) as string | null;
      const v = String(raw ?? "").trim();
      if (!v) { res.status(400).json({ error: "city_state_zip cannot be empty" }); return; }
      updates.cityStateZip = v;
    }
    if (body.beds !== undefined) {
      const v = body.beds === null ? null : Number(body.beds);
      if (v !== null && (!Number.isFinite(v) || v < 0)) { res.status(400).json({ error: "Invalid beds" }); return; }
      updates.beds = v as number | null;
    }
    if (body.baths !== undefined) {
      const v = body.baths === null ? null : Number(body.baths);
      if (v !== null && (!Number.isFinite(v) || v < 0)) { res.status(400).json({ error: "Invalid baths" }); return; }
      updates.baths = v as number | null;
    }
    if (body.notes !== undefined) updates.notes = body.notes === null ? null : String(body.notes);

    if (Object.keys(updates).length === 0) { res.status(400).json({ error: "No fields to update" }); return; }

    const [updated] = await db
      .update(availablePropertiesTable)
      .set(updates)
      .where(eq(availablePropertiesTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Property not found" }); return; }
    res.json(mapRow(updated));
  },
);

/** DELETE /api/available-properties/:id — Mike or Jacob (soft delete) */
router.delete(
  "/available-properties/:id",
  requireAuth,
  requireRole("mike", "jacob"),
  async (req: AuthRequest, res): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (!Number.isFinite(id) || id <= 0) { res.status(400).json({ error: "Invalid id" }); return; }
    const [updated] = await db
      .update(availablePropertiesTable)
      .set({ active: false })
      .where(eq(availablePropertiesTable.id, id))
      .returning();
    if (!updated) { res.status(404).json({ error: "Property not found" }); return; }
    res.json({ success: true });
  },
);

/** POST /api/available-properties/reorder — Mike or Jacob.
 *  Body: { ids: number[] } — full ordered list of active property ids.
 */
router.post(
  "/available-properties/reorder",
  requireAuth,
  requireRole("mike", "jacob"),
  async (req: AuthRequest, res): Promise<void> => {
    const ids = (req.body?.ids ?? []) as unknown;
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((n) => Number.isInteger(n) && n > 0)) {
      res.status(400).json({ error: "ids must be a non-empty array of positive integers" });
      return;
    }
    const idList = ids as number[];

    // Reject duplicates so two rows can't end up with the same sort_order.
    const uniqueIds = new Set(idList);
    if (uniqueIds.size !== idList.length) {
      res.status(400).json({ error: "ids must not contain duplicates" });
      return;
    }

    // Verify the submitted ids match the current active set exactly. Prevents
    // stale clients from re-ordering a list that no longer exists.
    const activeRows = await db
      .select({ id: availablePropertiesTable.id })
      .from(availablePropertiesTable)
      .where(eq(availablePropertiesTable.active, true));
    const activeIds = new Set(activeRows.map((r) => r.id));
    if (activeIds.size !== uniqueIds.size) {
      res.status(409).json({ error: "ids do not match the current active properties — refresh and try again" });
      return;
    }
    for (const id of uniqueIds) {
      if (!activeIds.has(id)) {
        res.status(409).json({ error: "ids do not match the current active properties — refresh and try again" });
        return;
      }
    }

    // Update each row's sort_order to its 1-based position. Done in a transaction.
    await db.transaction(async (tx) => {
      for (let i = 0; i < idList.length; i++) {
        await tx
          .update(availablePropertiesTable)
          .set({ sortOrder: i + 1 })
          .where(eq(availablePropertiesTable.id, idList[i] as number));
      }
    });
    res.json({ success: true, count: idList.length });
  },
);

/** GET /api/available-properties/generate-pdf — generates, saves to Drive, returns PDF binary. */
router.get("/available-properties/generate-pdf", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const rows = await db
    .select()
    .from(availablePropertiesTable)
    .where(eq(availablePropertiesTable.active, true))
    .orderBy(asc(availablePropertiesTable.sortOrder), asc(availablePropertiesTable.id));

  const properties = rows.map((r, i) => ({
    number: r.number || String(i + 1).padStart(2, "0"),
    address: r.address,
    city_state_zip: r.cityStateZip,
    beds: r.beds ?? "",
    baths: r.baths ?? "",
    notes: r.notes || "",
  }));

  // Filename per Jacob's spec (May 2026): "NCH Available Properties - May 2026.pdf"
  const filename = buildAvailablePropertiesFilename();
  const tmpPath = path.join("/tmp", filename);

  try {
    await runPythonGenerator(properties, tmpPath);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log?.error({ err: msg }, "Failed to generate Available Properties PDF");
    res.status(500).json({ error: "Failed to generate PDF", detail: msg });
    return;
  }

  // Best-effort upload to Drive — never block download on Drive failure.
  try {
    const folderId = await resolveOrCreateFolderPath([
      "Nice City Homes Expansion",
      "Marketing",
      "Available Properties",
    ]);
    await uploadFileToDrive(tmpPath, filename, folderId);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log?.warn({ err: msg }, "Drive upload of Available Properties PDF failed (non-fatal)");
  }

  try {
    const buf = fs.readFileSync(tmpPath);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(buf);
  } finally {
    try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
  }
});

export default router;
