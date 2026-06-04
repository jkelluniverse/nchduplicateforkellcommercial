/**
 * Google Sheets rent-ledger reader for Kell Commercial.
 *
 * Source of truth: the "MASTER RENT LEDGER V.4" spreadsheet that Jacob keeps
 * updated whenever a tenant pays. The "DAILY TRACKER" tab is a per-property
 * rent roll with a Paid$/Date pair of columns for every month, e.g.:
 *
 *   A(section) | B Address | C Tenant | D Rent($) | E Jan$ | F Jan date | ...
 *
 * We read that tab, sum each occupied property's rent for "expected this month",
 * and subtract the current month's payments to show the amount still owed as it
 * decreases through the month.
 *
 * READ-ONLY. We never write back to the sheet. The reader is non-throwing —
 * every failure returns null so callers fall back to Rentec / the local table.
 */
import { google } from "googleapis";
import { logger } from "../lib/logger";
import type { DLRentStatus } from "./rentec";
import { parseTrackerRows, type Portfolio } from "./rent-ledger-parse";

// The shared "MASTER RENT LEDGER V.4". Overridable per-environment.
const DEFAULT_SHEET_ID = "1s6G-hFBy20812QyIG28bXAknC9CpwDl1eawKWEwoSbU";
const CACHE_TTL_MS = 2 * 60 * 1000;

function sheetId(): string {
  return process.env["RENT_LEDGER_SHEET_ID"] || DEFAULT_SHEET_ID;
}

/** Which tracker section(s) to count. Defaults to Dad's portfolio. */
function portfolio(): Portfolio {
  const p = (process.env["RENT_LEDGER_PORTFOLIO"] || "dad").toLowerCase();
  return p === "all" || p === "jacob" ? (p as Portfolio) : "dad";
}

/** Service-account creds: prefer the full JSON blob, fall back to the split env. */
function buildCredentials(): { client_email: string; private_key: string } | null {
  const json = process.env["GOOGLE_SERVICE_ACCOUNT_JSON"];
  if (json) {
    try {
      const parsed = JSON.parse(json) as { client_email?: string; private_key?: string };
      if (parsed.client_email && parsed.private_key) {
        return {
          client_email: parsed.client_email,
          private_key: parsed.private_key.replace(/\\n/g, "\n"),
        };
      }
    } catch {
      /* fall through to split env below */
    }
  }
  const email = process.env["GOOGLE_CLIENT_EMAIL"];
  const rawKey = process.env["GOOGLE_PRIVATE_KEY"];
  if (email && rawKey) {
    let privateKey = rawKey;
    const jsonMatch = rawKey.match(/"private_key"\s*:\s*"([\s\S]+?)(?<!\\)"\s*[,}]?/);
    if (jsonMatch && jsonMatch[1]) privateKey = jsonMatch[1];
    privateKey = privateKey.replace(/\\n/g, "\n").trim();
    if (privateKey.includes("BEGIN")) return { client_email: email, private_key: privateKey };
  }
  return null;
}

export function hasLedger(): boolean {
  return Boolean(sheetId()) && buildCredentials() !== null;
}

// ─── Live fetch (cached) ────────────────────────────────────────────

let cache: { value: DLRentStatus; key: string; expiresAt: number } | null = null;

interface SheetColor {
  red?: number | null;
  green?: number | null;
  blue?: number | null;
}

/**
 * A red-ish fill marks a vacant unit. We require red to clearly dominate green
 * and blue so the cream/gold theme and green "paid" cells never register.
 */
function isVacantRed(color: SheetColor | null | undefined): boolean {
  if (!color) return false;
  const r = color.red ?? 0;
  const g = color.green ?? 0;
  const b = color.blue ?? 0;
  return r >= 0.55 && r - g >= 0.2 && r - b >= 0.2;
}

interface TrackerData {
  values: unknown[][];
  vacant: Set<number>;
}

async function readTracker(): Promise<TrackerData | null> {
  const credentials = buildCredentials();
  if (!credentials) return null;
  try {
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
    });
    const sheets = google.sheets({ version: "v4", auth });
    const id = sheetId();

    // Find the DAILY TRACKER tab (fall back to the first tab).
    const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
    const titles = (meta.data.sheets ?? [])
      .map((s) => s.properties?.title)
      .filter((t): t is string => Boolean(t));
    const tab = titles.find((t) => /daily\s*tracker/i.test(t)) ?? titles[0];
    if (!tab) return null;

    // One grid read gives us both the values and per-cell fill colors so we
    // can detect red-highlighted (vacant) rows.
    const res = await sheets.spreadsheets.get({
      spreadsheetId: id,
      ranges: [`'${tab}'!A1:AB400`],
      includeGridData: true,
      fields: "sheets(data(rowData(values(effectiveValue,formattedValue,effectiveFormat(backgroundColor)))))",
    });

    const rowData = res.data.sheets?.[0]?.data?.[0]?.rowData ?? [];
    const values: unknown[][] = [];
    const vacant = new Set<number>();

    rowData.forEach((row, rowIndex) => {
      const cells = row.values ?? [];
      const out: unknown[] = [];
      let rowIsVacant = false;
      cells.forEach((cell, colIndex) => {
        const ev = cell.effectiveValue;
        out[colIndex] =
          ev?.numberValue ?? ev?.stringValue ?? ev?.boolValue ?? cell.formattedValue ?? "";
        // Only the identity columns (address/tenant/rent) carry the vacancy mark.
        if (colIndex >= 1 && colIndex <= 3 && isVacantRed(cell.effectiveFormat?.backgroundColor)) {
          rowIsVacant = true;
        }
      });
      values[rowIndex] = out;
      if (rowIsVacant) vacant.add(rowIndex);
    });

    if (vacant.size > 0) {
      const addrs = [...vacant].map((i) => String(values[i]?.[1] ?? "?"));
      logger.info({ count: vacant.size, addresses: addrs }, "Rent ledger: excluded vacant (red) units");
    }
    return { values, vacant };
  } catch (err) {
    logger.error({ err }, "Rent ledger: failed to read Google Sheet");
    return null;
  }
}

/**
 * Build a rent-status snapshot for the given month from the Google Sheet.
 * Returns null on any failure so callers fall back to Rentec / local data.
 */
export async function getLedgerRentStatus(
  month: number,
  year: number,
): Promise<DLRentStatus | null> {
  if (!hasLedger()) return null;
  const key = `${year}-${month}`;
  if (cache && cache.key === key && cache.expiresAt > Date.now()) return cache.value;

  const tracker = await readTracker();
  if (!tracker || tracker.values.length === 0) return null;

  const snapshot = parseTrackerRows(tracker.values, month, year, {
    portfolio: portfolio(),
    vacant: tracker.vacant,
  });
  if (snapshot.rows.length === 0) return null;

  cache = { value: snapshot, key, expiresAt: Date.now() + CACHE_TTL_MS };
  return snapshot;
}

export function clearLedgerCache(): void {
  cache = null;
}
