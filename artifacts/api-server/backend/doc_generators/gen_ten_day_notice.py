"""
10-Day Notice — Forfeiture of Land Contract
============================================
Ohio ORC 5313.06 compliant. NCH branded. One page.

FORM FIELDS:
  tenant_name       str    purchaser full name(s)
  property_address  str    full property address
  notice_date       str    defaults to today
  default_amount    float  total amount in default
  default_items     list   [{"item_description": str, "item_amount": float}]
  cure_deadline     str    defaults to today+10
  forfeiture_date   str    defaults to today+10
  seller_name       str    defaults to Nice City Homes LLC
  seller_signatory  str    person signing
"""

import os
from datetime import date, timedelta
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.colors import HexColor
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, HRFlowable, Table, TableStyle
)
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT, TA_CENTER
from reportlab.platypus import Image as RLImage

NCH_RED = HexColor("#8B0000")
DARK    = HexColor("#1A1A1A")
MUTED   = HexColor("#555555")
LGRAY   = HexColor("#F5F5F5")


def _footer(canvas, doc):
    canvas.saveState()
    canvas.setFont('Helvetica', 9)
    canvas.setFillColor(MUTED)
    canvas.drawCentredString(letter[0] / 2, 0.45 * inch,
        'Nice City Homes LLC  \u00b7  330-495-8192  \u00b7  Canton, Ohio')
    canvas.setStrokeColor(NCH_RED)
    canvas.setLineWidth(0.5)
    canvas.line(inch, 0.6 * inch, letter[0] - inch, 0.6 * inch)
    canvas.restoreState()


def generate(data, output_path=None):
    tenant       = data['tenant_name']
    prop_addr    = data['property_address']
    notice_date  = data.get('notice_date', date.today().strftime('%B %d, %Y'))
    default_amt  = float(data.get('default_amount', 0) or 0)
    items        = data.get('default_items', [])
    cure_dl      = data.get('cure_deadline',
                            (date.today() + timedelta(days=10)).strftime('%B %d, %Y'))
    forfeit_date = data.get('forfeiture_date',
                            (date.today() + timedelta(days=10)).strftime('%B %d, %Y'))
    seller       = data.get('seller_name', 'Nice City Homes LLC')
    phone        = data.get('seller_phone', '330-495-8192')
    signatory    = data.get('seller_signatory', '')

    if output_path is None:
        safe = tenant.replace(' ', '_').replace('/', '_')
        output_path = f'/tmp/10DayNotice_{safe}.pdf'

    doc = SimpleDocTemplate(output_path, pagesize=letter,
        leftMargin=inch, rightMargin=inch,
        topMargin=0.75 * inch, bottomMargin=0.85 * inch)

    W = letter[0] - 2 * inch

    def mk(name):
        return {
            'title': ParagraphStyle('title', fontName='Helvetica-Bold', fontSize=18,
                                    textColor=NCH_RED, alignment=TA_CENTER, leading=22,
                                    spaceAfter=2, spaceBefore=0),
            'sub':   ParagraphStyle('sub', fontName='Helvetica-Bold', fontSize=11,
                                    textColor=NCH_RED, alignment=TA_CENTER, leading=15,
                                    spaceAfter=0, spaceBefore=0),
            'body':  ParagraphStyle('body', fontName='Helvetica', fontSize=11,
                                    textColor=DARK, leading=15, spaceAfter=0, spaceBefore=0),
            'bold':  ParagraphStyle('bold', fontName='Helvetica-Bold', fontSize=11,
                                    textColor=DARK, leading=15, spaceAfter=0, spaceBefore=0),
            'label': ParagraphStyle('label', fontName='Helvetica-Bold', fontSize=9,
                                    textColor=MUTED, leading=12, spaceAfter=0, spaceBefore=0),
            'warn':  ParagraphStyle('warn', fontName='Helvetica-Bold', fontSize=11,
                                    textColor=NCH_RED, leading=15, spaceAfter=0, spaceBefore=0),
            'sig':   ParagraphStyle('sig', fontName='Helvetica', fontSize=10,
                                    textColor=DARK, leading=13, spaceAfter=0, spaceBefore=0),
            'disc':  ParagraphStyle('disc', fontName='Helvetica-Bold', fontSize=10,
                                    textColor=DARK, leading=14, spaceAfter=0, spaceBefore=0,
                                    alignment=TA_CENTER),
            'note':  ParagraphStyle('note', fontName='Helvetica-Oblique', fontSize=8.5,
                                    textColor=MUTED, leading=11, spaceAfter=0, spaceBefore=0,
                                    alignment=TA_CENTER),
            'orc':   ParagraphStyle('orc', fontName='Helvetica-Oblique', fontSize=9,
                                    textColor=MUTED, leading=12, spaceAfter=0, spaceBefore=0),
        }[name]

    def hr(color=NCH_RED, t=1, sp=6):
        return HRFlowable(width='100%', thickness=t, color=color,
                          spaceAfter=sp, spaceBefore=sp)
    def sp(n): return Spacer(1, n)

    story = []

    # Header
    logo_path = os.path.abspath(os.path.join(
        os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'NCH_LOGO.png'))
    logo_h = 0.7 * inch
    logo_w = logo_h * (713 / 338)

    title_block = [
        Paragraph('NOTICE OF FORFEITURE', mk('title')),
        Paragraph('10-DAY NOTICE — LAND INSTALLMENT CONTRACT', mk('sub')),
        Paragraph('Pursuant to Ohio Revised Code \u00a7 5313.06', mk('orc')),
    ]
    if os.path.exists(logo_path):
        hdr = Table([[RLImage(logo_path, width=logo_w, height=logo_h), title_block]],
                    colWidths=[logo_w + 0.15 * inch, W - logo_w - 0.15 * inch])
    else:
        hdr = Table([['', title_block]], colWidths=[0.1 * inch, W - 0.1 * inch])
    hdr.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))
    story += [hdr, hr(t=1.5, sp=8)]

    # Details
    story.append(Table([
        [Paragraph('Date:', mk('label')),      Paragraph(str(notice_date), mk('body'))],
        [Paragraph('To (Purchaser):', mk('label')), Paragraph(f'<b>{tenant}</b>', mk('body'))],
        [Paragraph('Property:', mk('label')),  Paragraph(f'<b>{prop_addr}</b>', mk('body'))],
    ], colWidths=[1.0 * inch, W - 1.0 * inch],
    style=TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ])))
    story += [hr(color=HexColor('#CCCCCC'), t=0.5, sp=8)]

    # Body text
    story.append(Paragraph(
        f'YOU ARE HEREBY NOTIFIED that you are in default under the Land Installment Contract '
        f'for the premises located at <b>{prop_addr}</b>. Pursuant to Ohio Revised Code '
        f'\u00a7 5313.06, you have <b>TEN (10) DAYS</b> from the date of this notice to '
        f'cure the default stated below. Failure to cure within the time specified will '
        f'result in forfeiture of all rights under the Land Installment Contract.',
        mk('body')))
    story.append(sp(10))

    # Default items table
    rows = [[Paragraph('NATURE OF DEFAULT', mk('label')), Paragraph('AMOUNT', mk('label'))]]
    for item in items:
        desc = item.get('item_description', '')
        amt  = float(item.get('item_amount', 0) or 0)
        rows.append([
            Paragraph(desc, mk('body')),
            Paragraph(f'${amt:,.2f}' if amt else '', mk('body')),
        ])
    if not items:
        rows.append([Paragraph('Past due payments under Land Installment Contract', mk('body')),
                     Paragraph(f'${default_amt:,.2f}', mk('body'))])
    rows.append([
        Paragraph('<b>TOTAL AMOUNT IN DEFAULT</b>', mk('bold')),
        Paragraph(f'<b>${default_amt:,.2f}</b>', mk('bold')),
    ])
    ct = Table(rows, colWidths=[W * 0.72, W * 0.28])
    ct.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), LGRAY),
        ('BACKGROUND', (0, -1), (-1, -1), HexColor('#FFF0F0')),
        ('GRID', (0, 0), (-1, -1), 0.4, HexColor('#CCCCCC')),
        ('LINEBELOW', (0, -1), (-1, -1), 1.5, NCH_RED),
        ('LEFTPADDING', (0, 0), (-1, -1), 8),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 6),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    story += [ct, sp(10)]

    # Cure deadline
    story.append(Paragraph(
        f'To cure this default, you must pay the full amount stated above on or before '
        f'<b>{cure_dl}</b>. Payment must be made to {seller} at {phone}.',
        mk('body')))
    story.append(sp(8))

    # Warning
    story += [
        hr(color=NCH_RED, t=0.5, sp=5),
        Paragraph(
            f'IF THIS DEFAULT IS NOT CURED BY {cure_dl.upper()}, your rights under '
            f'the Land Installment Contract will be declared forfeited effective '
            f'{forfeit_date}, pursuant to ORC \u00a7 5313.06, and legal proceedings '
            f'may be initiated without further notice.',
            mk('warn')),
        hr(color=NCH_RED, t=0.5, sp=10),
    ]

    sig_name = signatory if signatory else seller

    # ── Ohio Statutory Disclaimer (ORC 1923.04) ──────────────────────────────────
    # Required for legal validity — must appear before signature block
    DISCLAIMER = (
        'YOU ARE BEING ASKED TO LEAVE THE PREMISES. IF YOU DO NOT LEAVE, '
        'AN EVICTION ACTION MAY BE INITIATED AGAINST YOU. IF YOU ARE IN DOUBT '
        'REGARDING YOUR LEGAL RIGHTS AND OBLIGATIONS AS A TENANT, IT IS '
        'RECOMMENDED THAT YOU SEEK LEGAL ASSISTANCE.'
    )
    SERV_NOTE = ('This notice must be served at least three business days '
                 'before commencing the action.')

    story += [
        HRFlowable(width='100%', thickness=1, color=HexColor('#333333'),
                   spaceAfter=6, spaceBefore=6),
        Paragraph(DISCLAIMER, mk('disc')),
        Spacer(1, 4),
        Paragraph(SERV_NOTE, mk('note')),
        HRFlowable(width='100%', thickness=0.5, color=HexColor('#333333'),
                   spaceAfter=8, spaceBefore=0),
    ]
    # ── End Disclaimer ────────────────────────────────────────────────────────────

    sig = Table([[
        [Paragraph('Seller / Agent Signature:', mk('label')), sp(18),
         Paragraph('_' * 36, mk('sig')), sp(4),
         Paragraph(f'{sig_name}  |  {seller}', mk('label'))],
        [Paragraph('Date:', mk('label')), sp(18),
         Paragraph('_' * 22, mk('sig'))],
    ]], colWidths=[W * 0.65, W * 0.35])
    sig.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))
    story.append(sig)

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return output_path


if __name__ == '__main__':
    sample = {
        'tenant_name':     'John A. Smith',
        'property_address':'1117 Arlington Ave SW, Canton OH 44706',
        'notice_date':     'April 7, 2026',
        'default_amount':  1700.00,
        'default_items': [
            {'item_description': 'February 2026 payment', 'item_amount': 850.00},
            {'item_description': 'March 2026 payment',    'item_amount': 850.00},
        ],
        'cure_deadline':   'April 17, 2026',
        'forfeiture_date': 'April 17, 2026',
        'seller_name':     'Nice City Homes LLC',
        'seller_signatory':'Michael Kell',
    }
    out = generate(sample, '/home/claude/10DayNotice_Test.pdf')
    print(f'Generated: {out}')
