import { Router, type IRouter } from "express";
import multer from "multer";
import { google } from "googleapis";
import { desc, eq } from "drizzle-orm";
import {
  db,
  tenantApplicationsTable,
  utilitySubmissionsTable,
} from "@workspace/db";
import { requireAuth, requireRole, type AuthRequest } from "../middlewares/auth";
import { fireAndForget, fmtDate } from "../lib/sheets-sync";
import {
  resolveOrCreateNchFolderPath,
  resolveOrCreateFolderPath,
} from "../lib/google-drive";
import { sendEmail, renderFieldsHtml } from "../lib/email";
import { notifyUser } from "../lib/web-push";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const TENANT_APP_SHEET_ID = "1a19ciFDc_wp9QIpDMqI0_XYd-zjXuMM4w9C8UqF1Zw8";
const UTILITY_SHEET_ID = "1_TFYppOupx96gsUR-vdmRBknwuFRu9VKuzXOvBPypwY";
const NOTIFY_EMAIL = "jacob@nicecityhomes.com";

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

function buildDriveCredentials(): { client_email: string; private_key: string } {
  const email = process.env.GOOGLE_CLIENT_EMAIL;
  const rawKey = process.env.GOOGLE_PRIVATE_KEY;
  if (!email || !rawKey) throw new Error("Google credentials not configured");
  let privateKey = rawKey;
  const jsonMatch = rawKey.match(/"private_key"\s*:\s*"([\s\S]+?)(?<!\\)"\s*[,}]?/);
  if (jsonMatch) privateKey = jsonMatch[1];
  privateKey = privateKey.replace(/\\n/g, "\n").trim();
  return { client_email: email, private_key: privateKey };
}

function getWriteDrive() {
  const creds = buildDriveCredentials();
  const scopes = ["https://www.googleapis.com/auth/drive"];
  const impersonate = process.env.GOOGLE_IMPERSONATE_USER;
  const auth = impersonate
    ? new google.auth.JWT({
        email: creds.client_email,
        key: creds.private_key,
        scopes,
        subject: impersonate,
      })
    : new google.auth.GoogleAuth({ credentials: creds, scopes });
  return google.drive({ version: "v3", auth: auth as never });
}

async function uploadBufferToDrive(
  buffer: Buffer,
  filename: string,
  mimeType: string,
  folderPath: string[],
): Promise<string | null> {
  try {
    const { Readable } = await import("stream");
    let folderId: string;
    try {
      folderId = await resolveOrCreateNchFolderPath(folderPath);
    } catch {
      folderId = await resolveOrCreateFolderPath(folderPath);
    }
    const drive = getWriteDrive();
    const resp = await drive.files.create({
      requestBody: { name: filename, mimeType, parents: [folderId] },
      media: { mimeType, body: Readable.from(buffer) },
      fields: "id,webViewLink",
      supportsAllDrives: true,
    });
    const fileId = resp.data.id!;
    const webViewLink =
      resp.data.webViewLink ?? `https://drive.google.com/file/d/${fileId}/view`;
    try {
      await drive.permissions.create({
        fileId,
        requestBody: { role: "reader", type: "anyone" },
      });
    } catch {
      // non-fatal
    }
    return webViewLink;
  } catch (err: any) {
    logger.error(
      { filename, err: String(err?.message ?? err) },
      "Form file upload to Drive failed",
    );
    return null;
  }
}

function safeFolderSegment(s: string): string {
  return s.replace(/[^\w\- ]+/g, "_").trim().slice(0, 80) || "Unknown";
}

function ext(mime: string, originalName: string): string {
  const byName = /\.[a-z0-9]{2,5}$/i.exec(originalName || "");
  if (byName) return byName[0].toLowerCase();
  if (mime === "image/jpeg") return ".jpg";
  if (mime === "image/png") return ".png";
  if (mime === "application/pdf") return ".pdf";
  return "";
}

const ALLOWED_UPLOAD_MIMES = new Set([
  "image/jpeg",
  "image/png",
  "application/pdf",
]);

// ─── PUBLIC: Property list (addresses + tenant names for the apply form) ─────
router.get("/public/properties", async (_req, res) => {
  try {
    const { propertiesTable: pt } = await import("@workspace/db");
    const rows = await db.select({
      id: pt.id,
      address: pt.address,
      resident1Name: pt.resident1Name,
      resident2Name: pt.resident2Name,
    }).from(pt).orderBy(pt.address);
    res.json(rows);
  } catch (err: any) {
    logger.error({ err: String(err?.message ?? err) }, "Public properties fetch failed");
    res.json([]);
  }
});

// ─── PUBLIC: Tenant Application ──────────────────────────────────────
router.post(
  "/public/tenant-application",
  upload.fields([
    { name: "idFile", maxCount: 1 },
    { name: "proofFile", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const b = req.body as Record<string, string>;
      const files = req.files as Record<string, Express.Multer.File[] | undefined>;

      const required: Record<string, string> = {
        loginEmail: b.loginEmail,
        propertyAddress: b.propertyAddress,
        viewedProperty: b.viewedProperty,
        moveInDate: b.moveInDate,
        fullLegalName: b.fullLegalName,
        phone: b.phone,
        contactEmail: b.contactEmail,
        employer: b.employer,
        monthlyIncome: b.monthlyIncome,
        occupants: b.occupants,
        pets: b.pets,
      };
      for (const [k, v] of Object.entries(required)) {
        if (!v || String(v).trim() === "") {
          res.status(400).json({ error: `Missing required field: ${k}` });
          return;
        }
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.loginEmail)) {
        res.status(400).json({ error: "Invalid login email" });
        return;
      }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.contactEmail)) {
        res.status(400).json({ error: "Invalid contact email" });
        return;
      }
      if (!/^\d{3}-\d{3}-\d{4}$/.test(b.phone)) {
        res.status(400).json({ error: "Phone must be xxx-xxx-xxxx" });
        return;
      }

      const idFile = files?.idFile?.[0];
      if (!idFile) {
        res.status(400).json({ error: "Driver's License / Photo ID is required" });
        return;
      }
      if (!ALLOWED_UPLOAD_MIMES.has(idFile.mimetype)) {
        res.status(400).json({ error: "ID must be JPG, PNG, or PDF" });
        return;
      }
      const proofFile = files?.proofFile?.[0];
      if (proofFile && !ALLOWED_UPLOAD_MIMES.has(proofFile.mimetype)) {
        res.status(400).json({ error: "Proof of income must be JPG, PNG, or PDF" });
        return;
      }

      const submittedOn = fmtDate();
      const folderSegments = [
        "Applications",
        `${safeFolderSegment(b.fullLegalName)}_${submittedOn.replace(/\//g, "-")}`,
      ];

      const idUrl = await uploadBufferToDrive(
        idFile.buffer,
        `ID_${safeFolderSegment(b.fullLegalName)}${ext(idFile.mimetype, idFile.originalname)}`,
        idFile.mimetype,
        folderSegments,
      );
      let proofUrl: string | null = null;
      if (proofFile) {
        proofUrl = await uploadBufferToDrive(
          proofFile.buffer,
          `Income_${safeFolderSegment(b.fullLegalName)}${ext(proofFile.mimetype, proofFile.originalname)}`,
          proofFile.mimetype,
          folderSegments,
        );
      }

      const [row] = await db
        .insert(tenantApplicationsTable)
        .values({
          loginEmail: b.loginEmail,
          propertyAddress: b.propertyAddress,
          viewedProperty: b.viewedProperty === "yes" ? "yes" : "no",
          moveInDate: b.moveInDate,
          fullLegalName: b.fullLegalName,
          phone: b.phone,
          contactEmail: b.contactEmail,
          employer: b.employer,
          monthlyIncome: b.monthlyIncome,
          occupants: b.occupants,
          pets: b.pets,
          secondContact: b.secondContact ?? "",
          idFileUrl: idUrl,
          proofFileUrl: proofUrl,
        })
        .returning();

      fireAndForget(
        "tenant_application_submitted",
        TENANT_APP_SHEET_ID,
        "Sheet1",
        {
          type: "append",
          rowData: [
            submittedOn,
            b.loginEmail,
            b.propertyAddress,
            b.viewedProperty,
            b.moveInDate,
            b.fullLegalName,
            b.phone,
            b.contactEmail,
            b.employer,
            b.monthlyIncome,
            b.occupants,
            b.pets,
            b.secondContact ?? "",
            idUrl ?? "",
            proofUrl ?? "",
          ],
        },
      );

      // Push notification — fire and forget
      void notifyUser("jacob", {
        title: "New Tenant Application",
        body: `${b.fullLegalName} applied for ${b.propertyAddress}`,
        url: "/forms",
      });

      // Email — fire and forget
      void sendEmail({
        to: NOTIFY_EMAIL,
        subject: `New Tenant Application — ${b.fullLegalName} — ${b.propertyAddress}`,
        html: `
<div style="font-family:monospace;font-size:14px;white-space:pre-wrap;max-width:600px;">
<h2 style="color:#8B0000;font-family:sans-serif;">NEW TENANT APPLICATION RECEIVED</h2>
<hr/>
<strong>Submitted:</strong> ${submittedOn}

<strong>APPLICANT INFO:</strong>
Name: ${b.fullLegalName}
Phone: ${b.phone}
Email: ${b.contactEmail}

<strong>PROPERTY:</strong>
Applying For: ${b.propertyAddress}
Viewed Property: ${b.viewedProperty === "yes" ? "Yes" : "No"}
Desired Move-In: ${b.moveInDate}

<strong>EMPLOYMENT:</strong>
Employer: ${b.employer}
Monthly Income: $${b.monthlyIncome}

<strong>HOUSEHOLD:</strong>
Occupants: ${b.occupants}
Pets: ${b.pets || "None"}

<strong>SECOND CONTACT:</strong>
${b.secondContact?.trim() || "None provided"}

<strong>DOCUMENTS:</strong>
ID Photo: ${idUrl ? `<a href="${idUrl}">${idUrl}</a>` : "Not uploaded"}
Proof of Income: ${proofUrl ? `<a href="${proofUrl}">${proofUrl}</a>` : "Not uploaded"}

<hr/>
<a href="https://app.nicecityhomes.com" style="color:#8B0000;">View full application in app</a>
</div>`,
      });

      res.status(201).json({ ok: true, id: row.id, firstName: b.fullLegalName.split(/\s+/)[0] });
    } catch (err: any) {
      logger.error({ err: String(err?.message ?? err) }, "Tenant application submit failed");
      res.status(500).json({ error: "Submission failed. Please try again." });
    }
  },
);

// ─── PUBLIC: Utility Accounts ────────────────────────────────────────
router.post("/public/utility-submission", async (req, res) => {
  try {
    const b = req.body as Record<string, string>;
    const required: Record<string, string> = {
      email: b.email,
      accountHolder: b.accountHolder,
      propertyAddress: b.propertyAddress,
      electricProvider: b.electricProvider,
      electricAccount: b.electricAccount,
      gasProvider: b.gasProvider,
      gasAccount: b.gasAccount,
      waterProvider: b.waterProvider,
      waterAccount: b.waterAccount,
    };
    for (const [k, v] of Object.entries(required)) {
      if (!v || String(v).trim() === "") {
        res.status(400).json({ error: `Missing required field: ${k}` });
        return;
      }
    }
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(b.email)) {
      res.status(400).json({ error: "Invalid email" });
      return;
    }

    const [row] = await db
      .insert(utilitySubmissionsTable)
      .values({
        email: b.email,
        accountHolder: b.accountHolder,
        propertyAddress: b.propertyAddress,
        electricProvider: b.electricProvider,
        electricAccount: b.electricAccount,
        gasProvider: b.gasProvider,
        gasAccount: b.gasAccount,
        waterProvider: b.waterProvider,
        waterAccount: b.waterAccount,
      })
      .returning();

    const submittedOn = fmtDate();
    fireAndForget("utility_submission", UTILITY_SHEET_ID, "Sheet1", {
      type: "append",
      rowData: [
        submittedOn,
        b.propertyAddress,
        b.accountHolder,
        b.email,
        b.electricProvider,
        b.electricAccount,
        b.gasProvider,
        b.gasAccount,
        b.waterProvider,
        b.waterAccount,
      ],
    });

    // Push notification — fire and forget
    void notifyUser("jacob", {
      title: "Utility Accounts Submitted",
      body: `${b.accountHolder} — ${b.propertyAddress}`,
      url: "/forms",
    });

    // Email — fire and forget
    void sendEmail({
      to: NOTIFY_EMAIL,
      subject: `Utility Accounts: ${b.accountHolder} — ${b.propertyAddress}`,
      html: `
<div style="font-family:monospace;font-size:14px;white-space:pre-wrap;max-width:600px;">
<h2 style="color:#8B0000;font-family:sans-serif;">UTILITY ACCOUNTS SUBMITTED</h2>
<hr/>
<strong>Submitted:</strong> ${submittedOn}

Tenant: ${b.accountHolder}
Property: ${b.propertyAddress}
Email: ${b.email}

<strong>ACCOUNTS:</strong>
Electric: ${b.electricProvider} — Account #${b.electricAccount}
Gas: ${b.gasProvider} — Account #${b.gasAccount}
Water: ${b.waterProvider} — Account #${b.waterAccount}

<hr/>
<a href="https://app.nicecityhomes.com" style="color:#8B0000;">View in app</a>
</div>`,
    });

    res.status(201).json({ ok: true, id: row.id });
  } catch (err: any) {
    logger.error({ err: String(err?.message ?? err) }, "Utility submission failed");
    res.status(500).json({ error: "Submission failed. Please try again." });
  }
});

// ─── JACOB ONLY: list submissions ─────────────────────────────────────
router.get(
  "/forms/tenant-applications",
  requireAuth,
  requireRole("jacob"),
  async (_req: AuthRequest, res) => {
    const rows = await db
      .select()
      .from(tenantApplicationsTable)
      .orderBy(desc(tenantApplicationsTable.createdAt))
      .limit(500);
    res.json(rows);
  },
);

router.get(
  "/forms/utility-submissions",
  requireAuth,
  requireRole("jacob"),
  async (_req: AuthRequest, res) => {
    const rows = await db
      .select()
      .from(utilitySubmissionsTable)
      .orderBy(desc(utilitySubmissionsTable.createdAt))
      .limit(500);
    res.json(rows);
  },
);

// ─── JACOB ONLY: update application status ─────────────────────────────
router.patch(
  "/forms/tenant-applications/:id/status",
  requireAuth,
  requireRole("jacob"),
  async (req: AuthRequest, res) => {
    const id = Number(req.params.id);
    const { status } = req.body as { status: string };
    const valid = ["new", "approved", "declined", "pending"];
    if (!valid.includes(status)) {
      res.status(400).json({ error: "Invalid status" });
      return;
    }
    const [row] = await db
      .update(tenantApplicationsTable)
      .set({ status: status as "new" | "approved" | "declined" | "pending" })
      .where(eq(tenantApplicationsTable.id, id))
      .returning();
    if (!row) {
      res.status(404).json({ error: "Not found" });
      return;
    }
    res.json(row);
  },
);

export default router;
