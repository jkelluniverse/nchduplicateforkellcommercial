/**
 * Picks the live rent-status source for the dashboard.
 *
 * Order of preference:
 *   1. Google Sheet ("MASTER RENT LEDGER V.4") — Jacob's source of truth, with
 *      real monthly rents and every payment.
 *   2. Rentec Direct — live balances when the sheet isn't configured.
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
  if (hasLedger()) {
    const data = await getLedgerRentStatus(month, year);
    if (data) return { data, source: "ledger" };
  }
  if (rentec.hasApiKey()) {
    const data = await rentec.getRentStatus(month, year);
    if (data) return { data, source: "rentec" };
  }
  return null;
}
