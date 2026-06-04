/* Sanity test for parseTrackerRows against representative DAILY TRACKER rows. */
import { parseTrackerRows } from "../src/services/rent-ledger-parse.ts";

// UNFORMATTED layout: [section, address, tenant, rent, jan$, janDate,
// feb$, febDate, mar$, marDate, apr$, aprDate, may$, mayDate, jun$, junDate]
function row(addr: string, tenant: string, rent: number, may: number, jun: number) {
  return ["", addr, tenant, rent, 0, "", 0, "", 0, "", 0, "", may, "5/x", jun, jun ? "6/x" : ""];
}

const values: unknown[][] = [
  ["  DAD'S PORTFOLIO", "Property Address", "Tenant / Contact", "Rent ($)"], // header+banner
  row("1034 Prospect SW", "Rolando Barrios", 1000, 1000, 0),   // unpaid: paid May, June not due yet
  row("1618 19th St NE", "Tom Reed", 750, 725, 0),             // unpaid: pays the 15th, short-but-paid May → NOT delinquent
  row("812 5th St NE", "Justin Zurfley", 650, 650, 925),       // paid (overpay capped at rent)
  row("2227 40th St NW", "Cherita White", 950, 490, 600),      // partial: paid May → NOT delinquent
  row("1820 Vine Ave SW", "Kevin Leech", 500, 500, 500),       // paid
  row("1202 15th St NE", "Robert", 425, 0, 0),                 // delinquent: nothing last month
  row("9 Vacant Ln", "Former Tenant", 900, 0, 0),              // VACANT (red) → excluded
  ["TOTALS", 0, 0, 0],                                          // totals — skipped
  ["  JACOB'S PROPERTIES"],                                     // section banner
  row("1314 Plain Ave NE", "Terry Williams", 350, 350, 0),     // EXCLUDED (Jacob's)
];

// Row index 7 ("9 Vacant Ln") is highlighted red in the sheet.
const vacant = new Set<number>([7]);
const asOf = new Date(2026, 5, 4).getTime(); // June 4, 2026
const snap = parseTrackerRows(values, 6, 2026, { asOf, portfolio: "dad", vacant });

const expected = snap.rows.reduce((a, r) => a + r.monthlyRent, 0);
const collected = snap.rows.reduce((a, r) => a + r.amountPaid, 0);

console.log("rows parsed:", snap.rows.length, "(expect 6)");
for (const r of snap.rows) {
  console.log(`  ${r.address.padEnd(22)} rent=${r.monthlyRent} paid=${r.amountPaid} status=${r.status} lateFee=${r.lateFeeDue}`);
}
console.log("expected total:", expected, "(expect 1000+750+650+950+500+425 = 4275)");
console.log("collected total:", collected);

const errs: string[] = [];
const byAddr = Object.fromEntries(snap.rows.map((r) => [r.address, r]));
if (snap.rows.length !== 6) errs.push(`row count ${snap.rows.length} != 6`);
if (expected !== 4275) errs.push(`expected ${expected} != 4275 (vacant must be excluded)`);
if (byAddr["9 Vacant Ln"]) errs.push("vacant unit leaked into results");
if (byAddr["1314 Plain Ave NE"]) errs.push("Jacob's property leaked into Dad's-only result");
if (byAddr["1034 Prospect SW"]?.status !== "unpaid") errs.push("Rolando should be unpaid (current), not delinquent");
if (byAddr["1618 19th St NE"]?.status !== "unpaid") errs.push("Tom Reed should be unpaid (current), not delinquent");
if (byAddr["2227 40th St NW"]?.status !== "partial") errs.push("Cherita should be partial (paid May), not delinquent");
if (byAddr["1202 15th St NE"]?.status !== "delinquent") errs.push("Robert should be delinquent (no May payment)");
if (byAddr["1202 15th St NE"]?.lateFeeDue !== 75) errs.push("delinquent should carry late fee");
if (byAddr["1618 19th St NE"]?.lateFeeDue !== 0) errs.push("current-but-unpaid should NOT carry a late fee");
if (byAddr["812 5th St NE"]?.status !== "paid" || byAddr["812 5th St NE"]?.amountPaid !== 650) {
  errs.push("812 should be paid, capped at 650");
}

if (errs.length) {
  console.error("\nFAIL:\n - " + errs.join("\n - "));
  process.exit(1);
}
console.log("\nALL ASSERTIONS PASSED");
