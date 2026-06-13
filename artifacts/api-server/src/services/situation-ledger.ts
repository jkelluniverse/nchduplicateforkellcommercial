/**
 * Situation ↔ Rentec ledger adapter (Kell Commercial).
 *
 * The payment-situation logic (editable situations, ledger-informed auto-update,
 * unpaid back-check) needs a small, stable view of a property/tenant's money
 * activity. Rentec is the ONLY source of truth — this module never computes or
 * derives balances/fees itself; it only reshapes what Rentec returns.
 *
 * It wraps the existing read-only Rentec ledger service and classifies the live
 * transactions into the four buckets the situation features consume:
 *   - currentBalance: outstanding amount owed (positive = owes), straight from
 *     Rentec's authoritative running balance.
 *   - payments:        credits the tenant actually paid (amount, date, method).
 *   - charges:         debits (rent invoices, late fees) for the running ledger.
 *   - returnedPayments: NSF / reversed / returned payments, so the auto-update
 *     can flag reversals and raise the amount owed.
 *
 * Resolution: a situation stores a property address and (optionally) a lease id.
 * We resolve the tenant's renter_id from the lease first, then fall back to the
 * property's current resident, then read that renter's ledger.
 */
import * as rentec from "./rentec";
import { logger } from "../lib/logger";

export interface LedgerPayment {
  date: string; // yyyy-mm-dd
  amount: number; // positive dollars received
  method: string | null; // CC / ACH / Check / Cash / etc., when derivable
  description: string;
}

export interface LedgerCharge {
  date: string;
  amount: number; // positive dollars charged
  description: string;
}

export interface SituationLedger {
  /** True when we reached Rentec and resolved a tenant ledger. */
  resolved: boolean;
  renterId: string | null;
  /** Outstanding amount owed (positive = tenant owes; 0 when paid/credit). */
  currentBalance: number;
  owes: boolean;
  payments: LedgerPayment[];
  charges: LedgerCharge[];
  returnedPayments: LedgerPayment[];
  fetchedAt: string;
  /** Set when Rentec couldn't be read or no tenant resolved, for surfacing. */
  unavailableReason?: string;
}

// Returned / NSF / reversed payment markers Rentec writes into a debit line
// (e.g. "PMT RETURNED: R20 Non Transaction Account").
const RETURNED_RE = /\b(returned|nsf|reversed|chargeback|charge-?back|r\d{2}\b|insufficient)\b/i;

/** Best-effort payment-method label from a Rentec line description. */
function deriveMethod(description: string): string | null {
  const d = description.toLowerCase();
  if (/\bach\b|e-?check|echeck/.test(d)) return "ACH";
  if (/\bcc\b|credit card|card|visa|mastercard|amex|discover/.test(d)) return "Card";
  if (/check|chk/.test(d)) return "Check";
  if (/cash/.test(d)) return "Cash";
  if (/easypay|online/.test(d)) return "Online";
  return null;
}

/** Resolve the renter_id for a situation from its lease id, then its address. */
async function resolveRenterId(
  address: string | null,
  leaseId: string | null,
): Promise<string | null> {
  // 1. Lease id → renter_id (most precise).
  if (leaseId) {
    try {
      const leases = await rentec.getLeases();
      const lease = leases.find((l) => l.id === leaseId);
      if (lease?.renterId) return lease.renterId;
    } catch (err) {
      logger.warn({ err, leaseId }, "situation-ledger: lease lookup failed");
    }
  }
  // 2. Address → property → current resident.
  if (address) {
    try {
      const propertyId = await rentec.findRentecPropertyIdByAddress(address);
      if (propertyId) {
        const renterId = await rentec.getCurrentRenterIdForProperty(propertyId);
        if (renterId) return renterId;
      }
    } catch (err) {
      logger.warn({ err, address }, "situation-ledger: address resolution failed");
    }
  }
  return null;
}

/**
 * Live ledger view for a situation. Returns resolved:false (never throws) when
 * Rentec is unconfigured/unreachable or no tenant could be resolved, so callers
 * fall back to their existing behavior instead of failing.
 */
export async function getSituationLedger(opts: {
  address?: string | null;
  leaseId?: string | null;
}): Promise<SituationLedger> {
  const now = new Date().toISOString();
  const base: SituationLedger = {
    resolved: false,
    renterId: null,
    currentBalance: 0,
    owes: false,
    payments: [],
    charges: [],
    returnedPayments: [],
    fetchedAt: now,
  };

  if (!rentec.hasApiKey()) {
    return { ...base, unavailableReason: "Rentec not configured" };
  }

  const renterId = await resolveRenterId(opts.address ?? null, opts.leaseId ?? null);
  if (!renterId) {
    return { ...base, unavailableReason: "No Rentec tenant resolved for this property" };
  }

  let ledger: rentec.RentecLedger;
  try {
    ledger = await rentec.getTenantLedger(renterId);
  } catch (err) {
    logger.warn({ err, renterId }, "situation-ledger: getTenantLedger failed");
    return { ...base, renterId, unavailableReason: "Rentec ledger unavailable" };
  }

  const payments: LedgerPayment[] = [];
  const charges: LedgerCharge[] = [];
  const returnedPayments: LedgerPayment[] = [];

  for (const line of ledger.lines) {
    const desc = line.description || "";
    const isReturned = RETURNED_RE.test(desc) || RETURNED_RE.test(line.subDescription || "");
    if (line.credit && line.credit > 0) {
      // A credit that is actually a returned payment is unusual, but classify by
      // text first; otherwise it's a real payment received.
      (isReturned ? returnedPayments : payments).push({
        date: line.date,
        amount: line.credit,
        method: deriveMethod(desc),
        description: desc,
      });
    } else if (line.debit && line.debit > 0) {
      if (isReturned) {
        // A returned/NSF payment is booked as a debit (it removes a prior credit).
        returnedPayments.push({
          date: line.date,
          amount: line.debit,
          method: deriveMethod(desc),
          description: desc,
        });
      } else {
        charges.push({ date: line.date, amount: line.debit, description: desc });
      }
    }
  }

  // Rentec's ending balance is negative when the tenant owes. Convert to a
  // positive "amount owed"; a positive/zero ending balance means nothing owed.
  const ending = ledger.endingBalance ?? 0;
  const currentBalance = ending < 0 ? Math.round(-ending * 100) / 100 : 0;

  return {
    resolved: true,
    renterId,
    currentBalance,
    owes: currentBalance > 0,
    payments,
    charges,
    returnedPayments,
    fetchedAt: now,
  };
}

export interface TenantContact {
  renterId: string | null;
  name: string | null;
  phone: string | null;
}

/**
 * Resolve a tenant's name + mobile phone from Rentec for a property/lease, so a
 * reminder can be addressed to the real recipient. Phone is null when none is on
 * file (the UI then disables the reminder button). Never throws.
 */
export async function getTenantContact(opts: {
  address?: string | null;
  leaseId?: string | null;
}): Promise<TenantContact> {
  const renterId = await resolveRenterId(opts.address ?? null, opts.leaseId ?? null);
  if (!renterId) return { renterId: null, name: null, phone: null };
  try {
    const tenants = await rentec.getTenants();
    const t = tenants.find((x) => x.id === renterId);
    if (!t) return { renterId, name: null, phone: null };
    const name = t.fullName ?? ([t.firstName, t.lastName].filter(Boolean).join(" ") || null);
    const phone = t.e164PhoneMobileNumber ?? t.phones?.[0]?.number ?? null;
    return { renterId, name, phone: phone && phone.trim() !== "" ? phone : null };
  } catch (err) {
    logger.warn({ err, renterId }, "situation-ledger: getTenantContact failed");
    return { renterId, name: null, phone: null };
  }
}

/** Payments/returns dated on/after `sinceDate` (yyyy-mm-dd inclusive). */
export function activitySince(
  ledger: SituationLedger,
  sinceDate: string,
): { payments: LedgerPayment[]; returnedPayments: LedgerPayment[] } {
  const since = sinceDate.slice(0, 10);
  return {
    payments: ledger.payments.filter((p) => p.date >= since),
    returnedPayments: ledger.returnedPayments.filter((p) => p.date >= since),
  };
}
