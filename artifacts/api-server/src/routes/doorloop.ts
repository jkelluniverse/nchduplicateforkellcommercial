import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import {
  getProperties,
  getLeases,
  getTenants,
  getPayments,
  getLateFees,
  getRentStatus,
  hasToken,
  clearCache,
  formatPropertyAddress,
  buildLeaseTenantLookup,
  selectPrimaryLeaseTenant,
} from "../services/doorloop";

const router: IRouter = Router();

function currentMonthYear(): { month: number; year: number } {
  const d = new Date();
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}

// GET /api/doorloop/status — connection health for the dashboard badge.
router.get("/doorloop/status", requireAuth, async (_req, res): Promise<void> => {
  const enabled = process.env["USE_DOORLOOP"] === "true";
  if (!hasToken()) {
    res.json({
      ok: false,
      enabled,
      hasToken: false,
      message: "DOORLOOP_API_TOKEN secret is not set",
    });
    return;
  }
  const leases = await getLeases();
  const properties = await getProperties();
  const { month, year } = currentMonthYear();
  const payments = await getPayments(month, year);
  res.json({
    ok: leases.length > 0 || properties.length > 0,
    enabled,
    hasToken: true,
    propertyCount: properties.length,
    leaseCount: leases.length,
    paymentsThisMonth: payments.length,
    fetchedAt: new Date().toISOString(),
  });
});

// POST /api/doorloop/sync — clear cache + force a re-fetch.
router.post("/doorloop/sync", requireAuth, async (_req, res): Promise<void> => {
  if (!hasToken()) {
    res.status(503).json({ error: "DoorLoop token not configured" });
    return;
  }
  clearCache();
  const leases = await getLeases();
  const properties = await getProperties();
  const tenants = await getTenants();
  res.json({
    ok: true,
    leaseCount: leases.length,
    propertyCount: properties.length,
    tenantCount: tenants.length,
    fetchedAt: new Date().toISOString(),
  });
});

// GET /api/doorloop/properties — DoorLoop property list with tenant + rent
// info, used by the docs prefill dropdown and as the source-of-truth picker.
router.get("/doorloop/properties", requireAuth, async (_req, res): Promise<void> => {
  const [properties, leases, tenants] = await Promise.all([
    getProperties(),
    getLeases(),
    getTenants(),
  ]);

  // Build tenant lookup keyed by (propertyId, unitId). Only LEASE_TENANT
  // records (real residents); prospects are skipped by the shared helper.
  const tenantByPropertyUnit = buildLeaseTenantLookup(tenants);

  // Build property → most recent active lease lookup. When DoorLoop has
  // multiple ACTIVE leases for a property (transition window), the lease
  // with the latest start date is the current resident.
  const sortedLeases = [...leases].sort((a, b) => {
    const aT = a.start ? new Date(a.start).getTime() : 0;
    const bT = b.start ? new Date(b.start).getTime() : 0;
    return bT - aT;
  });
  const leaseByProperty = new Map<string, typeof leases[number]>();
  for (const lease of sortedLeases) {
    if (lease.status && lease.status !== "ACTIVE") continue;
    if (!leaseByProperty.has(lease.property)) leaseByProperty.set(lease.property, lease);
  }

  res.json(
    properties.map((p) => {
      const lease = leaseByProperty.get(p.id);
      let tenantName: string | null = null;
      let tenantPhone: string | null = null;
      let tenantEmail: string | null = null;
      if (lease) {
        // Pick the current tenant by lease.name (not "first interest match"),
        // so prior tenants on the same unit never surface here.
        const t = selectPrimaryLeaseTenant(lease, tenantByPropertyUnit);
        if (t) {
          tenantName = t.fullName ?? ([t.firstName, t.lastName].filter(Boolean).join(" ") || null);
          tenantPhone = t.e164PhoneMobileNumber ?? t.phones?.[0]?.number ?? null;
          tenantEmail = t.emails?.[0]?.address ?? null;
        }
      }
      return {
        id: p.id,
        name: p.name ?? null,
        address: formatPropertyAddress(p),
        tenantName,
        tenantPhone,
        tenantEmail,
        monthlyPayment: lease?.totalRecurringRent ?? null,
        leaseId: lease?.id ?? null,
      };
    }),
  );
});

// GET /api/doorloop/payments — current-month payments.
router.get("/doorloop/payments", requireAuth, async (req, res): Promise<void> => {
  const cur = currentMonthYear();
  const month = parseInt(String(req.query.month ?? cur.month), 10);
  const year = parseInt(String(req.query.year ?? cur.year), 10);
  if (!month || month < 1 || month > 12 || !year || year < 2000 || year > 9999) {
    res.status(400).json({ error: "Invalid month or year" });
    return;
  }
  const payments = await getPayments(month, year);
  res.json(payments);
});

// GET /api/doorloop/late-fees — current-month late-fee charges.
router.get("/doorloop/late-fees", requireAuth, async (req, res): Promise<void> => {
  const cur = currentMonthYear();
  const month = parseInt(String(req.query.month ?? cur.month), 10);
  const year = parseInt(String(req.query.year ?? cur.year), 10);
  if (!month || month < 1 || month > 12 || !year || year < 2000 || year > 9999) {
    res.status(400).json({ error: "Invalid month or year" });
    return;
  }
  const lateFees = await getLateFees(month, year);
  res.json(lateFees);
});

// GET /api/doorloop/rent-status — aggregated current-month snapshot.
router.get("/doorloop/rent-status", requireAuth, async (_req, res): Promise<void> => {
  const { month, year } = currentMonthYear();
  const status = await getRentStatus(month, year);
  if (!status) {
    res.status(503).json({ error: "DoorLoop unreachable" });
    return;
  }
  res.json(status);
});

export default router;
