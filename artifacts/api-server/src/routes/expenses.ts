import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, expensesTable, activityTable } from "@workspace/db";
import { CreateExpenseBody, UpdateExpenseBody, UpdateExpenseParams } from "@workspace/api-zod";
import { requireAuth, type AuthRequest } from "../middlewares/auth";
import { uploadBase64ToDrive } from "../lib/google-drive";
import { fireAndForget, fmtDate } from "../lib/sheets-sync";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const SHEET5 = process.env.SHEET_5_ID || "";

function parseParam(raw: string | string[]): string {
  return Array.isArray(raw) ? raw[0] : raw;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_\- ]/g, "").replace(/\s+/g, "_").slice(0, 50);
}

const EXPENSE_CATEGORY_FOLDER: Record<string, string> = {
  "Property Tax": "Property Tax",
  "Water/Sewer": "Utilities",
  "Electric": "Utilities",
  "Gas": "Utilities",
  "Business Insurance": "Insurance",
  "Professional Services": "Professional Services",
  "Recording Fee": "Recording Fees",
  "Canton City Income Tax": "Recording Fees",
  "LLC/State Filing Fee": "Recording Fees",
  "Title/Closing Fee": "Recording Fees",
};

router.get("/expenses", requireAuth, async (req, res): Promise<void> => {
  const expenses = await db.select().from(expensesTable).orderBy(expensesTable.createdAt);
  const filtered = req.query.status
    ? expenses.filter((e) => e.status === req.query.status)
    : expenses;
  res.json(filtered.map((e) => ({ ...e, amount: Number(e.amount) })));
});

router.post("/expenses", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const parsed = CreateExpenseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const d = parsed.data;
  const today = fmtDate();
  const year = d.taxYear ?? new Date().getFullYear();

  const extraData: Record<string, string> = {};
  if (d.parcelNumber) extraData.parcelNumber = d.parcelNumber;
  if (d.billPeriod) extraData.billPeriod = d.billPeriod;
  if (d.confirmationNumber) extraData.confirmationNumber = d.confirmationNumber;
  if (d.provider) extraData.provider = d.provider;
  if (d.accountNumber) extraData.accountNumber = d.accountNumber;
  if (d.billMonth) extraData.billMonth = d.billMonth;
  if (d.occupancyStatus) extraData.occupancyStatus = d.occupancyStatus;
  if (d.referenceNumber) extraData.referenceNumber = d.referenceNumber;
  if (d.dueDate) extraData.dueDate = d.dueDate;

  const [expense] = await db.insert(expensesTable).values({
    description: d.payeeEntity || d.description,
    category: d.category,
    amount: String(d.amount),
    status: "unsorted",
    submittedBy: req.user!.username,
    ...(d.expenseType ? { expenseType: d.expenseType } : {}),
    ...(d.payeeEntity ? { payeeEntity: d.payeeEntity } : {}),
    ...(d.propertyAddress ? { propertyAddress: d.propertyAddress } : {}),
    ...(d.propertyGroup ? { propertyGroup: d.propertyGroup } : {}),
    ...(d.paymentMethod ? { paymentMethod: d.paymentMethod } : {}),
    ...(year ? { taxYear: year } : {}),
    ...(d.notes ? { notes: d.notes } : {}),
    ...(Object.keys(extraData).length > 0 ? { extraDataJson: JSON.stringify(extraData) } : {}),
  }).returning();

  await db.insert(activityTable).values({
    type: "expense_submitted",
    description: `${req.user!.username} submitted expense: ${d.payeeEntity || d.description} ($${d.amount})`,
    user: req.user!.username,
    linkedEntity: "expense",
    linkedId: expense.id,
  });

  res.status(201).json({ ...expense, amount: Number(expense.amount) });

  logger.info(
    { expenseId: expense.id, hasPhoto: Boolean(d.photoBase64), category: d.category, expenseType: d.expenseType },
    "Expense saved — starting background Drive upload + Sheets sync",
  );

  const expenseId = expense.id;
  const hasPhoto = Boolean(d.photoBase64);
  const photoBase64 = d.photoBase64;

  void (async () => {
    let photoUrl: string | null = null;

    if (hasPhoto && photoBase64) {
      const now = new Date();
      const dateStr = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}-${now.getFullYear()}`;
      const catFolder = EXPENSE_CATEGORY_FOLDER[d.category] || "Other";
      const address = d.propertyAddress;
      const nameBase = address
        ? sanitizeFilename(address)
        : sanitizeFilename(d.payeeEntity || "expense");
      const catSlug = sanitizeFilename(d.category);
      const filename = `${nameBase}_${dateStr}_${catSlug}.jpg`;
      const folderPath = ["Receipt Scans", "Operating Expenses", catFolder];

      try {
        photoUrl = await uploadBase64ToDrive(photoBase64, filename, folderPath);
        if (photoUrl) {
          await db.update(expensesTable)
            .set({ photoUrl })
            .where(eq(expensesTable.id, expenseId));
          logger.info({ expenseId, filename, folderPath }, "Expense Drive upload succeeded, DB patched");
        } else {
          logger.error({ expenseId, filename, folderPath }, "Drive upload returned null for expense receipt");
        }
      } catch (err: any) {
        logger.error(
          { expenseId, filename, folderPath, err: String(err?.message ?? err) },
          "Drive upload threw for expense receipt",
        );
      }
    }

    if (!SHEET5) {
      logger.error({ expenseId }, "Skipping Sheet 5 write: SHEET_5_ID is not set");
      return;
    }
    if (!d.expenseType) {
      logger.warn({ expenseId }, "Skipping Sheet 5 write: expenseType not set on body");
      return;
    }

    const receiptUrl = photoUrl ?? "";

    fireAndForget("expense_submitted_main", SHEET5, "All Operating Expenses", {
      type: "append",
      rowData: [
        today,
        d.expenseType,
        d.category,
        d.payeeEntity ?? "",
        d.propertyAddress ?? "",
        d.propertyGroup ?? "",
        d.amount,
        d.paymentMethod ?? "",
        receiptUrl,
        year,
        d.notes ?? "",
      ],
    });

    if (d.category === "Property Tax") {
      const taxNotes = d.confirmationNumber
        ? d.notes
          ? `${d.confirmationNumber} — ${d.notes}`
          : d.confirmationNumber
        : (d.notes ?? "");
      fireAndForget("expense_property_tax", SHEET5, "⚠ Property Tax Tracker", {
        type: "append",
        rowData: [
          d.propertyAddress ?? "",
          d.propertyGroup ?? "",
          d.parcelNumber ?? "",
          year,
          d.billPeriod ?? "",
          d.amount,
          "",
          today,
          d.amount,
          "PAID",
          taxNotes,
        ],
      });
    }

    const UTILITY_CATS = ["Water/Sewer", "Electric", "Gas"];
    if (UTILITY_CATS.includes(d.category)) {
      fireAndForget("expense_utility", SHEET5, "Utility Tracker", {
        type: "append",
        rowData: [
          d.propertyAddress ?? "",
          d.propertyGroup ?? "",
          d.category,
          d.provider ?? "",
          d.accountNumber ?? "",
          d.billMonth ?? "",
          d.amount,
          today,
          d.occupancyStatus ?? "",
          year,
          d.notes ?? "",
        ],
      });
    }

    const GOV_CATS = [
      "Canton City Income Tax",
      "Recording Fee",
      "Title/Closing Fee",
      "LLC/State Filing Fee",
    ];
    if (GOV_CATS.includes(d.category)) {
      const refNotes = d.referenceNumber
        ? d.notes
          ? `${d.referenceNumber} — ${d.notes}`
          : d.referenceNumber
        : (d.notes ?? "");
      fireAndForget("expense_gov_fee", SHEET5, "Government Fees & Compliance", {
        type: "append",
        rowData: [
          today,
          d.category,
          d.payeeEntity ?? "",
          d.propertyAddress ?? "",
          d.amount,
          d.dueDate ?? "",
          today,
          "PAID",
          year,
          refNotes,
        ],
      });
    }
  })();
});

router.patch("/expenses/:expenseId", requireAuth, async (req: AuthRequest, res): Promise<void> => {
  const raw = parseParam(req.params.expenseId);
  const expenseId = parseInt(raw, 10);
  if (isNaN(expenseId)) { res.status(400).json({ error: "Invalid expense ID" }); return; }

  const parsed = UpdateExpenseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const [expense] = await db.update(expensesTable)
    .set(parsed.data)
    .where(eq(expensesTable.id, expenseId))
    .returning();

  if (!expense) { res.status(404).json({ error: "Expense not found" }); return; }

  res.json({ ...expense, amount: Number(expense.amount) });
});

export default router;
