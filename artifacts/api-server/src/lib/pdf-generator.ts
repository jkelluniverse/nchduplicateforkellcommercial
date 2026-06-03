import PDFDocument from "pdfkit";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";

const PRIMARY_RED = "#8B0000";
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
