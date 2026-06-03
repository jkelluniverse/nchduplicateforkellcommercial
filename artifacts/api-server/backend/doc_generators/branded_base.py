"""
branded_base.py — Shared ReportLab utilities for all NCH branded documents.
"""

import os
import tempfile
import time
from datetime import datetime

from reportlab.lib.pagesizes import LETTER
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor
from reportlab.pdfgen import canvas
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, HRFlowable, Table, TableStyle, KeepTogether
)
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT

PRIMARY_RED = HexColor("#8B0000")
DARK_TEXT = HexColor("#1A1A1A")
LABEL_COLOR = HexColor("#555555")
FOOTER_COLOR = HexColor("#666666")
FOOTER_LINE_COLOR = PRIMARY_RED

FOOTER_TEXT = "Nice City Homes LLC  \u00b7  330-495-8192  \u00b7  Canton, Ohio"
LOGO_FILENAME = "NCH_LOGO.png"

ASSETS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "assets")
LOGO_PATH = os.path.join(ASSETS_DIR, LOGO_FILENAME)

PAGE_WIDTH, PAGE_HEIGHT = LETTER
MARGIN = inch
BODY_WIDTH = PAGE_WIDTH - MARGIN * 2

HIGHLIGHT_FIELDS = {"tenant_name", "buyer_name", "occupant_name", "received_from", "property_address"}


def fmt_currency(val):
    try:
        n = float(str(val)) if val not in (None, "") else 0.0
    except (ValueError, TypeError):
        n = 0.0
    return f"${n:,.2f}"


def fmt_date(val):
    if not val:
        return ""
    for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%Y/%m/%d"):
        try:
            d = datetime.strptime(str(val), fmt)
            return d.strftime("%B %-d, %Y")
        except ValueError:
            pass
    return str(val)


def render_value(field_type, val):
    if val is None or val == "":
        return ""
    if field_type == "currency":
        return fmt_currency(val)
    if field_type == "date":
        return fmt_date(str(val))
    if field_type == "percent":
        return f"{val}%"
    return str(val)


class FooterCanvas(canvas.Canvas):
    """Canvas that draws a branded footer on every page."""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self._saved_page_states = []

    def showPage(self):
        self._saved_page_states.append(dict(self.__dict__))
        self._startPage()

    def save(self):
        num_pages = len(self._saved_page_states)
        for state in self._saved_page_states:
            self.__dict__.update(state)
            self._draw_footer()
            canvas.Canvas.showPage(self)
        canvas.Canvas.save(self)

    def _draw_footer(self):
        self.saveState()
        y = 0.45 * inch
        self.setStrokeColor(FOOTER_LINE_COLOR)
        self.setLineWidth(0.5)
        self.line(MARGIN, y + 10, PAGE_WIDTH - MARGIN, y + 10)
        self.setFont("Helvetica", 8)
        self.setFillColor(FOOTER_COLOR)
        self.drawCentredString(PAGE_WIDTH / 2, y, FOOTER_TEXT)
        self.restoreState()


def get_styles():
    styles = getSampleStyleSheet()

    styles.add(ParagraphStyle(
        name="NCH_Label",
        fontName="Helvetica",
        fontSize=8.5,
        textColor=LABEL_COLOR,
        spaceAfter=2,
    ))
    styles.add(ParagraphStyle(
        name="NCH_Body",
        fontName="Helvetica",
        fontSize=11,
        textColor=DARK_TEXT,
        spaceAfter=8,
        leading=14,
    ))
    styles.add(ParagraphStyle(
        name="NCH_BodyBold",
        fontName="Helvetica-Bold",
        fontSize=12,
        textColor=DARK_TEXT,
        spaceAfter=8,
        leading=16,
    ))
    styles.add(ParagraphStyle(
        name="NCH_Title",
        fontName="Helvetica-Bold",
        fontSize=15,
        textColor=PRIMARY_RED,
        spaceAfter=4,
        leading=18,
    ))
    styles.add(ParagraphStyle(
        name="NCH_SectionHeader",
        fontName="Helvetica-Bold",
        fontSize=9.5,
        textColor=DARK_TEXT,
        spaceAfter=4,
    ))
    styles.add(ParagraphStyle(
        name="NCH_BulletItem",
        fontName="Helvetica",
        fontSize=11,
        textColor=DARK_TEXT,
        spaceAfter=3,
        leftIndent=12,
        leading=14,
    ))
    styles.add(ParagraphStyle(
        name="NCH_SignLabel",
        fontName="Helvetica",
        fontSize=8.5,
        textColor=LABEL_COLOR,
        spaceAfter=2,
    ))
    return styles


def build_header_flowables(title, styles):
    """Returns a list of flowables for the document header."""
    flowables = []

    logo_exists = os.path.exists(LOGO_PATH)
    generated_date = datetime.now().strftime("%m/%d/%Y")

    if logo_exists:
        from reportlab.platypus import Image
        logo = Image(LOGO_PATH, width=120, height=45)
    else:
        logo = Paragraph("<b>NCH</b>", styles["NCH_Title"])

    title_para = Paragraph(title, styles["NCH_Title"])
    date_para = Paragraph(
        f'<font size="8" color="#666666">Generated: {generated_date}</font>',
        ParagraphStyle("right_date", parent=styles["Normal"], alignment=TA_RIGHT)
    )

    header_data = [[logo, [title_para, date_para]]]
    header_table = Table(header_data, colWidths=[130, BODY_WIDTH - 130])
    header_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("TOPPADDING", (0, 0), (-1, -1), 0),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
    ]))
    flowables.append(header_table)
    flowables.append(Spacer(1, 6))
    flowables.append(HRFlowable(width=BODY_WIDTH, thickness=1, color=PRIMARY_RED))
    flowables.append(Spacer(1, 10))
    return flowables


def build_field_flowables(schema_fields, data, styles):
    """Build flowables for all fields in the schema."""
    flowables = []

    for field in schema_fields:
        field_id = field.get("id", "")
        field_type = field.get("type", "text")
        field_label = field.get("label", "")

        if field_type == "repeating_group":
            rows = data.get(field_id, []) or []
            if not rows:
                continue
            group_items = [Paragraph(field_label + ":", styles["NCH_SectionHeader"])]
            for row in rows:
                subfields = field.get("subfields", [])
                parts = []
                for sf in subfields:
                    v = row.get(sf["id"], "")
                    if v:
                        parts.append(f"{sf['label']}: {render_value(sf.get('type', 'text'), v)}")
                if parts:
                    text = "\u2022  " + "   ".join(parts)
                    group_items.append(Paragraph(text, styles["NCH_BulletItem"]))
            group_items.append(Spacer(1, 6))
            flowables.append(KeepTogether(group_items))
            continue

        if field_type in ("static", "calculated"):
            val = data.get(field_id, field.get("default", ""))
            display = render_value(field_type, val)
            flowables.append(Paragraph(field_label, styles["NCH_Label"]))
            flowables.append(Paragraph(display or "(not set)", styles["NCH_Body"]))
            continue

        val = data.get(field_id)
        if val is None or val == "":
            continue
        display = render_value(field_type, val)
        if not display:
            continue

        flowables.append(Paragraph(field_label, styles["NCH_Label"]))

        if field_id in HIGHLIGHT_FIELDS:
            flowables.append(Paragraph(display, styles["NCH_BodyBold"]))
        else:
            flowables.append(Paragraph(display, styles["NCH_Body"]))

    return flowables


def build_signature_flowables(schema_fields, data, styles):
    """Build signature block flowables if any signatory fields exist."""
    sig_ids = [
        f for f in schema_fields
        if "signator" in f.get("id", "") or f.get("id") in ("nch_signatory", "client_signatory")
    ]
    if not sig_ids:
        return []

    flowables = [
        Spacer(1, 16),
        HRFlowable(width=BODY_WIDTH, thickness=0.5, color=HexColor("#cccccc")),
        Spacer(1, 10),
        Paragraph("SIGNATURES", styles["NCH_SectionHeader"]),
        Spacer(1, 10),
    ]

    col_w = (BODY_WIDTH - 20) / 2
    pairs = []
    for i in range(0, len(sig_ids), 2):
        row_sigs = sig_ids[i:i+2]
        row_cells = []
        for sf in row_sigs:
            sig_name = data.get(sf["id"], "")
            cell_content = [
                HRFlowable(width=col_w, thickness=0.5, color=DARK_TEXT),
                Spacer(1, 3),
                Paragraph(f"{sf['label']}: {sig_name}", styles["NCH_SignLabel"]),
            ]
            row_cells.append(cell_content)
        if len(row_cells) == 1:
            row_cells.append([Spacer(1, 1)])
        pairs.append(row_cells)

    for pair in pairs:
        sig_table = Table([pair], colWidths=[col_w, col_w])
        sig_table.setStyle(TableStyle([
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("LEFTPADDING", (0, 0), (-1, -1), 0),
            ("RIGHTPADDING", (0, 0), (-1, -1), 20),
            ("TOPPADDING", (0, 0), (-1, -1), 0),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 0),
        ]))
        flowables.append(sig_table)
        flowables.append(Spacer(1, 20))

    flowables.extend([
        HRFlowable(width=200, thickness=0.5, color=DARK_TEXT),
        Spacer(1, 3),
        Paragraph("Date", styles["NCH_SignLabel"]),
    ])
    return flowables


def generate_branded_pdf(title, schema_fields, data):
    """
    Generate a branded PDF and return the temp file path.
    schema_fields: list of field dicts from doc-schemas
    data: dict of field values
    """
    tmp = tempfile.NamedTemporaryFile(
        prefix="nch_doc_", suffix=".pdf", delete=False, dir=tempfile.gettempdir()
    )
    tmp.close()
    tmp_path = tmp.name

    styles = get_styles()
    doc = SimpleDocTemplate(
        tmp_path,
        pagesize=LETTER,
        leftMargin=MARGIN,
        rightMargin=MARGIN,
        topMargin=MARGIN,
        bottomMargin=MARGIN + 0.3 * inch,
    )

    story = []
    story.extend(build_header_flowables(title, styles))
    story.extend(build_field_flowables(schema_fields, data, styles))
    story.extend(build_signature_flowables(schema_fields, data, styles))

    doc.build(story, canvasmaker=FooterCanvas)
    return tmp_path
