/**
 * Picks the live rent-status source for the dashboard.
 *
 * Order of preference:
 *   1. Rentec Direct — the authoritative live source for this portfolio: most
 *      up-to-date balances and payment status, and consistent with the
 *      property ledger + contact checklist.
 *   2. Google Sheet ("MASTER RENT LEDGER V.4") — fallback ONLY when Rentec is
 *      unreachable/unconfigured. It's the shared manual tracker; its blank
 *      month cells previously produced false "100+ days delinquent" readings,
 *      so it must never override live Rentec.
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
  // Rentec first — most current balances/payment status. The sheet is only a
  // fallback when Rentec is unreachable or returns nothing.
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
