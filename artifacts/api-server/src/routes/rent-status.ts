// ─────────────────────────────────────────────────────────────────
// DOORLOOP INTEGRATION — enable this on Railway when API is connected
// When enabled, GET /api/rent-status/summary will call DoorLoop API
// instead of reading from the local rent_status table.
// DoorLoop endpoints needed:
//   GET /api/leases — all active leases with rent amounts
//   GET /api/payments?month=X&year=Y — payments received this month
//   GET /api/late-fees — outstanding late fees
// Set DOORLOOP_API_KEY and DOORLOOP_BASE_URL in environment variables.
// Set USE_DOORLOOP=true in environment variables to enable.
// ─────────────────────────────────────────────────────────────────

import { Router, type IRouter } from "express";
import { eq, and, desc, sql, or } from "drizzle-orm";
import {
  db,
  rentStatusTable,
  propertiesTable,
  rentStatusOverridesTable,
  type RentStatus,
} from "@workspace/db";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { getLiveRentStatus, hasLiveSource, type RentSource } from "../services/rent-source";
import { type DLRentRow } from "../services/rentec";
import { getOverrideMap, isOverrideStatus } from "../services/rent-overrides";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const LATE_FEE_AMOUNT = 75;
// Rent is due on the 1st with a 10-day grace period; late fees begin on the
// 11th (i.e. once the day-of-month is greater than the 10-day grace window).
const LATE_FEE_AFTER_DAY = 10;
const DELINQUENT_DAYS = 30; // 30+ days past 1st of billing month → delinquent

function useLive(): boolean {
  return hasLiveSource();
}

/**
 * Build the dashboard summary + detail rows from a live snapshot (Google Sheet
 * ledger, or Rentec). Maps each property to its local properties.id (by address
 * substring) so the frontend's existing detail/log-payment flow keeps working.
 *
 * Returns null when no live source is reachable — caller falls back to local.
 */
async function fetchLive(
  month: number,
  year: number,
): Promise<{ summary: ReturnType<typeof buildSummaryFromDoorLoopRows>; rows: ReturnType<typeof annotateOverride>[] } | null> {
  const result = await getLiveRentStatus(month, year);
  if (!result) return null;
  const { data: snap, source } = result;
  const localProps = await db.select().from(propertiesTable);
  const idx = buildPropIndex(localProps);
  const overrides = await getOverrideMap(month, year);
  const mappedRows = snap.rows
    .map((r, i) => mapDoorLoopRow(r, i, month, year, idx))
    .map((r) => annotateOverride(r, overrides));
  // Manually-resolved properties are excluded from the status buckets and the
  // delinquent/unpaid totals; they are surfaced separately as "resolved".
  const resolvedCount = mappedRows.filter((r) => r.override).length;
  const active = mappedRows.filter((r) => !r.override);
  const summary = buildSummaryFromDoorLoopRows(
    active,
    month,
    year,
    snap.uniquePropertyCount,
    source,
    resolvedCount,
  );
  return { summary, rows: mappedRows };
}

type OverrideAnnotation = {
  override: boolean;
  overrideId: number | null;
  overrideStatus: string | null;
  overrideReason: string | null;
  overrideNotes: string | null;
  overrideCreatedAt: string | null;
};

/** Attach override fields to a mapped row (override:false when none exists). */
function annotateOverride(
  row: ReturnType<typeof mapDoorLoopRow>,
  overrides: Awaited<ReturnType<typeof getOverrideMap>>,
): ReturnType<typeof mapDoorLoopRow> & OverrideAnnotation {
  const o = overrides.get(row.address);
  if (!o) {
    return {
      ...row,
      override: false,
      overrideId: null,
      overrideStatus: null,
      overrideReason: null,
      overrideNotes: null,
      overrideCreatedAt: null,
    };
  }
  return {
    ...row,
    doorloopLeaseId: o.doorloopLeaseId ?? row.doorloopLeaseId,
    override: true,
    overrideId: o.id,
    overrideStatus: o.overrideStatus,
    overrideReason: o.reason,
    overrideNotes: o.notes,
    overrideCreatedAt: o.createdAt ? o.createdAt.toISOString() : null,
  };
}

interface PropIndex {
  byDoorloopId: Map<string, number>;
  byStreet: Map<string, number>;
}

function buildPropIndex(
  properties: { id: number; address: string; doorloopPropertyId: string | null }[],
): PropIndex {
  const byDoorloopId = new Map<string, number>();
  const byStreet = new Map<string, number>();
  for (const p of properties) {
    if (p.doorloopPropertyId) byDoorloopId.set(p.doorloopPropertyId, p.id);
    const street = normalizeStreet(p.address);
    if (street) byStreet.set(street, p.id);
  }
  return { byDoorloopId, byStreet };
}

function normalizeStreet(addr: string | null | undefined): string {
  if (!addr) return "";
  const street = addr.split(",")[0]?.trim().toLowerCase() ?? "";
  return street.replace(/\s+/g, " ");
}

function resolveLocalPropertyId(
  doorloopPropertyId: string,
  address: string,
  idx: PropIndex,
): number {
  // Cleanest path: DoorLoop's property ObjectId is stored on the local row.
  const byId = idx.byDoorloopId.get(doorloopPropertyId);
  if (byId) return byId;
  // Fallback: street segment match for rows not yet linked by doorloopId.
  const norm = normalizeStreet(address);
  const direct = idx.byStreet.get(norm);
  if (direct) return direct;
  for (const [key, id] of idx.byStreet) {
    if (key.includes(norm) || norm.includes(key)) return id;
  }
  return -1;
}

function mapDoorLoopRow(
  r: DLRentRow,
  index: number,
  month: number,
  year: number,
  idx: PropIndex,
) {
  const propertyId = resolveLocalPropertyId(r.propertyDoorloopId, r.address, idx);
  return {
    id: -(index + 1), // synthetic negative id — the row is not in the local table
    propertyId,
    address: r.address,
    tenantName: r.tenantName,
    monthlyRent: r.monthlyRent,
    month,
    year,
    status: r.status,
    amountPaid: r.amountPaid,
    lateFeeDue: r.lateFeeDue,
    lateFeePaid: r.lateFeePaid,
    paymentDate: r.paymentDate,
    daysOverdue: r.daysOverdue,
    notes: null as string | null,
    // Kept name for output-shape compatibility — value is a Rentec lease id.
    doorloopLeaseId: (r.leaseId as string | null) ?? null,
    updatedAt: new Date().toISOString(),
  };
}

function buildSummaryFromDoorLoopRows(
  rows: ReturnType<typeof mapDoorLoopRow>[],
  month: number,
  year: number,
  uniquePropertyCount: number,
  source: RentSource = "rentec",
  resolvedCount = 0,
) {
  const buckets: Record<RentStatus["status"], typeof rows> = {
    paid: [], unpaid: [], late: [], delinquent: [], partial: [],
  };
  for (const r of rows) buckets[r.status].push(r);

  const sumMonthlyRent = rows.reduce((a, r) => a + r.monthlyRent, 0);
  const paidCollected = buckets.paid.reduce((a, r) => a + r.amountPaid, 0);
  const lateCollected = buckets.late.reduce((a, r) => a + r.amountPaid, 0);
  const lateFeesCollected = buckets.late.reduce((a, r) => a + r.lateFeePaid, 0)
    + buckets.paid.reduce((a, r) => a + r.lateFeePaid, 0)
    + buckets.partial.reduce((a, r) => a + r.lateFeePaid, 0);
  const partialCollected = buckets.partial.reduce((a, r) => a + r.amountPaid, 0);
  // Unpaid rows may carry a partial payment — the still-owed amount for the
  // current month is rent minus whatever has come in so far.
  const unpaidOutstanding = buckets.unpaid.reduce(
    (a, r) => a + Math.max(0, r.monthlyRent - r.amountPaid),
    0,
  );
  const unpaidLateFees = buckets.unpaid.reduce((a, r) => a + r.lateFeeDue, 0);
  const delinquentOutstanding = buckets.delinquent.reduce(
    (a, r) => a + Math.max(0, r.monthlyRent - r.amountPaid) + r.lateFeeDue,
    0,
  );
  const avgDaysOverdue = buckets.delinquent.length
    ? Math.round(buckets.delinquent.reduce((a, r) => a + r.daysOverdue, 0) / buckets.delinquent.length)
    : 0;

  // Count every dollar received toward this month's rent (including partial
  // payments on still-unpaid rows) plus any late fees collected.
  const rentCollected = rows.reduce((a, r) => a + r.amountPaid, 0);
  const totalCollectedMtd = rentCollected + lateFeesCollected;
  const collectionRate = sumMonthlyRent > 0
    ? Math.round((totalCollectedMtd / sumMonthlyRent) * 1000) / 10
    : 0;
  // Expected this month is the full rent roll of occupied properties; the
  // remaining amount starts at the full roll on the 1st and shrinks as rent
  // comes in through the month.
  const remainingThisMonth = Math.max(0, round2(sumMonthlyRent - rentCollected));

  return {
    month: monthName(month, year),
    monthNum: month,
    year,
    total_properties: uniquePropertyCount,
    paid: { count: buckets.paid.length, total_collected: round2(paidCollected) },
    late: {
      count: buckets.late.length,
      total_collected: round2(lateCollected),
      late_fees_collected: round2(lateFeesCollected),
    },
    unpaid: {
      count: buckets.unpaid.length,
      total_outstanding: round2(unpaidOutstanding),
      late_fees_outstanding: round2(unpaidLateFees),
    },
    delinquent: {
      count: buckets.delinquent.length,
      total_outstanding: round2(delinquentOutstanding),
      avg_days_overdue: avgDaysOverdue,
    },
    partial: { count: buckets.partial.length, total_collected: round2(partialCollected) },
    total_collected_mtd: round2(totalCollectedMtd),
    total_expected: round2(sumMonthlyRent),
    total_remaining: remainingThisMonth,
    collection_rate: collectionRate,
    // "N resolved this month" — properties manually overridden off the list.
    resolved_count: resolvedCount,
    // Rentec's rent-status snapshot has no returned/NSF bucket, so this is
    // always zero here (kept for output-shape parity with the dashboard).
    returned_payments: { count: 0, total_balance: 0 },
    last_updated_at: new Date().toISOString(),
    source,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────
function n(v: string | null | undefined): number {
  if (v === null || v === undefined || v === "") return 0;
  const x = Number(v);
  return Number.isFinite(x) ? x : 0;
}

function monthName(month: number, year: number): string {
  return new Date(year, month - 1, 1).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
  });
}

function currentMonthYear(): { month: number; year: number } {
  const now = new Date();
  return { month: now.getMonth() + 1, year: now.getFullYear() };
}

function daysSince(month: number, year: number): number {
  const billingStart = new Date(year, month - 1, 1);
  const ms = Date.now() - billingStart.getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

/**
 * Ensure a rent_status row exists for every property for the given month/year.
 * Idempotent — uses ON CONFLICT DO NOTHING against the unique
 * (property_id, month, year) index.
 */
export async function ensureMonthRows(month: number, year: number): Promise<void> {
  const properties = await db.select().from(propertiesTable);
  if (properties.length === 0) return;

  const rows = properties.map((p) => ({
    propertyId: p.id,
    address: p.address,
    tenantName: p.resident1Name,
    monthlyRent: "0",
    month,
    year,
    status: "unpaid" as const,
    amountPaid: "0",
    lateFeeDue: "0",
    lateFeePaid: "0",
    daysOverdue: 0,
  }));

  await db.insert(rentStatusTable).values(rows).onConflictDoNothing();
}

/**
 * Recalculate derived fields for the given month/year:
 *   - Apply $75 late_fee_due to any unpaid row on/after the 11th of the billing month.
 *   - Mark unpaid rows as 'delinquent' once 30+ days past the 1st of the billing month.
 *   - Refresh days_overdue on every unpaid/delinquent row.
 * Paid/late/partial rows are left alone (their amounts are authoritative).
 */
async function recalcMonth(month: number, year: number): Promise<void> {
  const days = daysSince(month, year);

  // 0) Defensive fix: a row cannot be "late" without an actual payment.
  //    Any row marked `late` whose amount_paid is 0 is corrected to
  //    `unpaid` (or `delinquent` once past the 30-day threshold is handled
  //    in step 2 below).
  await db
    .update(rentStatusTable)
    .set({ status: "unpaid" })
    .where(
      and(
        eq(rentStatusTable.month, month),
        eq(rentStatusTable.year, year),
        eq(rentStatusTable.status, "late"),
        sql`${rentStatusTable.amountPaid}::numeric = 0`,
      ),
    );

  // 1) Apply $75 late fee to any unpaid row once we are past the 10-day grace
  //    period (i.e. on the 11th or later of that same calendar month).
  //    For prior months we are always past the grace period by definition.
  const now = new Date();
  const isCurrentMonth = now.getMonth() + 1 === month && now.getFullYear() === year;
  const pastGrace = isCurrentMonth ? now.getDate() > LATE_FEE_AFTER_DAY : true;
  if (pastGrace) {
    await db
      .update(rentStatusTable)
      .set({ lateFeeDue: String(LATE_FEE_AMOUNT) })
      .where(
        and(
          eq(rentStatusTable.month, month),
          eq(rentStatusTable.year, year),
          eq(rentStatusTable.status, "unpaid"),
          sql`${rentStatusTable.lateFeeDue}::numeric = 0`,
        ),
      );
  }

  // 2) Mark unpaid as delinquent + refresh days_overdue once past 30 days.
  if (days >= DELINQUENT_DAYS) {
    await db
      .update(rentStatusTable)
      .set({ status: "delinquent", daysOverdue: days })
      .where(
        and(
          eq(rentStatusTable.month, month),
          eq(rentStatusTable.year, year),
          eq(rentStatusTable.status, "unpaid"),
        ),
      );
  }

  // 3) Refresh days_overdue but never reduce a higher seeded/carry-over value.
  await db
    .update(rentStatusTable)
    .set({ daysOverdue: days })
    .where(
      and(
        eq(rentStatusTable.month, month),
        eq(rentStatusTable.year, year),
        or(eq(rentStatusTable.status, "unpaid"), eq(rentStatusTable.status, "delinquent")),
        sql`${rentStatusTable.daysOverdue} < ${days}`,
      ),
    );
}

/** Build the summary payload from rows in the local table. */
function buildSummaryFromLocal(rows: RentStatus[], month: number, year: number) {
  const totalProperties = rows.length;
  const buckets: Record<RentStatus["status"], RentStatus[]> = {
    paid: [],
    unpaid: [],
    late: [],
    delinquent: [],
    partial: [],
  };
  for (const r of rows) buckets[r.status].push(r);

  const sumMonthlyRent = rows.reduce((acc, r) => acc + n(r.monthlyRent), 0);

  const paidCollected = buckets.paid.reduce((a, r) => a + n(r.amountPaid), 0);
  const lateCollected = buckets.late.reduce((a, r) => a + n(r.amountPaid), 0);
  const lateFeesCollected = buckets.late.reduce((a, r) => a + n(r.lateFeePaid), 0);
  const partialCollected = buckets.partial.reduce((a, r) => a + n(r.amountPaid), 0);

  const unpaidOutstanding = buckets.unpaid.reduce((a, r) => a + n(r.monthlyRent), 0);
  const unpaidLateFees = buckets.unpaid.reduce((a, r) => a + n(r.lateFeeDue), 0);

  const delinquentOutstanding = buckets.delinquent.reduce(
    (a, r) => a + n(r.monthlyRent) + n(r.lateFeeDue),
    0,
  );
  const avgDaysOverdue = buckets.delinquent.length
    ? Math.round(
        buckets.delinquent.reduce((a, r) => a + r.daysOverdue, 0) / buckets.delinquent.length,
      )
    : 0;

  const totalCollectedMtd = paidCollected + lateCollected + lateFeesCollected + partialCollected;
  const totalExpected = sumMonthlyRent;
  const collectionRate = totalExpected > 0
    ? Math.round((totalCollectedMtd / totalExpected) * 1000) / 10
    : 0;

  return {
    month: monthName(month, year),
    monthNum: month,
    year,
    total_properties: totalProperties,
    paid: {
      count: buckets.paid.length,
      total_collected: round2(paidCollected),
    },
    late: {
      count: buckets.late.length,
      total_collected: round2(lateCollected),
      late_fees_collected: round2(lateFeesCollected),
    },
    unpaid: {
      count: buckets.unpaid.length,
      total_outstanding: round2(unpaidOutstanding),
      late_fees_outstanding: round2(unpaidLateFees),
    },
    delinquent: {
      count: buckets.delinquent.length,
      total_outstanding: round2(delinquentOutstanding),
      avg_days_overdue: avgDaysOverdue,
    },
    partial: {
      count: buckets.partial.length,
      total_collected: round2(partialCollected),
    },
    total_collected_mtd: round2(totalCollectedMtd),
    total_expected: round2(totalExpected),
    collection_rate: collectionRate,
    resolved_count: 0,
    returned_payments: { count: 0, total_balance: 0 },
    last_updated_at: new Date().toISOString(),
    source: "local" as const,
  };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

function statusSortRank(s: RentStatus["status"]): number {
  switch (s) {
    case "delinquent": return 0;
    case "unpaid": return 1;
    case "partial": return 2;
    case "late": return 3;
    case "paid": return 4;
    default: return 5;
  }
}

function mapRow(r: RentStatus) {
  return {
    id: r.id,
    propertyId: r.propertyId,
    address: r.address,
    tenantName: r.tenantName,
    monthlyRent: n(r.monthlyRent),
    month: r.month,
    year: r.year,
    status: r.status,
    amountPaid: n(r.amountPaid),
    lateFeeDue: n(r.lateFeeDue),
    lateFeePaid: n(r.lateFeePaid),
    paymentDate: r.paymentDate,
    daysOverdue: r.daysOverdue,
    notes: r.notes,
    updatedAt: r.updatedAt.toISOString(),
  };
}

// ─── Routes ───────────────────────────────────────────────────────

// GET /api/rent-status/summary — current month dashboard summary
router.get("/rent-status/summary", requireAuth, async (_req: AuthRequest, res): Promise<void> => {
  const { month, year } = currentMonthYear();

  if (useLive()) {
    const remote = await fetchLive(month, year);
    if (remote) { res.json(remote.summary); return; }
  }

  await ensureMonthRows(month, year);
  await recalcMonth(month, year);

  const rows = await db
    .select()
    .from(rentStatusTable)
    .where(and(eq(rentStatusTable.month, month), eq(rentStatusTable.year, year)));

  res.json(buildSummaryFromLocal(rows, month, year));
});

// GET /api/rent-status/detail — current month full list, sorted by status
router.get("/rent-status/detail", requireAuth, async (_req: AuthRequest, res): Promise<void> => {
  const { month, year } = currentMonthYear();

  if (useLive()) {
    const remote = await fetchLive(month, year);
    if (remote) {
      const sorted = [...remote.rows].sort((a, b) => {
        const r = statusSortRank(a.status) - statusSortRank(b.status);
        if (r !== 0) return r;
        if (a.status === "delinquent" && b.status === "delinquent") {
          return b.daysOverdue - a.daysOverdue;
        }
        return a.address.localeCompare(b.address);
      });
      res.json(sorted);
      return;
    }
  }

  await ensureMonthRows(month, year);
  await recalcMonth(month, year);

  const rows = await db
    .select()
    .from(rentStatusTable)
    .where(and(eq(rentStatusTable.month, month), eq(rentStatusTable.year, year)));

  const sorted = [...rows].sort((a, b) => {
    const r = statusSortRank(a.status) - statusSortRank(b.status);
    if (r !== 0) return r;
    if (a.status === "delinquent" && b.status === "delinquent") {
      return b.daysOverdue - a.daysOverdue;
    }
    return a.address.localeCompare(b.address);
  });

  res.json(sorted.map(mapRow));
});

// GET /api/rent-status/history/:month/:year — list for a specific month
router.get("/rent-status/history/:month/:year", requireAuth, async (req, res): Promise<void> => {
  const month = parseInt(String(req.params.month), 10);
  const year = parseInt(String(req.params.year), 10);
  if (!month || month < 1 || month > 12 || !year || year < 2000 || year > 9999) {
    res.status(400).json({ error: "Invalid month or year" });
    return;
  }

  // For the current month, refresh derived fields. For prior months, leave history alone.
  const cur = currentMonthYear();
  if (month === cur.month && year === cur.year) {
    await ensureMonthRows(month, year);
    await recalcMonth(month, year);
  }

  const rows = await db
    .select()
    .from(rentStatusTable)
    .where(and(eq(rentStatusTable.month, month), eq(rentStatusTable.year, year)));

  const sorted = [...rows].sort((a, b) => {
    const r = statusSortRank(a.status) - statusSortRank(b.status);
    if (r !== 0) return r;
    return a.address.localeCompare(b.address);
  });

  res.json({
    month: monthName(month, year),
    monthNum: month,
    year,
    summary: buildSummaryFromLocal(rows, month, year),
    rows: sorted.map(mapRow),
  });
});

// GET /api/rent-status/months — distinct months with data, newest first
router.get("/rent-status/months", requireAuth, async (_req, res): Promise<void> => {
  const result = await db
    .selectDistinct({ month: rentStatusTable.month, year: rentStatusTable.year })
    .from(rentStatusTable)
    .orderBy(desc(rentStatusTable.year), desc(rentStatusTable.month));

  // Always include the current month in the dropdown so users can see "this month"
  // even before any rows are generated.
  const cur = currentMonthYear();
  const has = result.some((r) => r.month === cur.month && r.year === cur.year);
  const list = has ? result : [{ month: cur.month, year: cur.year }, ...result];

  res.json(list.map((r) => ({ month: r.month, year: r.year, label: monthName(r.month, r.year) })));
});

// GET /api/rent-status/overrides?month=&year= — overrides for a month.
// Registered before the generic /:propertyId route so "overrides" isn't parsed
// as a property id.
router.get("/rent-status/overrides", requireAuth, async (req, res): Promise<void> => {
  const cur = currentMonthYear();
  const month = parseInt(String(req.query.month ?? cur.month), 10);
  const year = parseInt(String(req.query.year ?? cur.year), 10);
  if (!month || month < 1 || month > 12 || !year) {
    res.status(400).json({ error: "Invalid month or year" });
    return;
  }
  const rows = await db
    .select()
    .from(rentStatusOverridesTable)
    .where(and(eq(rentStatusOverridesTable.month, month), eq(rentStatusOverridesTable.year, year)));
  res.json(rows);
});

// GET /api/rent-status/:propertyId — full payment history across all months
router.get("/rent-status/:propertyId", requireAuth, async (req, res): Promise<void> => {
  const propertyId = parseInt(String(req.params.propertyId), 10);
  if (!propertyId || isNaN(propertyId)) {
    res.status(400).json({ error: "Invalid property ID" });
    return;
  }

  const [property] = await db
    .select()
    .from(propertiesTable)
    .where(eq(propertiesTable.id, propertyId));
  if (!property) {
    res.status(404).json({ error: "Property not found" });
    return;
  }

  const history = await db
    .select()
    .from(rentStatusTable)
    .where(eq(rentStatusTable.propertyId, propertyId))
    .orderBy(desc(rentStatusTable.year), desc(rentStatusTable.month));

  res.json({
    property: {
      id: property.id,
      address: property.address,
      tenantName: property.resident1Name,
      monthlyPayment: null,
    },
    contact: {
      phone: property.resident1Phone ?? property.resident2Phone ?? null,
      email: property.resident1Email ?? property.resident2Email ?? null,
      residentName: property.resident1Name ?? property.resident2Name ?? null,
    },
    history: history.map(mapRow),
  });
});

// Accepts MM/DD/YYYY or YYYY-MM-DD; returns canonical MM/DD/YYYY day-of-month or null.
function parsePaymentDate(s: string): { canonical: string; dayOfMonth: number } | null {
  const trimmed = s.trim();
  if (!trimmed) return null;
  const us = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (us) {
    const m = parseInt(us[1], 10);
    const d = parseInt(us[2], 10);
    const y = parseInt(us[3], 10);
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 9999) return null;
    return { canonical: `${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}/${y}`, dayOfMonth: d };
  }
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    const y = parseInt(iso[1], 10);
    const m = parseInt(iso[2], 10);
    const d = parseInt(iso[3], 10);
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000 || y > 9999) return null;
    return { canonical: `${String(m).padStart(2, "0")}/${String(d).padStart(2, "0")}/${y}`, dayOfMonth: d };
  }
  return null;
}

const NOTES_MAX_LENGTH = 2000;

// PUT /api/rent-status/:propertyId/month/:month/year/:year — Jacob only manual update
router.put(
  "/rent-status/:propertyId/month/:month/year/:year",
  requireAuth,
  requireRole("jacob"),
  async (req, res): Promise<void> => {
    const propertyId = parseInt(String(req.params.propertyId), 10);
    const month = parseInt(String(req.params.month), 10);
    const year = parseInt(String(req.params.year), 10);
    if (!propertyId || !month || month < 1 || month > 12 || !year || year < 2000 || year > 9999) {
      res.status(400).json({ error: "Invalid params" });
      return;
    }

    const body = (req.body ?? {}) as {
      status?: RentStatus["status"];
      amount_paid?: number | string;
      late_fee_paid?: number | string;
      payment_date?: string | null;
      notes?: string | null;
    };

    // Reject empty payloads.
    if (
      body.status === undefined &&
      body.amount_paid === undefined &&
      body.late_fee_paid === undefined &&
      body.payment_date === undefined &&
      body.notes === undefined
    ) {
      res.status(400).json({ error: "No fields to update" });
      return;
    }

    const updates: Partial<typeof rentStatusTable.$inferInsert> = {};
    let parsedPaymentDayOfMonth: number | null = null;

    if (body.status !== undefined) {
      const valid = ["paid", "unpaid", "late", "delinquent", "partial"] as const;
      if (!valid.includes(body.status as (typeof valid)[number])) {
        res.status(400).json({ error: "Invalid status" });
        return;
      }
      updates.status = body.status;
    }
    if (body.amount_paid !== undefined) {
      const v = Number(body.amount_paid);
      if (!Number.isFinite(v) || v < 0) {
        res.status(400).json({ error: "Invalid amount_paid" });
        return;
      }
      updates.amountPaid = String(v);
    }
    if (body.late_fee_paid !== undefined) {
      const v = Number(body.late_fee_paid);
      if (!Number.isFinite(v) || v < 0) {
        res.status(400).json({ error: "Invalid late_fee_paid" });
        return;
      }
      updates.lateFeePaid = String(v);
    }
    if (body.payment_date !== undefined) {
      if (body.payment_date === null || body.payment_date === "") {
        updates.paymentDate = null;
      } else {
        const parsed = parsePaymentDate(body.payment_date);
        if (!parsed) {
          res.status(400).json({ error: "Invalid payment_date — use MM/DD/YYYY or YYYY-MM-DD" });
          return;
        }
        updates.paymentDate = parsed.canonical;
        parsedPaymentDayOfMonth = parsed.dayOfMonth;
      }
    }
    if (body.notes !== undefined) {
      if (body.notes === null) {
        updates.notes = null;
      } else if (typeof body.notes !== "string") {
        res.status(400).json({ error: "Invalid notes" });
        return;
      } else if (body.notes.length > NOTES_MAX_LENGTH) {
        res.status(400).json({ error: `Notes exceed ${NOTES_MAX_LENGTH} characters` });
        return;
      } else {
        updates.notes = body.notes || null;
      }
    }

    // Make sure the row exists before reading or updating it.
    await ensureMonthRows(month, year);

    const [existing] = await db
      .select()
      .from(rentStatusTable)
      .where(
        and(
          eq(rentStatusTable.propertyId, propertyId),
          eq(rentStatusTable.month, month),
          eq(rentStatusTable.year, year),
        ),
      );
    if (!existing) {
      res.status(404).json({ error: "Rent status row not found" });
      return;
    }

    // Reconcile derived fields so status / amount / days_overdue stay coherent.
    const finalAmountPaid = updates.amountPaid !== undefined ? Number(updates.amountPaid) : n(existing.amountPaid);
    const monthlyRent = n(existing.monthlyRent);

    if (updates.status === undefined && body.amount_paid !== undefined) {
      // Auto-derive from amount_paid.
      if (finalAmountPaid >= monthlyRent && monthlyRent > 0) {
        const dom = parsedPaymentDayOfMonth ?? new Date().getDate();
        updates.status = dom > LATE_FEE_AFTER_DAY ? "late" : "paid";
      } else if (finalAmountPaid > 0) {
        updates.status = "partial";
      } else {
        updates.status = "unpaid";
      }
    }

    // If the new status indicates fully resolved, clear days_overdue.
    if (updates.status === "paid" || updates.status === "late") {
      updates.daysOverdue = 0;
    }

    const [updated] = await db
      .update(rentStatusTable)
      .set(updates)
      .where(
        and(
          eq(rentStatusTable.propertyId, propertyId),
          eq(rentStatusTable.month, month),
          eq(rentStatusTable.year, year),
        ),
      )
      .returning();

    if (!updated) {
      res.status(404).json({ error: "Rent status row not found" });
      return;
    }

    res.json(mapRow(updated));
  },
);

// ─── Manual status overrides (resolve a delinquent property) ───────────────

// POST /api/rent-status/override — create/update this month's override.
router.post(
  "/rent-status/override",
  requireAuth,
  requireRole("jacob"),
  async (req: AuthRequest, res): Promise<void> => {
    const body = (req.body ?? {}) as {
      property_address?: string;
      doorloop_lease_id?: string;
      override_status?: string;
      reason?: string;
      notes?: string;
    };

    if (!body.property_address || !body.override_status || !body.reason) {
      res.status(400).json({ error: "property_address, override_status and reason are required" });
      return;
    }
    if (!isOverrideStatus(body.override_status)) {
      res.status(400).json({ error: "Invalid override_status" });
      return;
    }

    const { month, year } = currentMonthYear();
    try {
      const [row] = await db
        .insert(rentStatusOverridesTable)
        .values({
          propertyAddress: body.property_address,
          doorloopLeaseId: body.doorloop_lease_id ?? null,
          month,
          year,
          overrideStatus: body.override_status,
          reason: body.reason,
          notes: body.notes ?? null,
          createdBy: req.user?.role ?? "jacob",
        })
        .onConflictDoUpdate({
          target: [
            rentStatusOverridesTable.propertyAddress,
            rentStatusOverridesTable.month,
            rentStatusOverridesTable.year,
          ],
          set: {
            doorloopLeaseId: body.doorloop_lease_id ?? null,
            overrideStatus: body.override_status,
            reason: body.reason,
            notes: body.notes ?? null,
            createdBy: req.user?.role ?? "jacob",
            createdAt: new Date(),
          },
        })
        .returning();
      res.status(201).json(row);
    } catch (err) {
      logger.error({ err }, "POST /rent-status/override failed");
      res.status(500).json({ error: "Failed to save override" });
    }
  },
);

// DELETE /api/rent-status/override/:id — remove an override (undo).
router.delete(
  "/rent-status/override/:id",
  requireAuth,
  requireRole("jacob"),
  async (req, res): Promise<void> => {
    const id = parseInt(String(req.params.id), 10);
    if (!id || isNaN(id)) {
      res.status(400).json({ error: "Invalid id" });
      return;
    }
    try {
      await db.delete(rentStatusOverridesTable).where(eq(rentStatusOverridesTable.id, id));
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err }, "DELETE /rent-status/override/:id failed");
      res.status(500).json({ error: "Failed to remove override" });
    }
  },
);

// Sort helper exported for tests / callers if needed.
export { recalcMonth };

export default router;
