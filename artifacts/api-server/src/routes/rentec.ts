import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/auth";
import {
  ping,
  getProperties,
  getLeases,
  getTenants,
  getRentStatus,
  hasApiKey,
  clearCache,
  formatPropertyAddress,
  buildLeaseTenantLookup,
  selectPrimaryLeaseTenant,
} from "../services/rentec";

const router: IRouter = Router();

function currentMonthYear(): { month: number; year: number } {
  const d = new Date();
  return { month: d.getMonth() + 1, year: d.getFullYear() };
}

// GET /api/rentec/status — connection health for the dashboard badge.
router.get("/rentec/status", requireAuth, async (_req, res): Promise<void> => {
  if (!hasApiKey()) {
    res.json({
      ok: false,
      hasToken: false,
      message: "RENTEC_API_KEY is not set",
    });
    return;
  }
  const reachable = await ping();
  const leases = await getLeases();
  const properties = await getProperties();
  res.json({
    ok: reachable && (leases.length > 0 || properties.length > 0),
    hasToken: true,
    reachable,
    propertyCount: properties.length,
    leaseCount: leases.length,
    fetchedAt: new Date().toISOString(),
  });
});

// POST /api/rentec/sync — clear cache + force a re-fetch (manual "Refresh").
router.post("/rentec/sync", requireAuth, async (_req, res): Promise<void> => {
  if (!hasApiKey()) {
    res.status(503).json({ error: "RENTEC_API_KEY not configured" });
    return;
  }
  clearCache();
  const [leases, properties, tenants] = await Promise.all([
    getLeases(),
    getProperties(),
    getTenants(),
  ]);
  res.json({
    ok: true,
    leaseCount: leases.length,
    propertyCount: properties.length,
    tenantCount: tenants.length,
    fetchedAt: new Date().toISOString(),
  });
});

// GET /api/rentec/properties — property list with current tenant + rent info.
router.get("/rentec/properties", requireAuth, async (_req, res): Promise<void> => {
  const [properties, leases, tenants] = await Promise.all([
    getProperties(),
    getLeases(),
    getTenants(),
  ]);

  const tenantByPropertyUnit = buildLeaseTenantLookup(tenants);

  // property → most recent active lease (latest start = current resident).
  const sortedLeases = [...leases].sort((a, b) => {
    const aT = a.start ? new Date(a.start).getTime() : 0;
    const bT = b.start ? new Date(b.start).getTime() : 0;
    return bT - aT;
  });
  const leaseByProperty = new Map<string, (typeof leases)[number]>();
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

// GET /api/rentec/rent-status — aggregated current-month snapshot.
router.get("/rentec/rent-status", requireAuth, async (_req, res): Promise<void> => {
  const { month, year } = currentMonthYear();
  const status = await getRentStatus(month, year);
  if (!status) {
    res.status(503).json({ error: "Rentec unreachable" });
    return;
  }
  res.json(status);
});

export default router;
