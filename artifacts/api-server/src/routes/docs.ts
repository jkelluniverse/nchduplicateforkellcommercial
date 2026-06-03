import { Router, type IRouter } from "express";
import { db } from "@workspace/db";
import { docHistoryTable } from "@workspace/db";
import { desc, eq } from "drizzle-orm";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { DOC_SCHEMAS, getSchema, computeCalculated } from "../lib/doc-schemas";
import { resolveOrCreateFolderPath, uploadFileToDrive } from "../lib/google-drive";
import { buildDocFilename } from "../lib/doc-filename";
import fs from "fs";
import path from "path";
import { spawn } from "child_process";

const router: IRouter = Router();

const BACKEND_DIR = path.join(path.dirname(new URL(import.meta.url).pathname), "..", "backend");
const DOC_MAKER = path.join(BACKEND_DIR, "doc_maker.py");

/** GET /api/docs/schemas — return all document schemas */
router.get("/docs/schemas", requireAuth, (_req, res): void => {
  res.json(DOC_SCHEMAS);
});

/** GET /api/docs/static/:filename — serve a static template PDF */
router.get("/docs/static/:filename", requireAuth, (req, res): void => {
  const filename = path.basename(req.params["filename"] as string);
  const filePath = path.join(BACKEND_DIR, "doc_templates", filename);
  if (!fs.existsSync(filePath)) { res.status(404).json({ error: "File not found" }); return; }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.sendFile(filePath);
});

/** GET /api/docs/recent?limit=20 — recent generated docs for current user */
router.get("/docs/recent", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const limit = parseInt((req.query as any)?.limit || "20", 10);
  const rows = await db
    .select()
    .from(docHistoryTable)
    .orderBy(desc(docHistoryTable.generatedAt))
    .limit(limit);
  res.json(rows);
});

/** GET /api/docs/download/:id — redirect to Drive URL or serve file */
router.get("/docs/download/:id", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(req.params["id"] as string, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const [row] = await db.select().from(docHistoryTable).where(eq(docHistoryTable.id, id));
  if (!row) { res.status(404).json({ error: "Document not found" }); return; }

  if (row.driveFileId) {
    res.redirect(`https://drive.google.com/uc?export=download&id=${row.driveFileId}`);
    return;
  }

  // Regenerate PDF from stored field data
  try {
    const schema = getSchema(row.docType);
    if (!schema) { res.status(404).json({ error: "Schema not found" }); return; }
    const data = computeCalculated(schema, row.fieldData as Record<string, any>);
    const tmpFile = await generateDoc(schema.id, schema.fields, data);
    const buf = fs.readFileSync(tmpFile);
    try { fs.unlinkSync(tmpFile); } catch {}
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${row.filename}"`);
    res.send(buf);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

/** POST /api/docs/generate — generate a document */
router.post("/docs/generate", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const { doc_type, data } = req.body as { doc_type: string; data: Record<string, any> };
  if (!doc_type || !data) { res.status(400).json({ error: "doc_type and data required" }); return; }

  const schema = getSchema(doc_type);
  if (!schema) { res.status(404).json({ error: "Unknown document type" }); return; }

  const computedData = computeCalculated(schema, data);

  let tmpFile: string | null = null;
  try {
    tmpFile = await generateDoc(doc_type, schema.fields, computedData);

    // Build filename per Jacob's spec (May 2026):
    //   "<Display Name> - <property_address>_<MM-DD-YYYY>.pdf" for dated docs,
    //   "<Display Name> - <property_address>.pdf" for timeless legal docs.
    // For doc types not covered by the spec (residential_lease,
    // pre_closing_checklist, doorloop_setup_guide), fall back to the schema's
    // existing filename_pattern so we don't silently rename them.
    let filename = buildDocFilename(doc_type, computedData);
    if (!filename) {
      filename = schema.filename_pattern;
      for (const [k, v] of Object.entries(computedData)) {
        const safe = String(v).replace(/[^a-zA-Z0-9_\-]/g, "_").replace(/_+/g, "_").substring(0, 30);
        filename = filename.replace(`{${k}}`, safe);
      }
      filename = filename.replace(/\{[^}]+\}/g, "UNKNOWN") + ".pdf";
    }

    // Upload to Drive
    let driveUrl = "";
    let driveFileId = "";
    let savedMsg = "";
    try {
      const folderId = await resolveOrCreateFolderPath(schema.drive_folder.split("/"));
      const result = await uploadFileToDrive(tmpFile, filename, folderId);
      driveUrl = result.webViewLink || "";
      driveFileId = result.fileId || "";
      savedMsg = `Saved to Drive: ${schema.drive_folder}`;
    } catch (driveErr: any) {
      savedMsg = `Drive upload skipped: ${driveErr.message}`;
    }

    // Return PDF as base64 for in-app download
    const pdfBuffer = fs.readFileSync(tmpFile);
    const pdfBase64 = pdfBuffer.toString("base64");

    // Save to doc_history
    const [histRow] = await db.insert(docHistoryTable).values({
      docType: doc_type,
      docTitle: schema.title,
      generatedBy: req.user!.username,
      fieldData: computedData,
      filename,
      driveUrl,
      driveFileId,
      driveFolder: schema.drive_folder,
    }).returning();

    res.json({
      success: true,
      historyId: histRow.id,
      filename,
      driveUrl,
      driveFolder: schema.drive_folder,
      savedMsg,
      pdfBase64,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Document generation failed" });
  } finally {
    if (tmpFile) { try { fs.unlinkSync(tmpFile); } catch {} }
  }
});

/**
 * Spawn python3 doc_maker.py, pipe JSON to stdin, read PDF path from stdout.
 */
function generateDoc(docType: string, schemaFields: any[], data: Record<string, any>): Promise<string> {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({ doc_type: docType, data, schema_fields: schemaFields });

    const proc = spawn("python3", [DOC_MAKER], {
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    proc.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on("close", (code) => {
      if (code !== 0) {
        const msg = stderr.trim() || `doc_maker.py exited with code ${code}`;
        reject(new Error(msg));
        return;
      }
      const tmpPath = stdout.trim();
      if (!tmpPath) {
        reject(new Error("doc_maker.py produced no output path"));
        return;
      }
      resolve(tmpPath);
    });

    proc.on("error", (err) => {
      reject(new Error(`Failed to spawn python3: ${err.message}`));
    });

    proc.stdin.write(payload);
    proc.stdin.end();
  });
}

export default router;
