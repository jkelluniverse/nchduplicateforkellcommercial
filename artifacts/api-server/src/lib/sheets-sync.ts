import { google, sheets_v4 } from "googleapis";
import { db, syncQueueTable, sheetWriteLogTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { logger } from "./logger";

let _sheets: sheets_v4.Sheets | null = null;

function buildCredentials(): { client_email: string; private_key: string } {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !rawKey) throw new Error("Google credentials not configured");
  let privateKey = rawKey;
  const jsonMatch = rawKey.match(/"private_key"\s*:\s*"([\s\S]+?)(?<!\\)"\s*[,}]?/);
  if (jsonMatch) privateKey = jsonMatch[1];
  privateKey = privateKey.replace(/\\n/g, "\n").trim();
  return { client_email: email, private_key: privateKey };
}

function getSheets(): sheets_v4.Sheets {
  if (_sheets) return _sheets;
  const creds = buildCredentials();
  const scopes = ["https://www.googleapis.com/auth/spreadsheets"];
  const impersonate = process.env.GOOGLE_IMPERSONATE_USER;
  const auth = impersonate
    ? new google.auth.JWT({
        email: creds.client_email,
        key: creds.private_key,
        scopes,
        subject: impersonate,
      })
    : new google.auth.GoogleAuth({ credentials: creds, scopes });
  _sheets = google.sheets({ version: "v4", auth: auth as never });
  return _sheets;
}

export function fmtDate(d?: Date): string {
  const dt = d || new Date();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${m}/${day}/${dt.getFullYear()}`;
}

function colIdxToLetter(idx: number): string {
  let letter = "";
  let i = idx;
  while (i >= 0) {
    letter = String.fromCharCode(65 + (i % 26)) + letter;
    i = Math.floor(i / 26) - 1;
  }
  return letter;
}

/**
 * Each NCH sheet tab has a banner row (and sometimes summary rows) above the
 * actual column headers. This map records which row holds the column headers
 * for every tab the sync writes to. Defaults to row 1 if a tab is not listed.
 *
 * Verified against the live sheets on 2026-04-29 by
 * `scripts/inspect-sheet-tabs.mjs`.
 */
const HEADER_ROWS: Record<string, number> = {
  // MASTER_SHEET_2_ID — Contractor Jobs
  "1 - Job Register": 3,
  "2 - Job Costs": 3,
  "3 - Invoice Log": 3,
  // SHEET_5_ID — Operating Expenses
  "All Operating Expenses": 4,
  "⚠ Property Tax Tracker": 6,
  "Utility Tracker": 4,
  "Government Fees & Compliance": 4,
  // ICONN_SHEET_ID — Iconn Placements
  "Placement Register": 4,
  "Invoice Log": 4,
};

function getHeaderRow(tabName: string): number {
  return HEADER_ROWS[tabName] ?? 1;
}

async function doAppendRow(
  spreadsheetId: string,
  tabName: string,
  rowData: (string | number)[],
): Promise<void> {
  const sheets = getSheets();
  const headerRow = getHeaderRow(tabName);
  // Read column A from the header row down to find the true last row with
  // data. Sheets' own table-detection on `append` is unreliable here: the
  // banner rows above the header, merged cells, and empty cells inside the
  // column range all confuse it, which was causing rows to be written into
  // the wrong columns and hundreds of rows below the real data. Explicitly
  // computing the next row and issuing a bounded `update` guarantees one
  // new row appears directly below the last populated row.
  const endCol = colIdxToLetter(rowData.length - 1);
  const probe = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A${headerRow + 1}:A`,
    majorDimension: "COLUMNS",
  });
  const colA = (probe.data.values?.[0] ?? []) as string[];
  let lastDataOffset = -1;
  for (let i = colA.length - 1; i >= 0; i--) {
    if (colA[i] !== undefined && String(colA[i]).trim() !== "") {
      lastDataOffset = i;
      break;
    }
  }
  const targetRow = headerRow + 1 + lastDataOffset + 1;
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `'${tabName}'!A${targetRow}:${endCol}${targetRow}`,
    valueInputOption: "RAW",
    requestBody: { values: [rowData] },
  });
}

async function doUpdateRow(
  spreadsheetId: string,
  tabName: string,
  matchCol: string,
  matchVal: string,
  updates: Record<string, string | number>,
): Promise<void> {
  const sheets = getSheets();
  const headerRow = getHeaderRow(tabName);
  const resp = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: `'${tabName}'!A${headerRow}:ZZ${headerRow + 2000}`,
  });
  const rows = (resp.data.values || []) as string[][];
  if (rows.length === 0) {
    throw new Error(`Tab "${tabName}" header row ${headerRow} is empty`);
  }
  const headers = rows[0];
  const matchColIdx = headers.findIndex((h) => h === matchCol);
  if (matchColIdx === -1) throw new Error(`Column "${matchCol}" not found in tab "${tabName}"`);
  let rowIdx = -1;
  for (let i = 1; i < rows.length; i++) {
    if ((rows[i][matchColIdx] ?? "") === matchVal) {
      rowIdx = headerRow + i;
      break;
    }
  }
  if (rowIdx === -1) throw new Error(`Row with ${matchCol}="${matchVal}" not found in "${tabName}"`);

  const data = Object.entries(updates).map(([colName, value]) => {
    const colIdx = headers.findIndex((h) => h === colName);
    if (colIdx === -1) throw new Error(`Column "${colName}" not found in "${tabName}"`);
    return {
      range: `'${tabName}'!${colIdxToLetter(colIdx)}${rowIdx}`,
      values: [[value]],
    };
  });

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId,
    requestBody: { valueInputOption: "RAW", data },
  });
}

export type SheetOp =
  | { type: "append"; rowData: (string | number)[] }
  | {
      type: "update";
      matchCol: string;
      matchVal: string;
      updates: Record<string, string | number>;
    };

async function execOp(
  spreadsheetId: string,
  tabName: string,
  op: SheetOp,
): Promise<void> {
  if (op.type === "append") {
    await doAppendRow(spreadsheetId, tabName, op.rowData);
  } else {
    await doUpdateRow(spreadsheetId, tabName, op.matchCol, op.matchVal, op.updates);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function logWrite(
  triggerName: string,
  spreadsheetId: string,
  tabName: string,
  op: SheetOp,
  status: string,
  errorMessage?: string,
): Promise<void> {
  try {
    await db.insert(sheetWriteLogTable).values({
      triggerName,
      spreadsheetId,
      tabName,
      operation: op.type,
      rowData: JSON.stringify(op),
      status,
      ...(errorMessage ? { errorMessage } : {}),
    });
  } catch {
    // Non-fatal
  }
}

async function queueFailedWrite(
  triggerName: string,
  spreadsheetId: string,
  tabName: string,
  op: SheetOp,
): Promise<void> {
  try {
    await db.insert(syncQueueTable).values({
      triggerName,
      spreadsheetId,
      tabName,
      operation: op.type,
      rowData: JSON.stringify(op),
      ...(op.type === "update"
        ? { matchColumn: op.matchCol, matchValue: op.matchVal }
        : {}),
      retryCount: 0,
      status: "pending",
    });
  } catch {
    // Non-fatal
  }
}

/**
 * Fire-and-forget: runs the sheet op in the background.
 * Retries once on failure, then queues for later retry.
 */
export function fireAndForget(
  triggerName: string,
  spreadsheetId: string,
  tabName: string,
  op: SheetOp,
): void {
  if (!spreadsheetId) {
    logger.error({ triggerName, tabName }, "Sheets write skipped: spreadsheetId is empty (env var not set)");
    return;
  }
  void (async () => {
    try {
      await execOp(spreadsheetId, tabName, op);
      logger.info({ triggerName, tabName, spreadsheetId }, "Sheets write succeeded");
      await logWrite(triggerName, spreadsheetId, tabName, op, "success");
    } catch (err1: any) {
      const isRateLimit =
        String(err1?.code) === "429" ||
        String(err1?.message || "").includes("429") ||
        String(err1?.message || "").includes("Quota");
      logger.warn(
        { triggerName, tabName, isRateLimit, err: String(err1?.message ?? err1) },
        "Sheets write attempt 1 failed, retrying",
      );
      await sleep(isRateLimit ? 10_000 : 2_000);
      try {
        await execOp(spreadsheetId, tabName, op);
        logger.info({ triggerName, tabName }, "Sheets write succeeded on retry");
        await logWrite(triggerName, spreadsheetId, tabName, op, "success");
      } catch (err2: any) {
        logger.error(
          { triggerName, tabName, spreadsheetId, err: String(err2?.message ?? err2), stack: err2?.stack },
          "Sheets write failed after retry — queued for later",
        );
        await logWrite(
          triggerName,
          spreadsheetId,
          tabName,
          op,
          "failed",
          String(err2?.message ?? err2),
        );
        await queueFailedWrite(triggerName, spreadsheetId, tabName, op);
      }
    }
  })();
}

/**
 * Retry all pending items in the sync queue.
 * Called on startup and every 15 minutes.
 */
export async function retryQueuedWrites(): Promise<void> {
  try {
    const pending = await db
      .select()
      .from(syncQueueTable)
      .where(eq(syncQueueTable.status, "pending"));

    for (const item of pending) {
      try {
        const op = JSON.parse(item.rowData) as SheetOp;
        await execOp(item.spreadsheetId, item.tabName, op);
        await db.delete(syncQueueTable).where(eq(syncQueueTable.id, item.id));
        await logWrite(item.triggerName, item.spreadsheetId, item.tabName, op, "success");
      } catch (err: any) {
        const newCount = (item.retryCount || 0) + 1;
        const newStatus = newCount >= 5 ? "failed" : "pending";
        await db
          .update(syncQueueTable)
          .set({ retryCount: newCount, status: newStatus })
          .where(eq(syncQueueTable.id, item.id));
      }
    }
  } catch {
    // Non-fatal
  }
}

export async function getSyncStatus(): Promise<{
  lastSyncAt: Date | null;
  pendingCount: number;
  recentLogs: Array<{
    id: number;
    triggerName: string;
    tabName: string;
    status: string;
    createdAt: Date;
    errorMessage: string | null;
  }>;
}> {
  try {
    const [lastSuccess] = await db
      .select()
      .from(sheetWriteLogTable)
      .where(eq(sheetWriteLogTable.status, "success"))
      .orderBy(desc(sheetWriteLogTable.createdAt))
      .limit(1);

    const [pendingRow] = await db
      .select({ count: sql<number>`count(*)` })
      .from(syncQueueTable)
      .where(eq(syncQueueTable.status, "pending"));

    const recentLogs = await db
      .select()
      .from(sheetWriteLogTable)
      .orderBy(desc(sheetWriteLogTable.createdAt))
      .limit(10);

    return {
      lastSyncAt: lastSuccess?.createdAt ?? null,
      pendingCount: Number(pendingRow?.count ?? 0),
      recentLogs: recentLogs.map((l) => ({
        id: l.id,
        triggerName: l.triggerName,
        tabName: l.tabName,
        status: l.status,
        createdAt: l.createdAt,
        errorMessage: l.errorMessage,
      })),
    };
  } catch {
    return { lastSyncAt: null, pendingCount: 0, recentLogs: [] };
  }
}
