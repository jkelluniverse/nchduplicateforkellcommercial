#!/usr/bin/env node
/**
 * Inspect each tab of the three sheets used by the sync layer:
 * - List all tab titles
 * - Print rows 1..6 so we can see where the real header row lives
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

const targets = [
  ["MASTER_SHEET_2_ID", process.env.MASTER_SHEET_2_ID],
  ["SHEET_5_ID", process.env.SHEET_5_ID],
  ["ICONN_SHEET_ID", process.env.ICONN_SHEET_ID],
];

(async () => {
  const sheets = getSheets();
  for (const [label, id] of targets) {
    if (!id) {
      console.log(`\n##### ${label}: NOT SET\n`);
      continue;
    }
    const meta = await sheets.spreadsheets.get({ spreadsheetId: id });
    const tabs = (meta.data.sheets || []).map((s) => s.properties?.title).filter(Boolean);
    console.log(`\n##### ${label} (${meta.data.properties?.title}) #####`);
    console.log("Tabs:", tabs);

    for (const tab of tabs) {
      try {
        const r = await sheets.spreadsheets.values.get({
          spreadsheetId: id,
          range: `'${tab}'!A1:Z6`,
        });
        const rows = r.data.values || [];
        console.log(`\n  --- ${tab} (rows 1..${rows.length}) ---`);
        rows.forEach((row, i) => {
          console.log(`  R${i + 1}:`, JSON.stringify(row));
        });
      } catch (e) {
        console.log(`  ${tab}: ERROR ${e.message}`);
      }
    }
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
