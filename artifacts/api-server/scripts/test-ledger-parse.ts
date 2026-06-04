/* Sanity test for parseTrackerRows: delinquency, vacancy, portfolio, totals. */
import { parseTrackerRows } from "../src/services/rent-ledger-parse.ts";

// UNFORMATTED layout: [colA flag, address, tenant, rent, jan$, janDate, feb$,
// febDate, mar$, marDate, apr$, aprDate, may$, mayDate, jun$, junDate]
function row(
  addr: string,
  tenant: string,
  rent: number,
  paid: { jan?: number; feb?: number; mar?: number; apr?: number; may?: number; jun?: number },
  flag = "",
) {
  const p = (v?: number) => v ?? 0;
  return [
    flag, addr, tenant, rent,
    p(paid.jan), "", p(paid.feb), "", p(paid.mar), "", p(paid.apr), "",
    p(paid.may), "", p(paid.jun), "",
  ];
}

const values: unknown[][] = [
  ["  DAD'S PORTFOLIO", "Property Address", "Tenant / Contact", "Rent ($)"],
  // Paid Jan–Apr in full, only May/Jun open → CURRENT (unpaid), not delinquent.
  row("1640 31st St NE", "Arianna McPeters", 740, { jan: 740, feb: 740, mar: 740, apr: 740 }),
  // Skipped February (a month after first payment, 2+ months back) → DELINQUENT.
  row("2010 9th St SW", "Joas Rosier", 1250, { jan: 1325, mar: 1250, apr: 1250, may: 1250 }),
  // Skipped Feb + Mar → DELINQUENT.
  row("1461 John Ct SE", "Fred Wilkinson", 550, { jan: 550, apr: 1050, may: 950 }),
  // Chronic 2025 carryover, no 2026 skip → operator flags "D" in col A.
  row("2227 40th St NW", "Cherita White", 950, { jan: 1500, feb: 2150, mar: 640, apr: 950, may: 490, jun: 600 }, "D"),
  // Phantom: lease started March (Jan/Feb blank are pre-lease) → NOT delinquent.
  row("1016 Arlington Ave SW", "Tello Salas Carmen Lizbeth", 750, { mar: 750, apr: 750, may: 750 }),
  // Pays late but every month; only June open → not delinquent (unpaid).
  row("1034 Prospect SW", "Rolando Barrios", 1000, { jan: 1000, feb: 1000, mar: 1000, apr: 1000, may: 1000 }),
  // Fully current this month.
  row("1820 Vine Ave SW", "Kevin Leech", 500, { jan: 500, feb: 500, mar: 500, apr: 500, may: 500, jun: 500 }),
];

const asOf = new Date(2026, 5, 4).getTime(); // June 4, 2026
const snap = parseTrackerRows(values, 6, 2026, { asOf, portfolio: "dad" });
const byAddr = Object.fromEntries(snap.rows.map((r) => [r.address, r]));

for (const r of snap.rows) {
  console.log(`  ${r.address.padEnd(22)} status=${r.status.padEnd(10)} paid=${r.amountPaid} over=${r.daysOverdue}`);
}

const delinquent = snap.rows.filter((r) => r.status === "delinquent").map((r) => r.address).sort();
const expectedDelinquent = ["1461 John Ct SE", "2010 9th St SW", "2227 40th St NW"];
console.log("\ndelinquent:", JSON.stringify(delinquent));

const errs: string[] = [];
if (JSON.stringify(delinquent) !== JSON.stringify(expectedDelinquent)) {
  errs.push(`delinquent set ${JSON.stringify(delinquent)} != ${JSON.stringify(expectedDelinquent)}`);
}
if (byAddr["1640 31st St NE"]?.status !== "unpaid") errs.push("Arianna should be unpaid (current), not delinquent");
if (byAddr["1016 Arlington Ave SW"]?.status === "delinquent") errs.push("1016 (pre-lease blanks) must not be delinquent");
if (byAddr["1034 Prospect SW"]?.status !== "unpaid") errs.push("Rolando should be unpaid (June not due yet)");
if (byAddr["1820 Vine Ave SW"]?.status !== "paid") errs.push("Kevin should be paid");
if ((byAddr["2010 9th St SW"]?.daysOverdue ?? 0) < 30) errs.push("delinquent should be 30+ days over");

if (errs.length) {
  console.error("\nFAIL:\n - " + errs.join("\n - "));
  process.exit(1);
}
console.log("\nALL ASSERTIONS PASSED");
