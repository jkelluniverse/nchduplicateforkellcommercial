import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const PRIMARY_RED = "#B23A2E";
const DARK_TEXT = "#1A1A1A";
const LIGHT_GRAY = "#FAFAFA";
const GRID_COLOR = "#CCCCCC";
const PG_W = 612;
const PG_H = 792;
const M = 40;
const USABLE = PG_W - M * 2;

// Column widths for line-items table
const COL_DESC  = 305;
const COL_QTY   = 47;
const COL_PRICE = 90;
const COL_AMT   = 90;

// Column X positions
const X_DESC  = M;
const X_QTY   = X_DESC + COL_DESC;
const X_PRICE = X_QTY + COL_QTY;
const X_AMT   = X_PRICE + COL_PRICE;

const FOOTER_TEXT = "Nice City Homes LLC  ·  330-495-8192  ·  Canton, Ohio  ·  Home Ownership Specialists";

// Kell Commercial company identity — used by the court-ready account-balance
// statement and the Past Due Notice. Override any piece via env for the exact
// legal entity details on filings.
const COMPANY_NAME = process.env.COMPANY_NAME || "Kell Commercial Leasing";
const COMPANY_ADDRESS = process.env.COMPANY_ADDRESS || "2202 31st St NE, Canton, OH 44705";
const COMPANY_PHONE = process.env.COMPANY_PHONE || "330-495-7821";
const COMPANY_STATEMENT_LINE =
  process.env.COMPANY_STATEMENT_LINE || `${COMPANY_NAME} · ${COMPANY_ADDRESS} · ${COMPANY_PHONE}`;

// Light red tint for alternating Past Due Notice table rows.
const LIGHT_RED = "#F3E3E3";

export interface LineItem {
  title: string;
  bullets?: string[];
  qty: number;
  price: number;
}

export interface EstimateData {
  doc_number: string;
  issued_date: string;
  client_name: string;
  client_address: string;
  line_items: LineItem[];
}

export interface InvoiceData extends EstimateData {
  deposit_paid: number;
}

function fmt(n: number): string {
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function logoPath(): string {
  try {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    return path.join(__dirname, "..", "assets", "NCH_LOGO.png");
  } catch {
    return path.join(process.cwd(), "assets", "NCH_LOGO.png");
  }
}

function drawLine(doc: PDFKit.PDFDocument, x1: number, y: number, x2: number, color = PRIMARY_RED, width = 0.75) {
  doc.save().moveTo(x1, y).lineTo(x2, y).strokeColor(color).lineWidth(width).stroke().restore();
}

function drawHeader(doc: PDFKit.PDFDocument, docType: "ESTIMATE" | "INVOICE", data: EstimateData, dueDate?: string): number {
  let y = M;

  // Logo (top-left)
  const lp = logoPath();
  if (fs.existsSync(lp)) {
    doc.image(lp, M, y, { width: 130, height: 50 });
  } else {
    doc.save()
      .font("Helvetica-Bold").fontSize(18).fillColor(PRIMARY_RED)
      .text("NCH", M, y + 10, { width: 130, align: "left" })
      .restore();
  }

  // Title (top-right)
  doc.save()
    .font("Helvetica-Bold").fontSize(28).fillColor(PRIMARY_RED)
    .text(docType, M, y + 6, { width: USABLE, align: "right" })
    .restore();

  y += 58;

  // Doc number / dates row
  doc.save()
    .font("Helvetica-Bold").fontSize(10).fillColor(DARK_TEXT)
    .text(data.doc_number, M, y, { width: USABLE / 2 })
    .restore();

  const dateStr = dueDate
    ? `Issued: ${data.issued_date}    Due: ${dueDate}`
    : `Issued: ${data.issued_date}`;

  doc.save()
    .font("Helvetica").fontSize(10).fillColor(DARK_TEXT)
    .text(dateStr, M, y, { width: USABLE, align: "right" })
    .restore();

  y += 18;

  // Red divider
  drawLine(doc, M, y, M + USABLE, PRIMARY_RED, 1.5);
  y += 12;

  // FROM / BILL TO
  const colW = USABLE / 2 - 10;
  doc.save().font("Helvetica-Bold").fontSize(9).fillColor(PRIMARY_RED).text("FROM", M, y).restore();
  doc.save().font("Helvetica-Bold").fontSize(9).fillColor(PRIMARY_RED).text("BILL TO", M + USABLE / 2, y).restore();
  y += 14;

  const fromLines = ["Nice City Homes LLC", "Jack Kanam", "330-323-6351", "jack@nicecityhomes.com"];
  const toLines = [data.client_name, data.client_address];

  const fromH = fromLines.map((l) => doc.heightOfString(l, { width: colW })).reduce((a, b) => a + b + 2, 0);
  const toH = toLines.map((l) => doc.heightOfString(l, { width: colW })).reduce((a, b) => a + b + 2, 0);
  const blockH = Math.max(fromH, toH);

  let fy = y;
  doc.save().font("Helvetica").fontSize(9.5).fillColor(DARK_TEXT);
  fromLines.forEach((line) => {
    doc.text(line, M, fy, { width: colW });
    fy += doc.heightOfString(line, { width: colW }) + 2;
  });
  doc.restore();

  let ty = y;
  doc.save().font("Helvetica").fontSize(9.5).fillColor(DARK_TEXT);
  toLines.forEach((line) => {
    doc.text(line, M + USABLE / 2, ty, { width: colW });
    ty += doc.heightOfString(line, { width: colW }) + 2;
  });
  doc.restore();

  y += blockH + 16;
  return y;
}

function drawTableHeader(doc: PDFKit.PDFDocument, y: number): number {
  const ROW_H = 22;
  doc.save()
    .rect(M, y, USABLE, ROW_H)
    .fill(PRIMARY_RED)
    .restore();

  const cols: Array<[string, number, number, "left" | "center" | "right"]> = [
    ["DESCRIPTION", X_DESC + 4, COL_DESC - 8, "left"],
    ["QTY",         X_QTY + 2,  COL_QTY - 4,  "center"],
    ["PRICE USD",   X_PRICE + 2, COL_PRICE - 4, "right"],
    ["AMOUNT USD",  X_AMT + 2,  COL_AMT - 6,  "right"],
  ];

  const textY = y + 6;
  cols.forEach(([label, x, w, align]) => {
    doc.save()
      .font("Helvetica-Bold").fontSize(8.5).fillColor("#FFFFFF")
      .text(label, x, textY, { width: w, align })
      .restore();
  });

  return y + ROW_H;
}

function calcItemHeight(doc: PDFKit.PDFDocument, item: LineItem): number {
  const titleH = doc.heightOfString(item.title, { width: COL_DESC - 12 });
  let bulletsH = 0;
  if (item.bullets && item.bullets.length > 0) {
    doc.fontSize(8.5);
    bulletsH = item.bullets.reduce((sum, b) => {
      return sum + doc.heightOfString(`• ${b}`, { width: COL_DESC - 20 }) + 1;
    }, 4);
    doc.fontSize(10);
  }
  return Math.max(30, titleH + bulletsH + 14);
}

function drawTableRows(doc: PDFKit.PDFDocument, items: LineItem[], startY: number): { y: number; subtotal: number } {
  let y = startY;
  let subtotal = 0;

  items.forEach((item, idx) => {
    const rowH = calcItemHeight(doc, item);
    const bg = idx % 2 === 0 ? "#FFFFFF" : LIGHT_GRAY;

    // Row background
    doc.save().rect(M, y, USABLE, rowH).fill(bg).restore();

    // Grid lines
    doc.save().rect(M, y, USABLE, rowH).strokeColor(GRID_COLOR).lineWidth(0.4).stroke().restore();

    // Vertical column dividers
    [X_QTY, X_PRICE, X_AMT].forEach((x) => {
      doc.save().moveTo(x, y).lineTo(x, y + rowH).strokeColor(GRID_COLOR).lineWidth(0.4).stroke().restore();
    });

    const textY = y + 7;

    // Description title
    doc.save()
      .font("Helvetica-Bold").fontSize(9.5).fillColor(DARK_TEXT)
      .text(item.title, X_DESC + 4, textY, { width: COL_DESC - 12 })
      .restore();

    // Bullets
    let bulletY = textY + doc.heightOfString(item.title, { width: COL_DESC - 12 }) + 2;
    if (item.bullets && item.bullets.length > 0) {
      item.bullets.forEach((bullet) => {
        doc.save()
          .font("Helvetica").fontSize(8.5).fillColor("#444444")
          .text(`• ${bullet}`, X_DESC + 12, bulletY, { width: COL_DESC - 20 })
          .restore();
        bulletY += doc.heightOfString(`• ${bullet}`, { width: COL_DESC - 20 }) + 1;
      });
    }

    const amount = item.qty * item.price;
    subtotal += amount;

    // QTY
    doc.save()
      .font("Helvetica").fontSize(9.5).fillColor(DARK_TEXT)
      .text(String(item.qty), X_QTY + 2, textY, { width: COL_QTY - 4, align: "center" })
      .restore();

    // Price
    doc.save()
      .font("Helvetica").fontSize(9.5).fillColor(DARK_TEXT)
      .text(fmt(item.price), X_PRICE + 2, textY, { width: COL_PRICE - 6, align: "right" })
      .restore();

    // Amount
    doc.save()
      .font("Helvetica").fontSize(9.5).fillColor(DARK_TEXT)
      .text(fmt(amount), X_AMT + 2, textY, { width: COL_AMT - 8, align: "right" })
      .restore();

    y += rowH;
  });

  // Closing border for table
  doc.save().rect(M, startY, USABLE, y - startY).strokeColor(GRID_COLOR).lineWidth(0.5).stroke().restore();

  return { y, subtotal };
}

function drawTotals(
  doc: PDFKit.PDFDocument,
  y: number,
  subtotal: number,
  isInvoice: boolean,
  depositOrRequired: number,
): number {
  y += 10;
  const LBL_W = 160;
  const AMT_W = 100;
  const TOT_X = M + USABLE - LBL_W - AMT_W;
  const AMT_X = TOT_X + LBL_W;

  function totRow(label: string, amount: string, bold = false) {
    doc.save()
      .font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor(DARK_TEXT)
      .text(label, TOT_X, y, { width: LBL_W, align: "right" })
      .restore();
    doc.save()
      .font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor(DARK_TEXT)
      .text(amount, AMT_X, y, { width: AMT_W, align: "right" })
      .restore();
    y += 16;
  }

  totRow("Subtotal:", fmt(subtotal));

  if (isInvoice) {
    totRow("Deposit Paid:", fmt(depositOrRequired));
    const balance = Math.max(0, subtotal - depositOrRequired);
    y += 4;
    // Balance due bar
    doc.save()
      .rect(TOT_X - 8, y, LBL_W + AMT_W + 8, 26)
      .fill(PRIMARY_RED)
      .restore();
    doc.save()
      .font("Helvetica-Bold").fontSize(11).fillColor("#FFFFFF")
      .text("BALANCE DUE:", TOT_X - 4, y + 7, { width: LBL_W, align: "right" })
      .restore();
    doc.save()
      .font("Helvetica-Bold").fontSize(11).fillColor("#FFFFFF")
      .text(fmt(balance), AMT_X, y + 7, { width: AMT_W, align: "right" })
      .restore();
  } else {
    totRow(`Deposit Required (50%):`, fmt(depositOrRequired));
    y += 4;
    // Estimate total bar
    doc.save()
      .rect(TOT_X - 8, y, LBL_W + AMT_W + 8, 26)
      .fill(PRIMARY_RED)
      .restore();
    doc.save()
      .font("Helvetica-Bold").fontSize(11).fillColor("#FFFFFF")
      .text("ESTIMATE TOTAL:", TOT_X - 4, y + 7, { width: LBL_W, align: "right" })
      .restore();
    doc.save()
      .font("Helvetica-Bold").fontSize(11).fillColor("#FFFFFF")
      .text(fmt(subtotal), AMT_X, y + 7, { width: AMT_W, align: "right" })
      .restore();
  }

  return y + 34;
}

function drawFooter(doc: PDFKit.PDFDocument) {
  const y = PG_H - M - 22;
  drawLine(doc, M, y, M + USABLE, PRIMARY_RED, 0.75);
  doc.save()
    .font("Helvetica").fontSize(7.5).fillColor("#555555")
    .text(FOOTER_TEXT, M, y + 6, { width: USABLE, align: "center" })
    .restore();
}

function drawSignatureBlock(doc: PDFKit.PDFDocument, y: number): number {
  y += 18;
  const fields = ["Client Signature", "Date", "Print Name"];
  const fw = Math.floor(USABLE / 3) - 10;

  fields.forEach((label, i) => {
    const x = M + i * (fw + 15);
    doc.save().moveTo(x, y + 22).lineTo(x + fw, y + 22).strokeColor(DARK_TEXT).lineWidth(0.5).stroke().restore();
    doc.save()
      .font("Helvetica").fontSize(8.5).fillColor("#666666")
      .text(label, x, y + 25, { width: fw, align: "center" })
      .restore();
  });

  return y + 44;
}

function tempFilePath(filename: string): string {
  return path.join(os.tmpdir(), filename);
}

export async function generateEstimate(data: EstimateData): Promise<string> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 0, autoFirstPage: true });
    const filename = `${data.doc_number}_${data.client_name.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`;
    const filePath = tempFilePath(filename);
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    let y = drawHeader(doc, "ESTIMATE", data);
    y = drawTableHeader(doc, y);
    const { y: afterRows, subtotal } = drawTableRows(doc, data.line_items, y);
    y = drawTotals(doc, afterRows, subtotal, false, subtotal * 0.5);

    y += 10;
    drawLine(doc, M, y, M + USABLE, GRID_COLOR, 0.4);
    y += 10;

    // Payment terms
    doc.save()
      .font("Helvetica").fontSize(9).fillColor(DARK_TEXT)
      .text(
        "50% deposit required to schedule work. Remaining balance due upon completion. " +
        "Accepted: cash, check payable to Nice City Homes LLC, or Zelle.",
        M, y, { width: USABLE }
      )
      .restore();
    y += doc.heightOfString(
      "50% deposit required to schedule work. Remaining balance due upon completion. Accepted: cash, check payable to Nice City Homes LLC, or Zelle.",
      { width: USABLE }
    ) + 6;

    y = drawSignatureBlock(doc, y);
    drawFooter(doc);

    doc.end();
    stream.on("finish", () => resolve(filePath));
    stream.on("error", reject);
  });
}

const TAGLINE = "TRANSFORMING PROPERTIES, ONE PROJECT AT A TIME.";

export interface FromContact {
  name: string;
  phone: string;
  email: string;
}

export interface StatementData {
  doc_number: string;
  issued_date: string;
  client_name: string;
  client_address: string;
  from_contact: FromContact;
  scope_items: LineItem[]; // descriptive scope, shown at $0.00
  summary_label: string; // e.g. "All Material and Labor"
  total: number; // the billed amount (cost + margin) — the customer total
}

export interface ReceiptCost {
  category: string;
  vendor: string | null;
  notes: string | null;
  date: string | null;
  amount: number;
}

export interface CostDetailData {
  doc_number: string;
  issued_date: string;
  job_number: string;
  client_name: string;
  client_address: string;
  receipts: ReceiptCost[];
  total_cost: number;
  billed: number;
  margin_amount: number;
  margin_pct: number;
}

/** Customer Statement header: logo + tagline (left), STATEMENT + number (right). */
function drawStatementHeader(doc: PDFKit.PDFDocument, data: StatementData): number {
  let y = M;
  const lp = logoPath();
  if (fs.existsSync(lp)) {
    doc.image(lp, M, y, { width: 130, height: 50 });
  } else {
    doc.save().font("Helvetica-Bold").fontSize(18).fillColor(PRIMARY_RED).text("NCH", M, y + 10).restore();
  }
  doc.save().font("Helvetica-Bold").fontSize(11).fillColor(DARK_TEXT)
    .text("Nice City Homes", M, y + 52).restore();
  doc.save().font("Helvetica").fontSize(7).fillColor("#666666")
    .text(TAGLINE, M, y + 66, { width: 260 }).restore();

  doc.save().font("Helvetica-Bold").fontSize(28).fillColor(PRIMARY_RED)
    .text("STATEMENT", M, y + 6, { width: USABLE, align: "right" }).restore();
  doc.save().font("Helvetica-Bold").fontSize(10).fillColor(DARK_TEXT)
    .text(data.doc_number, M, y + 40, { width: USABLE, align: "right" }).restore();
  doc.save().font("Helvetica").fontSize(9.5).fillColor(DARK_TEXT)
    .text(`Issued ${data.issued_date}`, M, y + 54, { width: USABLE, align: "right" }).restore();

  y += 86;
  drawLine(doc, M, y, M + USABLE, PRIMARY_RED, 1.5);
  y += 12;

  const colW = USABLE / 2 - 10;
  doc.save().font("Helvetica-Bold").fontSize(9).fillColor(PRIMARY_RED).text("FROM", M, y).restore();
  doc.save().font("Helvetica-Bold").fontSize(9).fillColor(PRIMARY_RED).text("BILL TO", M + USABLE / 2, y).restore();
  y += 14;

  const fromLines = ["Nice City Homes LLC", data.from_contact.name, data.from_contact.phone, data.from_contact.email]
    .filter(Boolean);
  const toLines = [data.client_name, data.client_address].filter(Boolean);
  const blockH = Math.max(fromLines.length, toLines.length) * 13 + 4;

  doc.save().font("Helvetica").fontSize(9.5).fillColor(DARK_TEXT);
  fromLines.forEach((l, i) => doc.text(l, M, y + i * 13, { width: colW }));
  toLines.forEach((l, i) => doc.text(l, M + USABLE / 2, y + i * 13, { width: colW }));
  doc.restore();

  return y + blockH + 14;
}

/** Customer Statement — scope only, single "All Material and Labor" total. No costs. */
export async function generateStatement(data: StatementData): Promise<string> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 0, autoFirstPage: true });
    const filePath = tempFilePath(`${data.doc_number.replace(/[^a-zA-Z0-9-]/g, "_")}.pdf`);
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    let y = drawStatementHeader(doc, data);
    y = drawTableHeader(doc, y);
    const rows: LineItem[] = [
      ...data.scope_items.map((s) => ({ ...s, qty: 0, price: 0 })),
      { title: data.summary_label || "All Material and Labor", qty: 1, price: data.total },
    ];
    const { y: afterRows } = drawTableRows(doc, rows, y);
    y = afterRows + 10;

    const LBL_W = 160, AMT_W = 100;
    const TOT_X = M + USABLE - LBL_W - AMT_W, AMT_X = TOT_X + LBL_W;
    doc.save().rect(TOT_X - 8, y, LBL_W + AMT_W + 8, 26).fill(PRIMARY_RED).restore();
    doc.save().font("Helvetica-Bold").fontSize(11).fillColor("#FFFFFF")
      .text("TOTAL:", TOT_X - 4, y + 7, { width: LBL_W, align: "right" }).restore();
    doc.save().font("Helvetica-Bold").fontSize(11).fillColor("#FFFFFF")
      .text(fmt(data.total), AMT_X, y + 7, { width: AMT_W, align: "right" }).restore();

    const fy = PG_H - M - 22;
    drawLine(doc, M, fy, M + USABLE, PRIMARY_RED, 0.75);
    doc.save().font("Helvetica").fontSize(7.5).fillColor("#555555")
      .text(`${data.doc_number}`, M, fy + 6, { width: USABLE / 2 })
      .text("1 of 1", M + USABLE / 2, fy + 6, { width: USABLE / 2, align: "right" }).restore();

    doc.end();
    stream.on("finish", () => resolve(filePath));
    stream.on("error", reject);
  });
}

/** Internal Cost Detail Report — itemized costs, margin, receipts. NOT for customers. */
export async function generateCostDetail(data: CostDetailData): Promise<string> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 0, autoFirstPage: true });
    const filePath = tempFilePath(`COSTDETAIL_${data.doc_number.replace(/[^a-zA-Z0-9-]/g, "_")}.pdf`);
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    let y = M;
    doc.save().rect(M, y, USABLE, 26).fill(PRIMARY_RED).restore();
    doc.save().font("Helvetica-Bold").fontSize(12).fillColor("#FFFFFF")
      .text("INTERNAL — NOT FOR CUSTOMER", M, y + 7, { width: USABLE, align: "center" }).restore();
    y += 38;

    doc.save().font("Helvetica-Bold").fontSize(16).fillColor(DARK_TEXT)
      .text("Cost Detail Report", M, y).restore();
    doc.save().font("Helvetica").fontSize(9.5).fillColor(DARK_TEXT)
      .text(`${data.doc_number}   ·   Issued ${data.issued_date}`, M, y + 20).restore();
    y += 40;

    doc.save().font("Helvetica-Bold").fontSize(9).fillColor(PRIMARY_RED).text("JOB", M, y).restore();
    doc.save().font("Helvetica").fontSize(9.5).fillColor(DARK_TEXT)
      .text(`${data.job_number}  ·  ${data.client_name}  ·  ${data.client_address}`, M, y + 13, { width: USABLE }).restore();
    y += 34;
    drawLine(doc, M, y, M + USABLE, PRIMARY_RED, 1);
    y += 12;

    const C_DATE = 90, C_AMT = 90, C_DESC = USABLE - C_DATE - C_AMT;
    const X_D = M, X_DT = M + C_DESC, X_A = X_DT + C_DATE;
    doc.save().rect(M, y, USABLE, 20).fill(PRIMARY_RED).restore();
    doc.save().font("Helvetica-Bold").fontSize(8.5).fillColor("#FFFFFF")
      .text("DESCRIPTION", X_D + 4, y + 6, { width: C_DESC - 8 })
      .text("DATE", X_DT + 2, y + 6, { width: C_DATE - 4, align: "center" })
      .text("AMOUNT", X_A + 2, y + 6, { width: C_AMT - 6, align: "right" }).restore();
    y += 20;

    if (data.receipts.length === 0) {
      doc.save().font("Helvetica-Oblique").fontSize(9).fillColor("#666666")
        .text("No costs logged yet.", X_D + 4, y + 6, { width: C_DESC }).restore();
      y += 24;
    } else {
      data.receipts.forEach((r, idx) => {
        const desc = [r.category, r.vendor].filter(Boolean).join(" · ") + (r.notes ? `\n${r.notes}` : "");
        const h = Math.max(24, doc.heightOfString(desc, { width: C_DESC - 8 }) + 12);
        if (idx % 2) { doc.save().rect(M, y, USABLE, h).fill(LIGHT_GRAY).restore(); }
        doc.save().font("Helvetica").fontSize(9).fillColor(DARK_TEXT)
          .text(desc, X_D + 4, y + 6, { width: C_DESC - 8 })
          .text(r.date ?? "", X_DT + 2, y + 6, { width: C_DATE - 4, align: "center" })
          .text(fmt(r.amount), X_A + 2, y + 6, { width: C_AMT - 6, align: "right" }).restore();
        y += h;
      });
    }
    drawLine(doc, M, y, M + USABLE, GRID_COLOR, 0.5);
    y += 14;

    const LBL_W = 180, AMT_W = 110, TOT_X = M + USABLE - LBL_W - AMT_W, AMT_X = TOT_X + LBL_W;
    const row = (label: string, amount: string, bold = false) => {
      doc.save().font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(9.5).fillColor(DARK_TEXT)
        .text(label, TOT_X, y, { width: LBL_W, align: "right" })
        .text(amount, AMT_X, y, { width: AMT_W, align: "right" }).restore();
      y += 16;
    };
    row("Total Cost:", fmt(data.total_cost));
    row("Billed to Customer:", fmt(data.billed), true);
    row("Margin:", `${fmt(data.margin_amount)}  (${data.margin_pct}%)`, true);

    const fy = PG_H - M - 22;
    drawLine(doc, M, fy, M + USABLE, PRIMARY_RED, 0.75);
    doc.save().font("Helvetica-Bold").fontSize(7.5).fillColor(PRIMARY_RED)
      .text("INTERNAL — NOT FOR CUSTOMER", M, fy + 6, { width: USABLE, align: "center" }).restore();

    doc.end();
    stream.on("finish", () => resolve(filePath));
    stream.on("error", reject);
  });
}

export interface AccountBalanceTxn {
  date: string;
  description: string;
  charge: number;
  payment: number;
  balance: number;
}
export interface AccountBalanceData {
  property_address: string;
  tenant_name: string;
  lease_dates?: string;
  generated_date: string;
  transactions: AccountBalanceTxn[];
  total_charged: number;
  total_paid: number;
  balance_due: number;
}

/** Court-ready Account Balance Statement from the DoorLoop ledger. */
export async function generateAccountBalance(data: AccountBalanceData): Promise<string> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 0, autoFirstPage: true });
    const filePath = tempFilePath(`ACCTBAL_${data.property_address.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30)}.pdf`);
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    let y = M;
    const lp = logoPath();
    if (fs.existsSync(lp)) doc.image(lp, M, y, { width: 120, height: 46 });
    doc.save().font("Helvetica-Bold").fontSize(16).fillColor(PRIMARY_RED)
      .text("ACCOUNT BALANCE STATEMENT", M, y + 6, { width: USABLE, align: "right" }).restore();
    doc.save().font("Helvetica").fontSize(8.5).fillColor("#555555")
      .text(COMPANY_STATEMENT_LINE, M, y + 30, { width: USABLE, align: "right" })
      .text(`Generated ${data.generated_date} · for court filing purposes`, M, y + 42, { width: USABLE, align: "right" }).restore();
    y += 64;
    drawLine(doc, M, y, M + USABLE, PRIMARY_RED, 1.5);
    y += 10;

    doc.save().font("Helvetica-Bold").fontSize(10).fillColor(DARK_TEXT).text(data.property_address, M, y).restore();
    doc.save().font("Helvetica").fontSize(9.5).fillColor(DARK_TEXT)
      .text(`Tenant: ${data.tenant_name}${data.lease_dates ? `   ·   Lease: ${data.lease_dates}` : ""}`, M, y + 14).restore();
    y += 36;

    // Table header
    const C_DATE = 70, C_CHG = 80, C_PAY = 80, C_BAL = 85;
    const C_DESC = USABLE - C_DATE - C_CHG - C_PAY - C_BAL;
    const X_DT = M, X_DESC = M + C_DATE, X_CHG = X_DESC + C_DESC, X_PAY = X_CHG + C_CHG, X_BAL = X_PAY + C_PAY;
    const header = () => {
      doc.save().rect(M, y, USABLE, 18).fill(PRIMARY_RED).restore();
      doc.save().font("Helvetica-Bold").fontSize(8).fillColor("#FFFFFF")
        .text("DATE", X_DT + 3, y + 5, { width: C_DATE - 4 })
        .text("DESCRIPTION", X_DESC + 3, y + 5, { width: C_DESC - 6 })
        .text("CHARGES", X_CHG, y + 5, { width: C_CHG - 4, align: "right" })
        .text("PAYMENTS", X_PAY, y + 5, { width: C_PAY - 4, align: "right" })
        .text("BALANCE", X_BAL, y + 5, { width: C_BAL - 6, align: "right" }).restore();
      y += 18;
    };
    header();

    doc.font("Helvetica").fontSize(8.5).fillColor(DARK_TEXT);
    data.transactions.forEach((t, i) => {
      if (y > PG_H - 90) { doc.addPage(); y = M; header(); }
      const h = Math.max(16, doc.heightOfString(t.description, { width: C_DESC - 6 }) + 7);
      if (i % 2) { doc.save().rect(M, y, USABLE, h).fill(LIGHT_GRAY).restore(); }
      doc.save().font("Helvetica").fontSize(8.5).fillColor(DARK_TEXT)
        .text(t.date, X_DT + 3, y + 4, { width: C_DATE - 4 })
        .text(t.description, X_DESC + 3, y + 4, { width: C_DESC - 6 })
        .text(t.charge ? fmt(t.charge) : "", X_CHG, y + 4, { width: C_CHG - 4, align: "right" })
        .text(t.payment ? fmt(t.payment) : "", X_PAY, y + 4, { width: C_PAY - 4, align: "right" })
        .text(fmt(t.balance), X_BAL, y + 4, { width: C_BAL - 6, align: "right" }).restore();
      y += h;
    });
    drawLine(doc, M, y, M + USABLE, GRID_COLOR, 0.75);
    y += 12;

    const LBL_W = 150, AMT_W = 110, TOT_X = M + USABLE - LBL_W - AMT_W, AMT_X = TOT_X + LBL_W;
    const row = (label: string, amount: string, color = DARK_TEXT) => {
      doc.save().font("Helvetica").fontSize(9.5).fillColor(color)
        .text(label, TOT_X, y, { width: LBL_W, align: "right" })
        .text(amount, AMT_X, y, { width: AMT_W, align: "right" }).restore();
      y += 15;
    };
    row("Total Charged:", fmt(data.total_charged));
    row("Total Paid:", fmt(data.total_paid));
    y += 4;
    doc.save().rect(TOT_X - 8, y, LBL_W + AMT_W + 8, 26).fill(PRIMARY_RED).restore();
    doc.save().font("Helvetica-Bold").fontSize(12).fillColor("#FFFFFF")
      .text("BALANCE DUE:", TOT_X - 4, y + 7, { width: LBL_W, align: "right" })
      .text(fmt(data.balance_due), AMT_X, y + 7, { width: AMT_W, align: "right" }).restore();
    y += 40;

    doc.save().font("Helvetica-Oblique").fontSize(7.5).fillColor("#666666")
      .text(`This statement was generated from ${COMPANY_NAME} property management records on ${data.generated_date}.`, M, PG_H - M - 16, { width: USABLE, align: "center" }).restore();

    doc.end();
    stream.on("finish", () => resolve(filePath));
    stream.on("error", reject);
  });
}

export interface PastDueNoticeData {
  recipient_name: string;
  property_address: string;
  notice_date: string;
  pay_by_date: string;
  period_covered?: string;
  account_ref?: string;
  amount_past_due: number;
  late_fees?: number;
  other_charges?: number;
}

/** ISO (YYYY-MM-DD) → "July 1, 2026"; anything else is printed as-is. */
function fmtNoticeDate(v: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec((v || "").trim());
  if (!m) return v;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  if (isNaN(d.getTime())) return v;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

/**
 * Branded one-page "Past Due Notice" — a formal demand for payment generated
 * from a property's ledger balance. Mirrors generateAccountBalance's structure.
 */
export async function generatePastDueNotice(data: PastDueNoticeData): Promise<string> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 0, autoFirstPage: true });
    const filePath = tempFilePath(
      `PASTDUE_${(data.property_address || "notice").replace(/[^a-zA-Z0-9]/g, "_").slice(0, 30)}.pdf`,
    );
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    const pastDue = Number(data.amount_past_due) || 0;
    const lateFees = Number(data.late_fees) || 0;
    const otherCharges = Number(data.other_charges) || 0;
    const totalDue = pastDue + lateFees + otherCharges;
    const noticeDate = fmtNoticeDate(data.notice_date);
    const payByDate = data.pay_by_date ? fmtNoticeDate(data.pay_by_date) : "";

    let y = M;

    // 1. Header — logo top-left, company block top-right.
    const lp = logoPath();
    if (fs.existsSync(lp)) doc.image(lp, M, y, { width: 120, height: 46 });
    doc.save().font("Helvetica-Bold").fontSize(9.5).fillColor("#555555")
      .text(COMPANY_NAME, M, y, { width: USABLE, align: "right" }).restore();
    doc.save().font("Helvetica").fontSize(8.5).fillColor("#555555")
      .text(COMPANY_ADDRESS, M, y + 14, { width: USABLE, align: "right" })
      .text(COMPANY_PHONE, M, y + 26, { width: USABLE, align: "right" }).restore();
    y += 58;

    // 2. Full-width red banner.
    const BANNER_H = 34;
    doc.save().rect(M, y, USABLE, BANNER_H).fill(PRIMARY_RED).restore();
    doc.save().font("Helvetica-Bold").fontSize(20).fillColor("#FFFFFF")
      .text("PAST DUE NOTICE", M, y + 6, { width: USABLE, align: "center" }).restore();
    y += BANNER_H + 16;

    // 3. Date (left) / Account-Ref (right).
    doc.save().font("Helvetica").fontSize(9.5).fillColor("#555555")
      .text(`Date:  ${noticeDate}`, M, y, { width: USABLE / 2 }).restore();
    if (data.account_ref && data.account_ref.trim()) {
      doc.save().font("Helvetica").fontSize(9.5).fillColor("#555555")
        .text(`Account / Ref:  ${data.account_ref.trim()}`, M, y, { width: USABLE, align: "right" }).restore();
    }
    y += 22;

    // 4. TO: / RE: block.
    doc.save().font("Helvetica").fontSize(11).fillColor(DARK_TEXT);
    doc.font("Helvetica-Bold").text("TO: ", M, y, { continued: true })
      .font("Helvetica").text(data.recipient_name || "");
    y += doc.heightOfString(`TO: ${data.recipient_name || ""}`, { width: USABLE }) + 2;
    doc.font("Helvetica-Bold").text("RE: ", M, y, { continued: true })
      .font("Helvetica").text(`Property located at ${data.property_address || ""}`);
    y += doc.heightOfString(`RE: Property located at ${data.property_address || ""}`, { width: USABLE });
    doc.restore();
    y += 14;

    // 5. Opening paragraph.
    const periodClause = data.period_covered && data.period_covered.trim()
      ? ` for ${data.period_covered.trim()}` : "";
    const opening =
      `Our records show that your account with ${COMPANY_NAME} is PAST DUE. The balance below${periodClause} ` +
      `remains unpaid and is now delinquent. This letter is a formal demand for immediate payment in full.`;
    doc.save().font("Helvetica").fontSize(10.5).fillColor(DARK_TEXT)
      .text(opening, M, y, { width: USABLE, align: "justify" }).restore();
    y += doc.heightOfString(opening, { width: USABLE }) + 16;

    // 6. Amounts table.
    const ROW_H = 22;
    const AMT_W = 150;
    const DESC_W = USABLE - AMT_W;
    const AMT_X = M + DESC_W;
    const tableTop = y;

    // Header row.
    doc.save().rect(M, y, USABLE, ROW_H).fill(PRIMARY_RED).restore();
    doc.save().font("Helvetica-Bold").fontSize(9).fillColor("#FFFFFF")
      .text("DESCRIPTION", M + 8, y + 6, { width: DESC_W - 12 })
      .text("AMOUNT", AMT_X, y + 6, { width: AMT_W - 8, align: "right" }).restore();
    y += ROW_H;

    // Body rows — always include Past due balance; others only if > 0.
    const bodyRows: Array<[string, number]> = [["Past due balance", pastDue]];
    if (lateFees > 0) bodyRows.push(["Late fees", lateFees]);
    if (otherCharges > 0) bodyRows.push(["Other charges", otherCharges]);
    bodyRows.forEach(([label, amount], i) => {
      if (i % 2 === 1) doc.save().rect(M, y, USABLE, ROW_H).fill(LIGHT_RED).restore();
      doc.save().font("Helvetica").fontSize(10).fillColor(DARK_TEXT)
        .text(label, M + 8, y + 6, { width: DESC_W - 12 })
        .text(fmt(amount), AMT_X, y + 6, { width: AMT_W - 8, align: "right" }).restore();
      y += ROW_H;
    });

    // Total row.
    doc.save().rect(M, y, USABLE, ROW_H).fill(PRIMARY_RED).restore();
    doc.save().font("Helvetica-Bold").fontSize(10).fillColor("#FFFFFF")
      .text("TOTAL AMOUNT DUE", M + 8, y + 6, { width: DESC_W - 12 })
      .text(fmt(totalDue), AMT_X, y + 6, { width: AMT_W - 8, align: "right" }).restore();
    y += ROW_H;

    // Thin red border around the whole table.
    doc.save().rect(M, tableTop, USABLE, y - tableTop).strokeColor(PRIMARY_RED).lineWidth(0.75).stroke().restore();
    y += 18;

    // 7. Bold red pay-by line.
    if (payByDate) {
      const payLine = `PAYMENT IN FULL MUST BE RECEIVED BY ${payByDate.toUpperCase()}.`;
      doc.save().font("Helvetica-Bold").fontSize(12).fillColor(PRIMARY_RED)
        .text(payLine, M, y, { width: USABLE }).restore();
      y += doc.heightOfString(payLine, { width: USABLE }) + 14;
    }

    // 8. Consequences paragraph.
    const consequences =
      `If full payment is not received by the date above, ${COMPANY_NAME} may pursue every remedy available ` +
      `under your agreement and Ohio law. This may include termination of your right to occupy the property, ` +
      `proceedings to recover possession of the property, additional late fees and costs, and other collection ` +
      `action. Avoid these consequences by paying the full amount due now.`;
    doc.save().font("Helvetica").fontSize(10.5).fillColor(DARK_TEXT)
      .text(consequences, M, y, { width: USABLE, align: "justify" }).restore();
    y += doc.heightOfString(consequences, { width: USABLE }) + 14;

    // 9. Payment instructions.
    const instructions =
      `Make payment to ${COMPANY_NAME}. If you have already paid in full, or believe this notice is in error, ` +
      `contact our office immediately at ${COMPANY_PHONE}.`;
    doc.save().font("Helvetica").fontSize(10).fillColor("#555555")
      .text(instructions, M, y, { width: USABLE, align: "justify" }).restore();
    y += doc.heightOfString(instructions, { width: USABLE }) + 24;

    // 10. Signature block.
    doc.save().font("Helvetica").fontSize(10.5).fillColor(DARK_TEXT).text("Sincerely,", M, y).restore();
    y += 40;
    doc.save().moveTo(M, y).lineTo(M + 2.6 * 72, y).strokeColor(DARK_TEXT).lineWidth(0.75).stroke().restore();
    y += 6;
    doc.save().font("Helvetica-Bold").fontSize(10.5).fillColor(DARK_TEXT).text("Authorized Representative", M, y).restore();
    y += 15;
    doc.save().font("Helvetica").fontSize(10).fillColor("#555555").text(COMPANY_NAME, M, y).restore();

    // 11. Footer at bottom.
    const fy = PG_H - M - 22;
    drawLine(doc, M, fy, M + USABLE, PRIMARY_RED, 0.75);
    doc.save().font("Helvetica").fontSize(8).fillColor("#555555")
      .text(`${COMPANY_NAME}   ·   ${COMPANY_ADDRESS}   ·   ${COMPANY_PHONE}`, M, fy + 6, { width: USABLE, align: "center" })
      .restore();

    doc.end();
    stream.on("finish", () => resolve(filePath));
    stream.on("error", reject);
  });
}

export async function generateInvoice(data: InvoiceData): Promise<string> {
  const depositPaid = data.deposit_paid ?? 0;

  // Calculate due date (14 days from issued)
  const [m, d, yr] = data.issued_date.split("/").map(Number);
  const issued = new Date(yr, m - 1, d);
  const due = new Date(issued);
  due.setDate(due.getDate() + 14);
  const dueStr = `${String(due.getMonth() + 1).padStart(2, "0")}/${String(due.getDate()).padStart(2, "0")}/${due.getFullYear()}`;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "LETTER", margin: 0, autoFirstPage: true });
    const filename = `${data.doc_number}_${data.client_name.replace(/[^a-zA-Z0-9]/g, "_")}.pdf`;
    const filePath = tempFilePath(filename);
    const stream = fs.createWriteStream(filePath);
    doc.pipe(stream);

    let y = drawHeader(doc, "INVOICE", data, dueStr);
    y = drawTableHeader(doc, y);
    const { y: afterRows, subtotal } = drawTableRows(doc, data.line_items, y);
    y = drawTotals(doc, afterRows, subtotal, true, depositPaid);

    y += 10;
    drawLine(doc, M, y, M + USABLE, GRID_COLOR, 0.4);
    y += 10;

    // Payment instructions
    doc.save()
      .font("Helvetica").fontSize(9).fillColor(DARK_TEXT)
      .text(
        "Payment due upon receipt. Accepted: cash, check payable to Nice City Homes LLC, or Zelle. " +
        "Late payments subject to 1.5% monthly fee.",
        M, y, { width: USABLE }
      )
      .restore();

    drawFooter(doc);

    doc.end();
    stream.on("finish", () => resolve(filePath));
    stream.on("error", reject);
  });
}
