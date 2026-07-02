/**
 * Picks the live rent-status source for the dashboard.
 *
 * Order of preference for Kell Commercial:
 *   1. Rentec Direct — the authoritative, live source for Dad's portfolio (its
 *      own Rentec account). This matches the rest of the app (property ledger,
 *      contact checklist) and carries the accurate balance/aging logic.
 *   2. Google Sheet ("MASTER RENT LEDGER V.4") — legacy fallback ONLY when
 *      Rentec is unreachable. It's NCH's shared tracker; its Dad-section rows
 *      aren't reliably maintained (blank month cells there produced false
 *      "100+ days delinquent" readings), so it must never override live Rentec.
 *
 * Both return the same DLRentStatus shape so the routes don't care which won.
 */
import * as rentec from "./rentec";
import { getLedgerRentStatus, hasLedger } from "./rent-ledger";
import type { DLRentStatus } from "./rentec";

export type RentSource = "ledger" | "rentec";

export interface RentStatusResult {
  data: DLRentStatus;
  source: RentSource;
}

export function hasLiveSource(): boolean {
  return hasLedger() || rentec.hasApiKey();
}

export async function getLiveRentStatus(
  month: number,
  year: number,
): Promise<RentStatusResult | null> {
  // Rentec first — the authoritative live source. Only fall back to the sheet
  // when Rentec is unreachable / returns nothing.
  if (rentec.hasApiKey()) {
    const data = await rentec.getRentStatus(month, year);
    if (data) return { data, source: "rentec" };
  }
  if (hasLedger()) {
    const data = await getLedgerRentStatus(month, year);
    if (data) return { data, source: "ledger" };
  }
  return null;
}
