import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, propertiesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/auth";
import { getPropertyLedger, getLedgerList } from "../services/property-ledger";

const router: IRouter = Router();

/**
 * GET /api/properties/ledger-list — the Ledger roster: one row per directory
 * property enriched with live Rentec balance, status, aging, and whether an
 * open Payment Situation exists. Drives the sortable/filterable Ledger list.
 * (Declared before "/properties/:propertyId" so it isn't swallowed by it.)
 */
router.get("/properties/ledger-list", requireAuth, async (req, res): Promise<void> => {
  const q = typeof req.query.q === "string" ? req.query.q : undefined;
  res.json(await getLedgerList(q));
});

router.get("/properties", requireAuth, async (req, res): Promise<void> => {
  const q = req.query.q as string | undefined;

  let properties = await db.select().from(propertiesTable).orderBy(propertiesTable.address);

  if (q) {
    const lower = q.toLowerCase();
    properties = properties.filter(
      (p) =>
        p.address.toLowerCase().includes(lower) ||
        (p.resident1Name && p.resident1Name.toLowerCase().includes(lower)) ||
        (p.resident2Name && p.resident2Name.toLowerCase().includes(lower))
    );
  }

  res.json(properties);
});

router.get("/properties/:propertyId", requireAuth, async (req, res): Promise<void> => {
  const propertyId = parseInt(req.params.propertyId as string, 10);
  if (isNaN(propertyId)) { res.status(400).json({ error: "Invalid property ID" }); return; }

  const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, propertyId));
  if (!property) { res.status(404).json({ error: "Property not found" }); return; }

  res.json(property);
});

/** GET /api/properties/:propertyId/ledger — Rentec statement, sheet fallback. */
router.get("/properties/:propertyId/ledger", requireAuth, async (req, res): Promise<void> => {
  const propertyId = parseInt(req.params.propertyId as string, 10);
  if (isNaN(propertyId)) { res.status(400).json({ error: "Invalid property ID" }); return; }

  const [property] = await db.select().from(propertiesTable).where(eq(propertiesTable.id, propertyId));
  if (!property) { res.status(404).json({ error: "Property not found" }); return; }

  const statement = await getPropertyLedger(property.address, property.resident1Name);
  res.json(statement);
});

export default router;
