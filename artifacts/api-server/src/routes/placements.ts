import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, placementsTable, activityTable } from "@workspace/db";
import { CreatePlacementBody } from "@workspace/api-zod";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { fireAndForget, fmtDate } from "../lib/sheets-sync";

const router: IRouter = Router();

const ICONN = process.env.ICONN_SHEET_ID || "";

function parseParam(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

router.get("/placements/summary", requireAuth, async (_req, res): Promise<void> => {
  const year = new Date().getFullYear();
  const yearStart = `${year}-01-01`;

  const allYtd = await db.select().from(placementsTable)
    .where(sql`${placementsTable.placementDate} >= ${yearStart}`);

  const ytdCount = allYtd.length;
  const ytdRevenue = allYtd.reduce((sum, p) => sum + Number(p.amount), 0);
  const paidCount = allYtd.filter((p) => p.paymentStatus === "paid").length;
  const unpaidCount = allYtd.filter((p) => p.paymentStatus === "unpaid").length;

  res.json({ ytdCount, ytdRevenue, paidCount, unpaidCount });
});

router.get("/placements", requireAuth, async (_req, res): Promise<void> => {
  const placements = await db.select().from(placementsTable)
    .orderBy(sql`${placementsTable.createdAt} DESC`);
  res.json(placements.map((p) => ({ ...p, amount: Number(p.amount) })));
});

router.post("/placements", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const parsed = CreatePlacementBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const year = new Date().getFullYear();
  const count = await db.select({ count: sql<number>`count(*)` }).from(placementsTable);
  const num = (Number(count[0]?.count) || 0) + 1;
  const placementNumber = `ICONN-${year}-${String(num).padStart(3, "0")}`;
  const invoiceNumber = `ICONN-INV-${year}-${String(num).padStart(3, "0")}`;

  const [placement] = await db.insert(placementsTable).values({
    invoiceNumber: placementNumber,
    address: parsed.data.address,
    residentName: parsed.data.residentName,
    placementDate: parsed.data.placementDate instanceof Date
      ? parsed.data.placementDate.toISOString().split("T")[0]
      : parsed.data.placementDate,
    paymentStatus: "unpaid",
    amount: "2500",
    submittedBy: req.user!.username,
  }).returning();

  await db.insert(activityTable).values({
    type: "placement_logged",
    description: `ICONN placement logged at ${parsed.data.address} — ${parsed.data.residentName}`,
    user: req.user!.username,
    linkedEntity: "placement",
    linkedId: placement.id,
  });

  res.status(201).json({ ...placement, amount: Number(placement.amount) });

  // Trigger 8: Iconn Placement Logged
  if (ICONN) {
    const today = fmtDate();
    const placementDateStr = parsed.data.placementDate
      ? fmtDate(new Date(parsed.data.placementDate))
      : today;

    // 8A — Placement Register
    // Headers: Invoice # | Property Address | Resident / Buyer Name |
    //          Placement Date | Invoice Date | Invoice Amount |
    //          Payment Received | Date Paid | Days to Pay | Status | Notes
    fireAndForget("placement_logged_register", ICONN, "Placement Register", {
      type: "append",
      rowData: [
        invoiceNumber,
        parsed.data.address,
        parsed.data.residentName,
        placementDateStr,
        today,
        2500.00,
        "",
        "",
        "",
        "Unpaid",
        "",
      ],
    });

    // 8B — Invoice Log
    // Headers: Invoice # | Property Address | Placement Date | Invoice Date |
    //          Invoice Amount | Payment Received | Date Paid | Tax Year |
    //          Status | Notes
    fireAndForget("placement_logged_invoice", ICONN, "Invoice Log", {
      type: "append",
      rowData: [
        invoiceNumber,
        parsed.data.address,
        placementDateStr,
        today,
        2500.00,
        "",
        "",
        year,
        "Unpaid",
        "",
      ],
    });
  }
});

router.post("/placements/:placementId/mark-paid", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const raw = parseParam(req.params.placementId);
  const placementId = parseInt(raw, 10);
  if (isNaN(placementId)) { res.status(400).json({ error: "Invalid placement ID" }); return; }

  const [existing] = await db.select().from(placementsTable)
    .where(eq(placementsTable.id, placementId));
  if (!existing) { res.status(404).json({ error: "Placement not found" }); return; }

  const [placement] = await db.update(placementsTable)
    .set({ paymentStatus: "paid" })
    .where(eq(placementsTable.id, placementId))
    .returning();

  if (!placement) { res.status(404).json({ error: "Placement not found" }); return; }

  res.json({ ...placement, amount: Number(placement.amount) });

  // Trigger 9: Iconn Payment Received
  if (ICONN) {
    const today = fmtDate();
    // existing.invoiceNumber is the "ICONN-YYYY-XXX" id; the canonical id used
    // in both ICONN sheet tabs is the "ICONN-INV-YYYY-XXX" form.
    const placementNumber = existing.invoiceNumber;
    const invoiceNumber = placementNumber.replace("ICONN-", "ICONN-INV-");

    // 9A — Placement Register (matches on Invoice #, not "Placement #")
    fireAndForget("iconn_payment_register", ICONN, "Placement Register", {
      type: "update",
      matchCol: "Invoice #",
      matchVal: invoiceNumber,
      updates: {
        "Payment Received": 2500.00,
        "Date Paid": today,
        "Status": "Paid",
      },
    });

    // 9B — Invoice Log
    fireAndForget("iconn_payment_invoice", ICONN, "Invoice Log", {
      type: "update",
      matchCol: "Invoice #",
      matchVal: invoiceNumber,
      updates: {
        "Payment Received": 2500.00,
        "Date Paid": today,
        "Status": "Paid",
      },
    });
  }
});

export default router;
