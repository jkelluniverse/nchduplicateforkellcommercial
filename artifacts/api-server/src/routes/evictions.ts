/**
 * Eviction Tracking — case files attached to a property that move through
 * stages (notice → court → hearing → judgment → vacated → closed), store legal
 * documents in Drive, generate a court-ready account-balance statement, and let
 * Jacob write off uncollectible balances. Mutations are jacob-only.
 */
import { Router, type IRouter } from "express";
import { eq, and, desc, inArray, sql } from "drizzle-orm";
import {
  db,
  evictionCasesTable,
  evictionDocumentsTable,
  evictionTimelineTable,
  rentStatusOverridesTable,
} from "@workspace/db";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { notifyUser } from "../lib/web-push";
import { uploadFileToDrive, uploadBase64ToDrive, getWriteDrive, getFileMetadata, getRawFileContent, findOrCreateSubfolder } from "../lib/google-drive";
import { getPropertyLedger } from "../services/property-ledger";
import { sendEmailWithAttachments } from "../lib/email";
import { generateAccountBalance, type AccountBalanceTxn } from "../lib/pdf-generator";
import { getLeases, getTenantLedger, getCurrentRenterIdForProperty, hasToken } from "../services/rentec";
import { logger } from "../lib/logger";
import fs from "fs";

const router: IRouter = Router();
const APP_URL = process.env.APP_URL || "https://app.kellcommercial.com";
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

const ATTORNEY_EMAIL = process.env.ATTORNEY_EMAIL || "drew@dgonyiaslaw.com";
const ATTORNEY_NAME = process.env.ATTORNEY_NAME || "Drew Gonyias";
const JACOB_EMAIL = process.env.ADMIN_EMAIL || "admin@kellcommercial.com";
// Kell's land-contracts Drive folder (for auto-finding a property's contract).
// No default — auto-find is simply disabled until LAND_CONTRACTS_FOLDER_ID is
// configured for Kell (never point at NCH's folder).
const LAND_CONTRACTS_FOLDER_ID = process.env.LAND_CONTRACTS_FOLDER_ID || "";

// Dedicated Drive folder for Kell eviction case documents. Defaults to the
// Kell/Dad's-portfolio folder Jacob placed in the (impersonated) Google account;
// override with EVICTION_DRIVE_FOLDER_ID. Eviction docs are filed as
// <this folder>/Evictions/<property address>.
const EVICTION_DRIVE_FOLDER_ID =
  process.env.EVICTION_DRIVE_FOLDER_ID || "1Wq0VQOi3Vb57Ij0oHyxljyADapBgr2DY";

/** Resolve (creating if needed) the Drive folder for one property's eviction docs. */
async function evictionFolderFor(propertyAddress: string): Promise<string> {
  let cur = await findOrCreateSubfolder(EVICTION_DRIVE_FOLDER_ID, "Evictions");
  cur = await findOrCreateSubfolder(cur, propertyAddress);
  return cur;
}

const OHIO_HOLIDAYS = [
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25",
  "2026-07-03", "2026-07-04", "2026-09-07", "2026-10-12",
  "2026-11-11", "2026-11-26", "2026-12-25",
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-05-31",
  "2027-07-05", "2027-09-06", "2027-11-11", "2027-11-25", "2027-12-24",
];
const iso = (d: Date) => d.toISOString().split("T")[0];

/** 3-Day Notice — 3 business days, skip day of service, no weekends/holidays. */
function calculate3DayExpiry(postingDate: Date): Date {
  let count = 0;
  const current = new Date(postingDate);
  current.setDate(current.getDate() + 1);
  while (count < 3) {
    const dow = current.getDay();
    if (dow !== 0 && dow !== 6 && !OHIO_HOLIDAYS.includes(iso(current))) count++;
    if (count < 3) current.setDate(current.getDate() + 1);
  }
  return current;
}
/** 10-Day Notice — calendar days; extend past Sunday/holiday. */
function calculate10DayExpiry(postingDate: Date): Date {
  const expiry = new Date(postingDate);
  expiry.setDate(expiry.getDate() + 10);
  while (expiry.getDay() === 0 || OHIO_HOLIDAYS.includes(iso(expiry))) {
    expiry.setDate(expiry.getDate() + 1);
  }
  return expiry;
}
function computeExpiry(noticeFiledDate: string | null, noticeType: string | null): string | null {
  if (!noticeFiledDate) return null;
  const d = new Date(`${noticeFiledDate}T00:00:00`);
  if (isNaN(d.getTime())) return null;
  return iso(noticeType === "10_day" ? calculate10DayExpiry(d) : calculate3DayExpiry(d));
}

/** How far along the notice period is — days elapsed since posting and whether
 *  the required duration has fully passed. No hard expiration: it's fine to wait
 *  longer before filing. */
function noticePeriodStatus(noticeFiledDate: string | null, noticeType: string | null): { requiredDays: number; daysPassed: number; periodComplete: boolean; isBusinessDays: boolean } {
  const is10 = noticeType === "10_day";
  const requiredDays = is10 ? 10 : 3;
  if (!noticeFiledDate) return { requiredDays, daysPassed: 0, periodComplete: false, isBusinessDays: !is10 };
  const filed = new Date(`${noticeFiledDate}T00:00:00`);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (isNaN(filed.getTime())) return { requiredDays, daysPassed: 0, periodComplete: false, isBusinessDays: !is10 };
  let daysPassed: number;
  if (is10) {
    daysPassed = Math.max(0, Math.floor((today.getTime() - filed.getTime()) / 86400000));
  } else {
    let count = 0;
    const cur = new Date(filed); cur.setDate(cur.getDate() + 1);
    while (cur.getTime() <= today.getTime()) {
      const dow = cur.getDay();
      if (dow !== 0 && dow !== 6 && !OHIO_HOLIDAYS.includes(iso(cur))) count++;
      cur.setDate(cur.getDate() + 1);
    }
    daysPassed = count;
  }
  const exp = computeExpiry(noticeFiledDate, noticeType);
  const periodComplete = exp ? today.getTime() >= new Date(`${exp}T00:00:00`).getTime() : false;
  return { requiredDays, daysPassed, periodComplete, isBusinessDays: !is10 };
}

/** Search the Land Contracts Drive folder for a property's contract. */
async function findContractInDrive(propertyAddress: string): Promise<{ fileId: string; fileName: string; webViewLink: string } | null> {
  if (!LAND_CONTRACTS_FOLDER_ID) return null; // auto-find disabled until configured
  try {
    const head = propertyAddress.split(",")[0].trim();
    const streetNum = head.split(" ")[0] ?? "";
    const streetName = head.split(" ")[1] ?? "";
    const drive = getWriteDrive();
    const tryTerm = async (term: string) => {
      if (!term) return null;
      const esc = term.replace(/'/g, "\\'");
      const res = await drive.files.list({
        supportsAllDrives: true, includeItemsFromAllDrives: true,
        q: `'${LAND_CONTRACTS_FOLDER_ID}' in parents and name contains '${esc}' and trashed = false`,
        fields: "files(id,name,webViewLink,mimeType)", orderBy: "modifiedTime desc",
      });
      return res.data.files?.[0] ?? null;
    };
    const f = (await tryTerm(streetNum)) ?? (await tryTerm(streetName));
    if (!f?.id) return null;
    return { fileId: f.id, fileName: f.name ?? "Land Contract", webViewLink: f.webViewLink ?? `https://drive.google.com/file/d/${f.id}/view` };
  } catch (err) {
    logger.warn({ err }, "findContractInDrive failed");
    return null;
  }
}

async function autoFindContract(caseId: number, address: string): Promise<void> {
  const found = await findContractInDrive(address);
  if (found) {
    await db.update(evictionCasesTable).set({
      contractDriveUrl: found.webViewLink, contractDriveFileId: found.fileId, contractFoundAt: new Date(),
    }).where(eq(evictionCasesTable.id, caseId));
  }
}

/** Are the notice + balance documents present? (from eviction_documents) */
async function caseDocPresence(caseId: number): Promise<{ notice: { fileId: string | null } | null; balance: { fileId: string | null } | null }> {
  const docs = await db.select().from(evictionDocumentsTable).where(eq(evictionDocumentsTable.evictionCaseId, caseId)).orderBy(desc(evictionDocumentsTable.uploadedAt));
  const notice = docs.find((d) => ["notice_3day", "notice_10day", "notice", "notice_posted"].includes(d.documentType)) ?? null;
  const balance = docs.find((d) => d.documentType === "account_balance") ?? null;
  return {
    notice: notice ? { fileId: notice.driveFileId } : null,
    balance: balance ? { fileId: balance.driveFileId } : null,
  };
}

const STAGE_LABEL: Record<string, string> = {
  notice_filed: "Notice Filed",
  awaiting_court_date: "Awaiting Court Date",
  court_date_set: "Court Date Set",
  hearing_complete: "Hearing Complete",
  judgment_issued: "Judgment Issued",
  vacated: "Vacated",
  closed: "Closed",
  dismissed: "Dismissed",
};

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[2]}/${m[3]}/${m[1]}` : iso;
}
function todayMMDDYYYY(): string {
  const d = new Date();
  return `${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}-${d.getFullYear()}`;
}

async function addTimeline(caseId: number, stage: string, notes: string | null, by: string): Promise<void> {
  await db.insert(evictionTimelineTable).values({ evictionCaseId: caseId, stage, notes, createdBy: by });
}

function serializeCase(c: typeof evictionCasesTable.$inferSelect) {
  return {
    id: c.id,
    propertyAddress: c.propertyAddress,
    tenantName: c.tenantName,
    doorloopLeaseId: c.doorloopLeaseId,
    doorloopPropertyId: c.doorloopPropertyId,
    balanceAtFiling: c.balanceAtFiling != null ? num(c.balanceAtFiling) : null,
    monthlyRent: c.monthlyRent != null ? num(c.monthlyRent) : null,
    balanceWrittenOff: c.balanceWrittenOff != null ? num(c.balanceWrittenOff) : null,
    writtenOffAt: c.writtenOffAt ? c.writtenOffAt.toISOString() : null,
    writtenOffNotes: c.writtenOffNotes,
    status: c.status,
    statusLabel: STAGE_LABEL[c.status] ?? c.status,
    noticeFiledDate: c.noticeFiledDate,
    noticeType: c.noticeType,
    courtDate: c.courtDate,
    courtTime: c.courtTime,
    courtLocation: c.courtLocation,
    hearingOutcome: c.hearingOutcome,
    judgmentDate: c.judgmentDate,
    judgmentNotes: c.judgmentNotes,
    vacatedDate: c.vacatedDate,
    noticeExpiryDate: c.noticeExpiryDate,
    attorneySentAt: c.attorneySentAt ? c.attorneySentAt.toISOString() : null,
    attorneySentBy: c.attorneySentBy,
    contractDriveUrl: c.contractDriveUrl,
    contractDriveFileId: c.contractDriveFileId,
    notes: c.notes,
    createdAt: c.createdAt ? c.createdAt.toISOString() : null,
    closedAt: c.closedAt ? c.closedAt.toISOString() : null,
  };
}

// GET /api/evictions — all cases (active + closed) for the list + home indicator.
router.get("/evictions", requireAuth, async (_req, res): Promise<void> => {
  const rows = await db.select().from(evictionCasesTable).orderBy(desc(evictionCasesTable.createdAt));
  const cases = rows.map(serializeCase);
  const isClosed = (s: string) => s === "closed" || s === "dismissed";
  res.json({
    active: cases.filter((c) => !isClosed(c.status)),
    closed: cases.filter((c) => isClosed(c.status)),
  });
});

// GET /api/evictions/:id — single case + timeline + documents.
router.get("/evictions/:id", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!id || isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [c] = await db.select().from(evictionCasesTable).where(eq(evictionCasesTable.id, id));
  if (!c) { res.status(404).json({ error: "Case not found" }); return; }
  const timeline = await db.select().from(evictionTimelineTable).where(eq(evictionTimelineTable.evictionCaseId, id)).orderBy(evictionTimelineTable.stageDate);
  // Select metadata only — never the (potentially large) file_data bytes here;
  // expose a hasContent flag so the UI knows it can preview via the content route.
  const documents = await db
    .select({
      id: evictionDocumentsTable.id,
      documentName: evictionDocumentsTable.documentName,
      documentType: evictionDocumentsTable.documentType,
      driveUrl: evictionDocumentsTable.driveUrl,
      driveFileId: evictionDocumentsTable.driveFileId,
      mimeType: evictionDocumentsTable.mimeType,
      hasContent: sql<boolean>`(${evictionDocumentsTable.fileData} IS NOT NULL)`,
      postedAt: evictionDocumentsTable.postedAt,
      uploadedAt: evictionDocumentsTable.uploadedAt,
      notes: evictionDocumentsTable.notes,
    })
    .from(evictionDocumentsTable)
    .where(eq(evictionDocumentsTable.evictionCaseId, id))
    .orderBy(desc(evictionDocumentsTable.uploadedAt));
  res.json({
    case: serializeCase(c),
    timeline: timeline.map((t) => ({ id: t.id, stage: t.stage, stageDate: t.stageDate ? t.stageDate.toISOString() : null, notes: t.notes })),
    documents: documents.map((d) => ({ id: d.id, documentName: d.documentName, documentType: d.documentType, driveUrl: d.driveUrl, driveFileId: d.driveFileId, mimeType: d.mimeType, hasContent: Boolean(d.hasContent), postedAt: d.postedAt ? d.postedAt.toISOString() : null, uploadedAt: d.uploadedAt ? d.uploadedAt.toISOString() : null, notes: d.notes })),
  });
});

// POST /api/evictions — create a case (Jacob only).
router.post("/evictions", requireAuth, requireRole("jacob"), async (req: AuthRequest, res): Promise<void> => {
  const b = (req.body ?? {}) as Record<string, unknown>;
  const propertyAddress = String(b.propertyAddress ?? "").trim();
  const tenantName = String(b.tenantName ?? "").trim();
  if (!propertyAddress || !tenantName) { res.status(400).json({ error: "Property and tenant are required" }); return; }
  const noticeType = (b.noticeType as string) || "3_day";
  const noticeFiledDate = (b.noticeFiledDate as string) || new Date().toISOString().slice(0, 10);
  const [created] = await db.insert(evictionCasesTable).values({
    propertyAddress,
    tenantName,
    doorloopLeaseId: (b.doorloopLeaseId as string) || null,
    doorloopPropertyId: (b.doorloopPropertyId as string) || null,
    balanceAtFiling: b.balanceAtFiling != null ? String(num(b.balanceAtFiling)) : null,
    monthlyRent: b.monthlyRent != null ? String(num(b.monthlyRent)) : null,
    status: "notice_filed",
    noticeFiledDate,
    noticeType,
    noticeExpiryDate: computeExpiry(noticeFiledDate, noticeType),
    notes: (b.notes as string)?.trim() || null,
    createdBy: req.user?.username ?? "jacob",
  }).returning();
  const noticeLabel = noticeType === "10_day" ? "10-Day Notice" : "3-Day Notice";
  await addTimeline(created.id, "notice_filed", `Case opened — ${noticeLabel} filed`, req.user?.username ?? "jacob");
  void notifyUser("jacob", { title: "⚖️ Eviction opened", body: `${propertyAddress} — ${tenantName} · ${noticeLabel}`, url: APP_URL }).catch(() => {});
  // Auto-find the land contract in Drive (fire-and-forget).
  void autoFindContract(created.id, propertyAddress).catch(() => {});
  res.status(201).json({ id: created.id });
});

// PUT /api/evictions/:id — update case details (Jacob only).
router.put("/evictions/:id", requireAuth, requireRole("jacob"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!id || isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const [existing] = await db.select().from(evictionCasesTable).where(eq(evictionCasesTable.id, id));
  if (!existing) { res.status(404).json({ error: "Case not found" }); return; }
  const set: Record<string, unknown> = { updatedAt: new Date() };
  const str = ["propertyAddress", "tenantName", "noticeType", "status", "courtTime", "courtLocation", "hearingOutcome", "judgmentNotes", "notes"];
  for (const k of str) if (typeof b[k] === "string" && (b[k] as string).trim()) set[k] = (b[k] as string).trim();
  const dates = ["noticeFiledDate", "courtDate", "judgmentDate", "vacatedDate"];
  for (const k of dates) if (b[k] !== undefined) set[k] = (b[k] as string) || null;
  if (b.balanceAtFiling !== undefined) set.balanceAtFiling = b.balanceAtFiling === null || b.balanceAtFiling === "" ? null : String(num(b.balanceAtFiling));
  if (b.monthlyRent !== undefined) set.monthlyRent = b.monthlyRent === null || b.monthlyRent === "" ? null : String(num(b.monthlyRent));
  // Recompute the notice period if its date or type changed.
  const newFiled = (set.noticeFiledDate as string | undefined) ?? existing.noticeFiledDate ?? null;
  const newType = (set.noticeType as string | undefined) ?? existing.noticeType ?? null;
  if (b.noticeFiledDate !== undefined || b.noticeType !== undefined) set.noticeExpiryDate = computeExpiry(newFiled, newType);
  const [updated] = await db.update(evictionCasesTable).set(set).where(eq(evictionCasesTable.id, id)).returning();
  if (!updated) { res.status(404).json({ error: "Case not found" }); return; }
  res.json({ ok: true });
});

// PUT /api/evictions/:id/stage — advance to a stage (Jacob only).
router.put("/evictions/:id/stage", requireAuth, requireRole("jacob"), async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!id || isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const status = String(b.status ?? "");
  if (!STAGE_LABEL[status]) { res.status(400).json({ error: "Invalid stage" }); return; }
  const [c] = await db.select().from(evictionCasesTable).where(eq(evictionCasesTable.id, id));
  if (!c) { res.status(404).json({ error: "Case not found" }); return; }

  const set: Record<string, unknown> = { status, updatedAt: new Date() };
  if (b.courtDate !== undefined) set.courtDate = (b.courtDate as string) || null;
  if (b.courtTime !== undefined) set.courtTime = (b.courtTime as string) || null;
  if (b.courtLocation !== undefined) set.courtLocation = (b.courtLocation as string) || null;
  if (b.hearingOutcome !== undefined) set.hearingOutcome = (b.hearingOutcome as string) || null;
  if (b.judgmentDate !== undefined) set.judgmentDate = (b.judgmentDate as string) || null;
  if (b.judgmentNotes !== undefined) set.judgmentNotes = (b.judgmentNotes as string) || null;
  if (b.vacatedDate !== undefined) set.vacatedDate = (b.vacatedDate as string) || null;
  if (status === "closed" || status === "dismissed") set.closedAt = new Date();

  await db.update(evictionCasesTable).set(set).where(eq(evictionCasesTable.id, id));

  const label = STAGE_LABEL[status];
  let note = `Advanced to ${label}`;
  if (status === "court_date_set" && b.courtDate) note = `Court date set — ${fmtDate(b.courtDate as string)} ${(b.courtTime as string) ?? ""} ${(b.courtLocation as string) ?? ""}`.trim();
  if (status === "hearing_complete" && b.hearingOutcome) note = `Hearing complete — ${b.hearingOutcome as string}`;
  if (status === "judgment_issued" && b.judgmentDate) note = `Judgment issued ${fmtDate(b.judgmentDate as string)}`;
  if (status === "vacated" && b.vacatedDate) note = `Vacated ${fmtDate(b.vacatedDate as string)}`;
  await addTimeline(id, status, (b.notes as string)?.trim() || note, req.user?.username ?? "jacob");

  void notifyUser("jacob", { title: "Eviction update", body: `${c.propertyAddress} — ${label}`, url: APP_URL }).catch(() => {});
  res.json({ ok: true });
});

// POST /api/evictions/:id/write-off — write off the balance (Jacob only).
router.post("/evictions/:id/write-off", requireAuth, requireRole("jacob"), async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!id || isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [c] = await db.select().from(evictionCasesTable).where(eq(evictionCasesTable.id, id));
  if (!c) { res.status(404).json({ error: "Case not found" }); return; }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const amount = b.amount != null ? num(b.amount) : (c.balanceAtFiling != null ? num(c.balanceAtFiling) : 0);
  const notes = (b.notes as string)?.trim() || "Self-initiated eviction, tenant unable to pay";
  const now = new Date();

  await db.update(evictionCasesTable)
    .set({ balanceWrittenOff: String(amount), writtenOffAt: now, writtenOffNotes: notes, updatedAt: now })
    .where(eq(evictionCasesTable.id, id));

  // Remove from delinquency: a written-off override for the current month.
  const month = now.getMonth() + 1, year = now.getFullYear();
  await db.insert(rentStatusOverridesTable).values({
    propertyAddress: c.propertyAddress,
    doorloopLeaseId: c.doorloopLeaseId,
    month, year,
    overrideStatus: "written_off",
    reason: "Eviction — balance written off",
    notes,
    createdBy: req.user?.username ?? "jacob",
  }).onConflictDoUpdate({
    target: [rentStatusOverridesTable.propertyAddress, rentStatusOverridesTable.month, rentStatusOverridesTable.year],
    set: { overrideStatus: "written_off", reason: "Eviction — balance written off", notes },
  });

  await addTimeline(id, c.status, `Balance written off ($${amount.toLocaleString(undefined, { minimumFractionDigits: 2 })}) — ${notes}`, req.user?.username ?? "jacob");
  res.json({ ok: true, amount });
});

// POST /api/evictions/:id/documents — upload a legal document to Drive.
router.post("/evictions/:id/documents", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!id || isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [c] = await db.select().from(evictionCasesTable).where(eq(evictionCasesTable.id, id));
  if (!c) { res.status(404).json({ error: "Case not found" }); return; }
  const b = (req.body ?? {}) as Record<string, unknown>;
  const documentName = String(b.documentName ?? "Document").trim();
  const documentType = String(b.documentType ?? "other");
  const fileBase64 = b.fileBase64 as string | undefined;
  if (!fileBase64) { res.status(400).json({ error: "File is required" }); return; }

  const postedAt = b.postedAt ? new Date(String(b.postedAt)) : null;
  // Always persist the file's own bytes in the DB so it can never be lost and the
  // app can preview/serve it directly (independent of Drive).
  const mimeMatch = fileBase64.match(/^data:([^;]+);base64,/);
  const mimeType = mimeMatch ? mimeMatch[1] : null;
  let driveUrl: string | null = null;
  let driveFileId: string | null = null;
  try {
    const evFolderId = await evictionFolderFor(c.propertyAddress);
    driveUrl = await uploadBase64ToDrive(fileBase64, documentName, undefined, evFolderId);
    const m = driveUrl ? /\/d\/([^/]+)/.exec(driveUrl) : null;
    driveFileId = m ? m[1] : null;
  } catch (err) {
    logger.warn({ err }, "eviction doc upload to Drive failed (kept in DB)");
  }
  const [doc] = await db.insert(evictionDocumentsTable).values({
    evictionCaseId: id, documentName, documentType, driveUrl, driveFileId, postedAt,
    fileData: fileBase64, mimeType,
    uploadedBy: req.user?.username ?? "jacob", notes: (b.notes as string) || null,
  }).returning();

  // A manually-uploaded land contract becomes the case's contract on file.
  if (documentType === "land_contract" && driveUrl) {
    await db.update(evictionCasesTable).set({ contractDriveUrl: driveUrl, contractDriveFileId: driveFileId, contractFoundAt: new Date() }).where(eq(evictionCasesTable.id, id));
  }
  // Proof-of-service: auto-log to the timeline.
  if (documentType === "notice_posted") {
    const ts = postedAt
      ? `${postedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })} ${postedAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true })}`
      : "";
    await addTimeline(id, c.status, `Notice posted on door — photo captured as proof of service ${ts}`.trim(), req.user?.username ?? "jacob");
  }
  res.status(201).json({ id: doc.id, driveUrl, driveFileId });
});

// GET /api/evictions/:id/documents/:docId/content — the file itself, for inline
// preview/download. Served from the DB (base64 data URL); falls back to Drive
// for older docs that predate DB storage.
router.get("/evictions/:id/documents/:docId/content", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const docId = parseInt(String(req.params.docId), 10);
  if (!id || !docId || isNaN(id) || isNaN(docId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [doc] = await db.select().from(evictionDocumentsTable).where(and(eq(evictionDocumentsTable.id, docId), eq(evictionDocumentsTable.evictionCaseId, id)));
  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }

  let dataUrl = doc.fileData ?? null;
  let mime = doc.mimeType ?? null;
  // Legacy fallback: pull the bytes from Drive if we never stored them locally.
  if (!dataUrl && doc.driveFileId) {
    try {
      const meta = await getFileMetadata(doc.driveFileId);
      mime = meta.mimeType || mime || "application/octet-stream";
      const raw = await getRawFileContent(doc.driveFileId, mime);
      if (raw?.buffer) {
        mime = raw.contentType || mime;
        dataUrl = `data:${mime};base64,${raw.buffer.toString("base64")}`;
      }
    } catch (err) {
      logger.warn({ err, docId }, "eviction doc Drive content fetch failed");
    }
  }
  if (!dataUrl) { res.status(404).json({ error: "No stored content for this document" }); return; }
  res.json({ documentName: doc.documentName, mimeType: mime, fileBase64: dataUrl });
});

// DELETE /api/evictions/:id/documents/:docId — remove a document/photo/file.
router.delete("/evictions/:id/documents/:docId", requireAuth, requireRole("jacob"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  const docId = parseInt(String(req.params.docId), 10);
  if (!id || !docId || isNaN(id) || isNaN(docId)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [doc] = await db.select().from(evictionDocumentsTable).where(and(eq(evictionDocumentsTable.id, docId), eq(evictionDocumentsTable.evictionCaseId, id)));
  if (!doc) { res.status(404).json({ error: "Document not found" }); return; }
  await db.delete(evictionDocumentsTable).where(eq(evictionDocumentsTable.id, docId));
  // If this was the case's land contract, clear it on the case.
  if (doc.driveFileId && doc.driveFileId === (await db.select().from(evictionCasesTable).where(eq(evictionCasesTable.id, id)))[0]?.contractDriveFileId) {
    await db.update(evictionCasesTable).set({ contractDriveUrl: null, contractDriveFileId: null, contractFoundAt: null }).where(eq(evictionCasesTable.id, id));
  }
  res.json({ ok: true });
});

// DELETE /api/evictions/:id — archive (default) or permanently delete (?hard=true).
router.delete("/evictions/:id", requireAuth, requireRole("jacob"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!id || isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  if (String(req.query.hard ?? "") === "true") {
    // FK ON DELETE CASCADE removes documents + timeline.
    await db.delete(evictionCasesTable).where(eq(evictionCasesTable.id, id));
    res.json({ ok: true, deleted: true });
    return;
  }
  await db.update(evictionCasesTable).set({ status: "closed", closedAt: new Date(), updatedAt: new Date() }).where(eq(evictionCasesTable.id, id));
  res.json({ ok: true });
});

// GET /api/evictions/:id/account-balance — court-ready ledger PDF from Rentec.
router.get("/evictions/:id/account-balance", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!id || isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [c] = await db.select().from(evictionCasesTable).where(eq(evictionCasesTable.id, id));
  if (!c) { res.status(404).json({ error: "Case not found" }); return; }

  try {
    // Best-effort lease dates for the statement header.
    let leaseDates = "";
    if (c.doorloopLeaseId && hasToken()) {
      const leases = await getLeases();
      const lease = leases.find((l) => l.id === c.doorloopLeaseId);
      if (lease) leaseDates = [lease.start, lease.end].filter(Boolean).join(" – ");
    }

    // Use the SAME ledger the app already shows for this address — the court
    // statement is just a printable copy of that ledger. getPropertyLedger
    // resolves the property → resident by address and falls back to the Master
    // Rent Ledger when Rentec has no transactions, so it never comes back empty
    // when the on-screen ledger has data. Lines are newest-first for display;
    // a statement reads oldest-first.
    const statement = await getPropertyLedger(c.propertyAddress, c.tenantName);
    const ordered = [...statement.lines].reverse();

    let running = 0;
    const txns: AccountBalanceTxn[] = ordered.map((l) => {
      const charge = num(l.debit);
      const payment = num(l.credit);
      running += charge - payment;
      return {
        date: fmtDate(l.date),
        description: l.description || (charge ? "Charge" : "Payment received"),
        charge,
        payment,
        balance: Math.round(running * 100) / 100,
      };
    });
    const totalCharged = ordered.reduce((a, l) => a + num(l.debit), 0);
    const totalPaid = ordered.reduce((a, l) => a + num(l.credit), 0);

    const localPath = await generateAccountBalance({
      property_address: c.propertyAddress,
      tenant_name: c.tenantName,
      lease_dates: leaseDates || undefined,
      generated_date: fmtDate(new Date().toISOString()),
      transactions: txns,
      total_charged: Math.round(totalCharged * 100) / 100,
      total_paid: Math.round(totalPaid * 100) / 100,
      balance_due: Math.round((totalCharged - totalPaid) * 100) / 100,
    });

    const filename = `Account Balance - ${c.propertyAddress.replace(/[^a-zA-Z0-9 ]/g, "")}_${todayMMDDYYYY()}.pdf`;
    let driveUrl = "";
    try {
      const folderId = await evictionFolderFor(c.propertyAddress);
      const up = await uploadFileToDrive(localPath, filename, folderId);
      driveUrl = up.webViewLink;
      await db.insert(evictionDocumentsTable).values({
        evictionCaseId: id, documentName: filename, documentType: "account_balance", driveUrl, driveFileId: up.fileId, uploadedBy: "system",
      });
    } catch (err) {
      logger.warn({ err }, "account balance Drive upload failed");
    }
    const pdfBase64 = fs.readFileSync(localPath).toString("base64");
    try { fs.unlinkSync(localPath); } catch {}
    res.json({ filename, driveUrl, pdfBase64 });
  } catch (err: any) {
    logger.error({ err }, "account balance generation failed");
    res.status(500).json({ error: err.message || "Failed to generate account balance" });
  }
});

// GET /api/evictions/:id/ready — readiness to file with the attorney.
router.get("/evictions/:id/ready", requireAuth, async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!id || isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [c] = await db.select().from(evictionCasesTable).where(eq(evictionCasesTable.id, id));
  if (!c) { res.status(404).json({ error: "Case not found" }); return; }

  const period = noticePeriodStatus(c.noticeFiledDate, c.noticeType);

  const pres = await caseDocPresence(id);
  const missingDocs: string[] = [];
  if (!pres.notice) missingDocs.push("Notice (3-Day or 10-Day)");
  if (!pres.balance) missingDocs.push("Account Balance Statement");
  if (!c.contractDriveUrl) missingDocs.push("Land Contract / Lease Agreement");

  res.json({
    // Send is never blocked; this only reflects readiness for display.
    ready: period.periodComplete && missingDocs.length === 0,
    requiredDays: period.requiredDays,
    daysPassed: period.daysPassed,
    periodComplete: period.periodComplete,
    isBusinessDays: period.isBusinessDays,
    noticeType: c.noticeType, noticeFiledDate: c.noticeFiledDate,
    missingDocs,
    hasNotice: !!pres.notice, hasBalance: !!pres.balance, hasContract: !!c.contractDriveUrl,
    contractUrl: c.contractDriveUrl,
    balanceAtFiling: c.balanceAtFiling != null ? num(c.balanceAtFiling) : null,
    attorneySentAt: c.attorneySentAt ? c.attorneySentAt.toISOString() : null,
    attorneyName: ATTORNEY_NAME, attorneyEmail: ATTORNEY_EMAIL,
  });
});

// POST /api/evictions/:id/find-contract — search Drive for the land contract.
router.post("/evictions/:id/find-contract", requireAuth, requireRole("jacob"), async (req, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!id || isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [c] = await db.select().from(evictionCasesTable).where(eq(evictionCasesTable.id, id));
  if (!c) { res.status(404).json({ error: "Case not found" }); return; }
  const found = await findContractInDrive(c.propertyAddress);
  if (!found) { res.json({ found: false }); return; }
  await db.update(evictionCasesTable).set({ contractDriveUrl: found.webViewLink, contractDriveFileId: found.fileId, contractFoundAt: new Date() }).where(eq(evictionCasesTable.id, id));
  res.json({ found: true, fileName: found.fileName, webViewLink: found.webViewLink });
});

// POST /api/evictions/:id/send-attorney — email the filing package to Drew.
function fmtLong(d: string | null): string {
  if (!d) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d);
  return m ? new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : d;
}
router.post("/evictions/:id/send-attorney", requireAuth, requireRole("jacob"), async (req: AuthRequest, res): Promise<void> => {
  const id = parseInt(String(req.params.id), 10);
  if (!id || isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }
  const [c] = await db.select().from(evictionCasesTable).where(eq(evictionCasesTable.id, id));
  if (!c) { res.status(404).json({ error: "Case not found" }); return; }

  // Send is unrestricted — attach whichever of the documents are on file.
  const pres = await caseDocPresence(id);
  const dl = async (fileId: string): Promise<Buffer> => {
    let mime = "application/pdf";
    try { const meta = await getFileMetadata(fileId); mime = meta.mimeType || mime; } catch { /* default */ }
    const fc = await getRawFileContent(fileId, mime);
    return fc.buffer;
  };
  const slug = c.propertyAddress.replace(/[^a-z0-9]/gi, "_");
  const attachments: { filename: string; content: Buffer; contentType: string }[] = [];
  const attachList: string[] = [];
  try {
    if (pres.notice?.fileId) { attachments.push({ filename: `Notice_${slug}.pdf`, content: await dl(pres.notice.fileId), contentType: "application/pdf" }); attachList.push(`${c.noticeType === "10_day" ? "10-Day" : "3-Day"} Notice (posted copy)`); }
    if (pres.balance?.fileId) { attachments.push({ filename: `Account_Balance_${slug}.pdf`, content: await dl(pres.balance.fileId), contentType: "application/pdf" }); attachList.push("Account Balance Statement"); }
    if (c.contractDriveFileId) { attachments.push({ filename: `Land_Contract_${slug}.pdf`, content: await dl(c.contractDriveFileId), contentType: "application/pdf" }); attachList.push("Land Contract / Lease Agreement"); }
  } catch (err) {
    logger.error({ err }, "send-attorney: drive download failed");
    res.status(502).json({ error: "Could not download a document from Drive" }); return;
  }

  const noticeLabel = c.noticeType === "10_day" ? "10-Day" : "3-Day";
  const balance = c.balanceAtFiling != null ? num(c.balanceAtFiling) : 0;
  const attorneyFirst = ATTORNEY_NAME.split(" ")[0] || ATTORNEY_NAME;
  const html = [
    `<p>Dear ${attorneyFirst},</p>`,
    "<p>Please find attached the eviction filing documents for the following property:</p>",
    `<p><b>Property:</b> ${c.propertyAddress}<br/>`,
    `<b>Tenant:</b> ${c.tenantName}<br/>`,
    `<b>Notice Type:</b> ${noticeLabel} Notice<br/>`,
    `<b>Notice Posted:</b> ${fmtLong(c.noticeFiledDate)}<br/>`,
    `<b>Balance Owed:</b> $${balance.toFixed(2)}</p>`,
    `<p><b>Attached:</b><br/>${attachList.map((a, i) => `${i + 1}. ${a}`).join("<br/>") || "(documents to follow)"}</p>`,
    "<p>Please file for the next available court date and let us know when it is scheduled.</p>",
    `<p>Thank you,<br/>Jacob Kell<br/>Kell Commercial<br/>${JACOB_EMAIL}</p>`,
  ].join("");

  const ok = await sendEmailWithAttachments({
    to: ATTORNEY_EMAIL, cc: JACOB_EMAIL,
    subject: `Eviction Filing — ${c.propertyAddress} — ${c.tenantName}`,
    html,
    attachments,
  });
  if (!ok) { res.status(502).json({ error: "Email failed to send" }); return; }

  const now = new Date();
  await db.update(evictionCasesTable).set({ attorneySentAt: now, attorneySentBy: req.user?.username ?? "jacob", status: "awaiting_court_date", updatedAt: now }).where(eq(evictionCasesTable.id, id));
  await addTimeline(id, "awaiting_court_date", `Filed with ${ATTORNEY_NAME} — 3 documents sent to ${ATTORNEY_EMAIL}`, req.user?.username ?? "jacob");
  void notifyUser("jacob", { title: "Filing Sent to Drew", body: `${c.propertyAddress} — documents sent to ${ATTORNEY_EMAIL}`, url: APP_URL }).catch(() => {});
  res.json({ ok: true, sentAt: now.toISOString() });
});

/** Court-date reminders: push 24h before any scheduled court date. */
export async function runCourtReminders(): Promise<void> {
  try {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const cases = await db.select().from(evictionCasesTable)
      .where(inArray(evictionCasesTable.status, ["court_date_set", "awaiting_court_date"]));
    for (const c of cases) {
      if (c.courtDate === tomorrow) {
        void notifyUser("jacob", {
          title: "Court Date Tomorrow",
          body: `${c.propertyAddress} — ${c.tenantName} · ${fmtDate(c.courtDate)}${c.courtTime ? ` at ${c.courtTime}` : ""}${c.courtLocation ? ` · ${c.courtLocation}` : ""}`,
          url: APP_URL,
        }).catch(() => {});
      }
    }
  } catch (err) {
    logger.warn({ err }, "runCourtReminders failed");
  }
}

export default router;
