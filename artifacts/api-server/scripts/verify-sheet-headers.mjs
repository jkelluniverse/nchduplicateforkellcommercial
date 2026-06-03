#!/usr/bin/env node
/**
 * Verify that the column headers in each Google Sheet tab match the
 * column names referenced by the fireAndForget calls in jobs.ts,
 * expenses.ts, placements.ts, and pdf.ts.
 *
 * For UPDATE operations:
 *   - the matchCol header must exist in the tab
 *   - every key in `updates` must exist in the tab
 * For APPEND operations:
 *   - the row width must equal the number of header columns
 *
 * The header row for each tab is NOT row 1 — most tabs put a banner / summary
 * above the actual headers. The HEADER_ROWS map mirrors the one in
 * src/lib/sheets-sync.ts.
 *
 * Usage:
 *   node artifacts/api-server/scripts/verify-sheet-headers.mjs
 *
 * Exits 0 if all referenced column names exist and append widths match;
 * exits 1 otherwise.
 */
import { google } from "googleapis";

function buildCredentials() {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !rawKey) throw new Error("Google credentials not configured");
  let privateKey = rawKey;
  const jsonMatch = rawKey.match(/"private_key"\s*:\s*"([\s\S]+?)(?<!\\)"\s*[,}]?/);
  if (jsonMatch) privateKey = jsonMatch[1];
  privateKey = privateKey.replace(/\\n/g, "\n").trim();
  return { client_email: email, private_key: privateKey };
}

function getSheets() {
  const auth = new google.auth.GoogleAuth({
    credentials: buildCredentials(),
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  return google.sheets({ version: "v4", auth });
}

const SHEET2 = process.env.MASTER_SHEET_2_ID || "";
const SHEET5 = process.env.SHEET_5_ID || "";
const ICONN = process.env.ICONN_SHEET_ID || "";

// Mirrors HEADER_ROWS in src/lib/sheets-sync.ts.
const HEADER_ROWS = {
  "1 - Job Register": 3,
  "2 - Job Costs": 3,
  "3 - Invoice Log": 3,
  "All Operating Expenses": 4,
  "⚠ Property Tax Tracker": 6,
  "Utility Tracker": 4,
  "Gov Fees & Compliance": 4,
  "Placement Register": 4,
  "Invoice Log": 4,
};
const headerRowFor = (tab) => HEADER_ROWS[tab] ?? 1;

/** All update + append operations the sync issues, mirrored from the route files. */
const checks = [
  // ---- jobs.ts (MASTER_SHEET_2_ID) ----
  {
    trigger: "job_created (Trigger 1)",
    spreadsheetId: SHEET2,
    spreadsheetLabel: "MASTER_SHEET_2_ID",
    tab: "1 - Job Register",
    type: "append",
    width: 17,
  },
  {
    trigger: "receipt_logged (Trigger 2)",
    spreadsheetId: SHEET2,
    spreadsheetLabel: "MASTER_SHEET_2_ID",
    tab: "2 - Job Costs",
    type: "append",
    width: 10,
  },
  {
    trigger: "deposit_received (Trigger 3)",
    spreadsheetId: SHEET2,
    spreadsheetLabel: "MASTER_SHEET_2_ID",
    tab: "1 - Job Register",
    type: "update",
    matchCol: "Job #",
    updateCols: ["Deposit Received ($)", "Deposit Date", "Status"],
  },
  {
    trigger: "job_status_updated (Trigger 4)",
    spreadsheetId: SHEET2,
    spreadsheetLabel: "MASTER_SHEET_2_ID",
    tab: "1 - Job Register",
    type: "update",
    matchCol: "Job #",
    updateCols: ["Status"],
  },
  {
    trigger: "invoice_generated_log (Trigger 5A)",
    spreadsheetId: SHEET2,
    spreadsheetLabel: "MASTER_SHEET_2_ID",
    tab: "3 - Invoice Log",
    type: "append",
    width: 8,
  },
  {
    trigger: "invoice_generated_job (Trigger 5B)",
    spreadsheetId: SHEET2,
    spreadsheetLabel: "MASTER_SHEET_2_ID",
    tab: "1 - Job Register",
    type: "update",
    matchCol: "Job #",
    updateCols: ["Invoice #", "Invoice Amount ($)", "Status"],
  },
  {
    trigger: "final_payment_received_job (Trigger 6A)",
    spreadsheetId: SHEET2,
    spreadsheetLabel: "MASTER_SHEET_2_ID",
    tab: "1 - Job Register",
    type: "update",
    matchCol: "Job #",
    updateCols: ["Final Payment ($)", "Final Pmt Date", "Status"],
  },
  {
    trigger: "final_payment_received_invoice (Trigger 6B)",
    spreadsheetId: SHEET2,
    spreadsheetLabel: "MASTER_SHEET_2_ID",
    tab: "3 - Invoice Log",
    type: "update",
    matchCol: "Invoice #",
    updateCols: ["Date Paid", "Amount Paid ($)"],
  },

  // ---- expenses.ts (SHEET_5_ID) ----
  {
    trigger: "expense_submitted_main (Trigger 7 op 1)",
    spreadsheetId: SHEET5,
    spreadsheetLabel: "SHEET_5_ID",
    tab: "All Operating Expenses",
    type: "append",
    width: 11,
  },
  {
    trigger: "expense_property_tax (Trigger 7 op 2)",
    spreadsheetId: SHEET5,
    spreadsheetLabel: "SHEET_5_ID",
    tab: "⚠ Property Tax Tracker",
    type: "append",
    width: 11,
  },
  {
    trigger: "expense_utility (Trigger 7 op 3)",
    spreadsheetId: SHEET5,
    spreadsheetLabel: "SHEET_5_ID",
    tab: "Utility Tracker",
    type: "append",
    width: 11,
  },
  {
    trigger: "expense_gov_fee (Trigger 7 op 4)",
    spreadsheetId: SHEET5,
    spreadsheetLabel: "SHEET_5_ID",
    tab: "Gov Fees & Compliance",
    type: "append",
    width: 10,
  },

  // ---- placements.ts (ICONN_SHEET_ID) ----
  {
    trigger: "placement_logged_register (Trigger 8A)",
    spreadsheetId: ICONN,
    spreadsheetLabel: "ICONN_SHEET_ID",
    tab: "Placement Register",
    type: "append",
    width: 11,
  },
  {
    trigger: "placement_logged_invoice (Trigger 8B)",
    spreadsheetId: ICONN,
    spreadsheetLabel: "ICONN_SHEET_ID",
    tab: "Invoice Log",
    type: "append",
    width: 10,
  },
  {
    trigger: "iconn_payment_register (Trigger 9A)",
    spreadsheetId: ICONN,
    spreadsheetLabel: "ICONN_SHEET_ID",
    tab: "Placement Register",
    type: "update",
    matchCol: "Invoice #",
    updateCols: ["Payment Received", "Date Paid", "Status"],
  },
  {
    trigger: "iconn_payment_invoice (Trigger 9B)",
    spreadsheetId: ICONN,
    spreadsheetLabel: "ICONN_SHEET_ID",
    tab: "Invoice Log",
    type: "update",
    matchCol: "Invoice #",
    updateCols: ["Payment Received", "Date Paid", "Status"],
  },
];

const headerCache = new Map();
async function getHeaders(sheets, spreadsheetId, tab) {
  const key = `${spreadsheetId}::${tab}`;
  if (headerCache.has(key)) return headerCache.get(key);
  try {
    const headerRow = headerRowFor(tab);
    const resp = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tab}'!${headerRow}:${headerRow}`,
    });
    const headers = (resp.data.values && resp.data.values[0]) || [];
    headerCache.set(key, { ok: true, headers, headerRow });
    return { ok: true, headers, headerRow };
  } catch (err) {
    const result = { ok: false, error: err?.message || String(err), headers: [], headerRow: 0 };
    headerCache.set(key, result);
    return result;
  }
}

(async () => {
  const sheets = getSheets();
  console.log("Verifying Google Sheets column headers used by the sync layer...\n");

  let totalProblems = 0;
  const reports = [];

  for (const c of checks) {
    if (!c.spreadsheetId) {
      reports.push({
        trigger: c.trigger,
        tab: c.tab,
        spreadsheet: c.spreadsheetLabel,
        problems: [`env var ${c.spreadsheetLabel} is not set`],
        headers: [],
        headerRow: 0,
      });
      totalProblems++;
      continue;
    }

    const { ok, headers, error, headerRow } = await getHeaders(sheets, c.spreadsheetId, c.tab);
    const problems = [];

    if (!ok) {
      problems.push(`could not read tab: ${error}`);
    } else if (headers.length === 0) {
      problems.push(`header row ${headerRow} is empty`);
    } else if (c.type === "update") {
      if (!headers.includes(c.matchCol)) {
        problems.push(`matchCol "${c.matchCol}" NOT in headers`);
      }
      for (const col of c.updateCols) {
        if (!headers.includes(col)) {
          problems.push(`update column "${col}" NOT in headers`);
        }
      }
    } else if (c.type === "append") {
      if (headers.length !== c.width) {
        problems.push(
          `append width ${c.width} != header count ${headers.length} (column counts must match exactly)`,
        );
      }
    }

    if (problems.length > 0) totalProblems += problems.length;
    reports.push({
      trigger: c.trigger,
      tab: c.tab,
      spreadsheet: c.spreadsheetLabel,
      problems,
      headers,
      headerRow,
    });
  }

  // Pretty-print per-tab summary
  const byTab = new Map();
  for (const r of reports) {
    const k = `${r.spreadsheet} :: ${r.tab}`;
    if (!byTab.has(k)) byTab.set(k, { headers: r.headers, headerRow: r.headerRow, items: [] });
    byTab.get(k).items.push(r);
  }

  for (const [tab, info] of byTab) {
    console.log(`\n==== ${tab} (header row ${info.headerRow}) ====`);
    console.log(
      `Headers (${info.headers.length}): ${
        info.headers.length ? JSON.stringify(info.headers) : "(none / unreadable)"
      }`,
    );
    for (const r of info.items) {
      if (r.problems.length === 0) {
        console.log(`  OK    ${r.trigger}`);
      } else {
        for (const p of r.problems) {
          console.log(`  FAIL  ${r.trigger}: ${p}`);
        }
      }
    }
  }

  console.log(
    `\n========\n${totalProblems === 0 ? "ALL OK" : `${totalProblems} problem(s) found`}`,
  );
  process.exit(totalProblems === 0 ? 0 : 1);
})().catch((err) => {
  console.error("Verifier crashed:", err);
  process.exit(2);
});
