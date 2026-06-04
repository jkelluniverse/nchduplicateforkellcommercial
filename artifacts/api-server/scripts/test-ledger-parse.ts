/* Sanity test for parseTrackerRows against representative DAILY TRACKER rows. */
import { parseTrackerRows } from "../src/services/rent-ledger-parse.ts";

// UNFORMATTED_VALUE layout: [section, address, tenant, rent, jan$, janDate,
// feb$, febDate, mar$, marDate, apr$, aprDate, may$, mayDate, jun$, junDate]
function row(addr: string, tenant: string, rent: number, may: number, jun: number) {
  return ["", addr, tenant, rent, 0, "", 0, "", 0, "", 0, "", may, "5/x", jun, jun ? "6/x" : ""];
}

const values: unknown[][] = [
  ["  DAD'S PORTFOLIO", "Property Address", "Tenant / Contact", "Rent ($)"], // header+banner — skipped
  row("1034 Prospect SW", "Rolando Barrios", 1000, 1000, 0),   // unpaid (prior covered)
  row("812 5th St NE", "Justin Zurfley", 650, 650, 925),       // paid (overpay capped)
  row("2227 40th St NW", "Cherita White", 950, 490, 600),      // delinquent (prior short)
  row("1820 Vine Ave SW", "Kevin Leech", 500, 500, 500),       // paid
  row("1202 15th St NE", "Robert", 425, 0, 0),                 // delinquent (never paid)
  ["TOTALS", 0, 0, 0],                                          // totals — skipped
  ["  JACOB'S PROPERTIES"],                                     // section banner
  row("1314 Plain Ave NE", "Terry Williams", 350, 350, 0),     // EXCLUDED (Jacob's)
  row("1815 3rd St SE", "Joy Resendiz", 750, 750, 0),          // EXCLUDED (Jacob's)
];

// As of June 4, 2026 — Dad's portfolio only.
const asOf = new Date(2026, 5, 4).getTime();
const snap = parseTrackerRows(values, 6, 2026, asOf, "dad");

const expected = snap.rows.reduce((a, r) => a + r.monthlyRent, 0);
const collected = snap.rows.reduce((a, r) => a + r.amountPaid, 0);

console.log("rows parsed:", snap.rows.length, "(expect 5)");
for (const r of snap.rows) {
  console.log(
    `  ${r.address.padEnd(22)} rent=${r.monthlyRent} paid=${r.amountPaid} status=${r.status} daysOver=${r.daysOverdue}`,
  );
}
console.log("expected total:", expected, "(expect 3525)");
console.log("collected total:", collected, "(expect 650+650+600+500 = 2400... see note)");

// Assertions
const errs: string[] = [];
if (snap.rows.length !== 5) errs.push(`row count ${snap.rows.length} != 5 (Jacob's must be excluded)`);
if (expected !== 1000 + 650 + 950 + 500 + 425) errs.push(`expected ${expected}`);
const byAddr = Object.fromEntries(snap.rows.map((r) => [r.address, r]));
if (byAddr["1314 Plain Ave NE"]) errs.push("Jacob's property leaked into Dad's-only result");
if (byAddr["812 5th St NE"]?.status !== "paid") errs.push("812 should be paid");
if (byAddr["812 5th St NE"]?.amountPaid !== 650) errs.push("812 paid should cap at 650");
if (byAddr["1034 Prospect SW"]?.status !== "unpaid") errs.push("1034 should be unpaid");
if (byAddr["2227 40th St NW"]?.status !== "delinquent") errs.push("2227 should be delinquent");
if (byAddr["1202 15th St NE"]?.status !== "delinquent") errs.push("1202 should be delinquent");
if (byAddr["1820 Vine Ave SW"]?.status !== "paid") errs.push("1820 should be paid");

if (errs.length) {
  console.error("\nFAIL:\n - " + errs.join("\n - "));
  process.exit(1);
}
console.log("\nALL ASSERTIONS PASSED");
