"""
Available Properties List Generator — NCH Branded
===================================================
Reproduces the NCH Available Properties flyer exactly.
List is dynamic — managed in the app database and regenerated on demand.

DATA STRUCTURE (from database):
  properties = [
    {
      "number": "01",
      "address": "1200 Maryland Ave SW",
      "city_state_zip": "Canton, OH 44710",
      "beds": 2,
      "baths": 1,
      "notes": ""   # optional — e.g. "Recently renovated" 
    },
    ...
  ]

HARDCODED (never changes):
  Down payment: $2,500
  Payment range: $1,000–$1,300/month
  Contact: Call Mike at 330-495-8192
  Tagline: Must have Down Payment and First Month's rent to sign.
  All homes sold on Land Contract
"""

import os
from datetime import date
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, HRFlowable,
    Table, TableStyle, Image as RLImage
)
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT


NCH_RED  = HexColor("#8B0000")
DARK     = HexColor("#1A1A1A")
MUTED    = HexColor("#666666")
WHITE    = colors.white
LGRAY    = HexColor("#F5F5F5")
TBL_HEAD = HexColor("#8B0000")


def generate_available_properties(properties, output_path=None):
    """
    Generate the Available Properties List PDF.

    properties: list of dicts with keys:
      number (str), address (str), city_state_zip (str),
      beds (int), baths (int), notes (str, optional)

    output_path: where to save the PDF
    """
    if output_path is None:
        today = date.today().strftime('%B_%Y')
        output_path = f'/tmp/NCH_Available_Properties_{today}.pdf'

    doc = SimpleDocTemplate(
        output_path, pagesize=letter,
        leftMargin=0.65 * inch, rightMargin=0.65 * inch,
        topMargin=0.55 * inch, bottomMargin=0.65 * inch
    )

    W = letter[0] - 1.3 * inch  # usable width

    def mk(name):
        return {
            'avail':   ParagraphStyle('avail', fontName='Helvetica-Bold',
                                      fontSize=22, textColor=NCH_RED,
                                      alignment=TA_RIGHT, leading=26,
                                      spaceAfter=0, spaceBefore=0),
            'sold_on': ParagraphStyle('sold_on', fontName='Helvetica-Bold',
                                      fontSize=18, textColor=NCH_RED,
                                      alignment=TA_RIGHT, leading=22,
                                      spaceAfter=0, spaceBefore=0),
            'lc':      ParagraphStyle('lc', fontName='Helvetica-Bold',
                                      fontSize=22, textColor=NCH_RED,
                                      alignment=TA_RIGHT, leading=26,
                                      spaceAfter=0, spaceBefore=0),
            'call':    ParagraphStyle('call', fontName='Helvetica-Bold',
                                      fontSize=13, textColor=NCH_RED,
                                      alignment=TA_RIGHT, leading=17,
                                      spaceAfter=0, spaceBefore=0),
            'terms':   ParagraphStyle('terms', fontName='Helvetica-Bold',
                                      fontSize=10, textColor=DARK,
                                      alignment=TA_LEFT, leading=14,
                                      spaceAfter=0, spaceBefore=0),
            'addr':    ParagraphStyle('addr', fontName='Helvetica-Bold',
                                      fontSize=11, textColor=DARK,
                                      leading=14, spaceAfter=0, spaceBefore=0),
            'city':    ParagraphStyle('city', fontName='Helvetica',
                                      fontSize=10, textColor=MUTED,
                                      leading=13, spaceAfter=0, spaceBefore=0),
            'num':     ParagraphStyle('num', fontName='Helvetica-Bold',
                                      fontSize=11, textColor=NCH_RED,
                                      alignment=TA_CENTER, leading=14,
                                      spaceAfter=0, spaceBefore=0),
            'cell':    ParagraphStyle('cell', fontName='Helvetica-Bold',
                                      fontSize=11, textColor=DARK,
                                      alignment=TA_CENTER, leading=14,
                                      spaceAfter=0, spaceBefore=0),
            'hdr':     ParagraphStyle('hdr', fontName='Helvetica-Bold',
                                      fontSize=11, textColor=WHITE,
                                      alignment=TA_LEFT, leading=14,
                                      spaceAfter=0, spaceBefore=0),
            'hdrc':    ParagraphStyle('hdrc', fontName='Helvetica-Bold',
                                      fontSize=11, textColor=WHITE,
                                      alignment=TA_CENTER, leading=14,
                                      spaceAfter=0, spaceBefore=0),
            'note':    ParagraphStyle('note', fontName='Helvetica-Oblique',
                                      fontSize=9, textColor=MUTED,
                                      leading=12, spaceAfter=0, spaceBefore=0),
            'footer':  ParagraphStyle('footer', fontName='Helvetica',
                                      fontSize=8, textColor=MUTED,
                                      alignment=TA_CENTER, leading=11,
                                      spaceAfter=0, spaceBefore=0),
        }[name]

    def hr(color=NCH_RED, t=1.5, sp=6):
        return HRFlowable(width='100%', thickness=t, color=color,
                          spaceAfter=sp, spaceBefore=sp)

    def sp(n): return Spacer(1, n)

    story = []

    # ── HEADER ────────────────────────────────────────────────────────────────
    logo_path = os.path.abspath(os.path.join(
        os.path.dirname(os.path.abspath(__file__)),
        '..', 'assets', 'NCH_LOGO.png'))

    logo_h = 1.15 * inch
    logo_w = logo_h * (713 / 338)

    right_block = [
        Paragraph('AVAILABLE PROPERTIES LIST', mk('avail')),
        hr(t=1.5, sp=4),
        Paragraph('ALL HOMES  SOLD ON', mk('sold_on')),
        sp(2),
        Paragraph('LAND CONTRACT', mk('lc')),
        sp(4),
        Paragraph('Call Mike at 330-495-8192', mk('call')),
    ]

    if os.path.exists(logo_path):
        logo_cell = RLImage(logo_path, width=logo_w, height=logo_h)
    else:
        logo_cell = Paragraph('', mk('city'))

    hdr_tbl = Table(
        [[logo_cell, right_block]],
        colWidths=[logo_w + 0.2 * inch, W - logo_w - 0.2 * inch]
    )
    hdr_tbl.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))
    story += [hdr_tbl, sp(10), hr(t=1.5, sp=8)]

    # ── TERMS ROW ─────────────────────────────────────────────────────────────
    terms_text = (
        'All homes are  \u2022  <b>$2,500 down payment</b>  \u2022  '
        '<b>Payments from $1,000\u2013$1,300/month</b>  \u2022<br/>'
        '\u2003\u2003Must have Down Payment and First Month\'s rent to sign.'
    )
    story += [Paragraph(terms_text, mk('terms')), sp(10)]

    # ── PROPERTY TABLE ────────────────────────────────────────────────────────
    # Column widths matching original: # | Address | Beds | Baths | (notes)
    COL_NUM   = 0.45 * inch
    COL_BEDS  = 0.65 * inch
    COL_BATHS = 0.65 * inch
    COL_NOTES = 1.2 * inch
    COL_ADDR  = W - COL_NUM - COL_BEDS - COL_BATHS - COL_NOTES

    # Header row
    rows = [[
        Paragraph('#', mk('hdrc')),
        Paragraph('Address', mk('hdr')),
        Paragraph('Beds', mk('hdrc')),
        Paragraph('Baths', mk('hdrc')),
        Paragraph('', mk('hdrc')),  # notes column header blank
    ]]

    # Property rows
    for i, prop in enumerate(properties):
        num        = prop.get('number', f'{i+1:02d}')
        address    = prop.get('address', '')
        city       = prop.get('city_state_zip', '')
        beds       = str(prop.get('beds', ''))
        baths      = str(prop.get('baths', ''))
        notes      = prop.get('notes', '')

        addr_cell = [
            Paragraph(address, mk('addr')),
            Paragraph(city, mk('city')),
        ]

        rows.append([
            Paragraph(num, mk('num')),
            addr_cell,
            Paragraph(beds, mk('cell')),
            Paragraph(baths, mk('cell')),
            Paragraph(notes, mk('note')),
        ])

    tbl = Table(
        rows,
        colWidths=[COL_NUM, COL_ADDR, COL_BEDS, COL_BATHS, COL_NOTES],
        repeatRows=1
    )

    # Alternating row shading
    n = len(rows)
    style_cmds = [
        # Header
        ('BACKGROUND',    (0, 0), (-1, 0), TBL_HEAD),
        ('TEXTCOLOR',     (0, 0), (-1, 0), WHITE),
        ('FONTNAME',      (0, 0), (-1, 0), 'Helvetica-Bold'),
        ('FONTSIZE',      (0, 0), (-1, 0), 11),
        # All cells
        ('VALIGN',        (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING',   (0, 0), (-1, -1), 8),
        ('RIGHTPADDING',  (0, 0), (-1, -1), 8),
        ('TOPPADDING',    (0, 0), (-1, -1), 8),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 8),
        # Grid
        ('LINEBELOW',     (0, 0), (-1, -1), 0.3, HexColor('#DDDDDD')),
        ('LINEAFTER',     (0, 0), (-1, -1), 0.3, HexColor('#DDDDDD')),
        ('BOX',           (0, 0), (-1, -1), 0.5, HexColor('#CCCCCC')),
        # Center # Beds Baths columns
        ('ALIGN',         (0, 0), (0, -1), 'CENTER'),
        ('ALIGN',         (2, 0), (3, -1), 'CENTER'),
    ]

    # Alternating shading on data rows
    for row_idx in range(1, n):
        if row_idx % 2 == 0:
            style_cmds.append(('BACKGROUND', (0, row_idx), (-1, row_idx), LGRAY))
        else:
            style_cmds.append(('BACKGROUND', (0, row_idx), (-1, row_idx), WHITE))

    tbl.setStyle(TableStyle(style_cmds))
    story.append(tbl)

    # ── FOOTER ────────────────────────────────────────────────────────────────
    today_str = date.today().strftime('%B %Y')
    story += [
        sp(10),
        hr(t=0.5, sp=4),
        Paragraph(
            f'Nice City Homes LLC  \u00b7  330-495-8192  \u00b7  '
            f'Canton, Ohio  \u00b7  Home Ownership Specialists  \u00b7  '
            f'Updated {today_str}',
            mk('footer')
        ),
    ]

    doc.build(story)
    return output_path


# ── Test ──────────────────────────────────────────────────────────────────────
if __name__ == '__main__':
    test_properties = [
        {"number": "01", "address": "1200 Maryland Ave SW",  "city_state_zip": "Canton, OH 44710", "beds": 2, "baths": 1},
        {"number": "02", "address": "534 Columbus Ave SW",   "city_state_zip": "Canton, OH 44702", "beds": 3, "baths": 1},
        {"number": "03", "address": "2508 17th St SW",       "city_state_zip": "Canton, OH 44706", "beds": 2, "baths": 1},
        {"number": "04", "address": "1259 Harrison Ave SW",  "city_state_zip": "Canton, OH 44706", "beds": 3, "baths": 1},
        {"number": "05", "address": "2015 Bryan Ave SW",     "city_state_zip": "Canton, OH 44706", "beds": 3, "baths": 1},
        {"number": "06", "address": "2015 11th St SW",       "city_state_zip": "Canton, OH 44706", "beds": 3, "baths": 1},
        {"number": "07", "address": "1215 14th St NW",       "city_state_zip": "Canton, OH 44703", "beds": 3, "baths": 1},
        {"number": "08", "address": "521 Elgin Ave NW",      "city_state_zip": "Canton, OH 44703", "beds": 3, "baths": 1},
        {"number": "09", "address": "1663 Alden Ave SW",     "city_state_zip": "Canton, OH 44706", "beds": 2, "baths": 1},
        {"number": "10", "address": "1825 Roosevelt Ave NE", "city_state_zip": "Canton, OH 44705", "beds": 3, "baths": 1},
        {"number": "11", "address": "908 Gilmor Ave NW",     "city_state_zip": "Canton, OH 44703", "beds": 3, "baths": 2},
        {"number": "12", "address": "1037 Cherry Ave NE",    "city_state_zip": "Canton, OH 44704", "beds": 3, "baths": 1},
    ]
    out = generate_available_properties(
        test_properties,
        '/home/claude/AvailableProperties_Test.pdf'
    )
    print(f'Generated: {out}')
