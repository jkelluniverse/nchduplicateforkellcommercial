"""
3-Day Notice to Pay or Vacate — NCH Branded, One Page
=======================================================
FORM FIELDS:
  tenant_name          str    all adults on the contract
  property_address     str    full property address
  notice_date          str    defaults to today
  past_rent_amount     float  optional
  rent_period          str    e.g. "March & April 2026"
  late_fees            float  optional, 0 if none
  other_fees           float  optional, 0 if none
  other_fees_detail    str    description of other fees
  payment_instructions str    defaults to contact NCH
  landlord_name        str    defaults to Nice City Homes LLC
  landlord_phone       str    static 330-495-8192
"""

import os
from datetime import date
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
    tenant      = data['tenant_name']
    prop_addr   = data['property_address']
    notice_date = data.get('notice_date', date.today().strftime('%B %d, %Y'))
    past_rent   = float(data.get('past_rent_amount', 0) or 0)
    rent_period = data.get('rent_period', '')
    late_fees   = float(data.get('late_fees', 0) or 0)
    other_fees  = float(data.get('other_fees', 0) or 0)
    other_det   = data.get('other_fees_detail', '')
    total_due   = past_rent + late_fees + other_fees
    pay_instr   = data.get('payment_instructions',
                           'Contact Nice City Homes LLC at 330-495-8192 to arrange payment.')
    landlord    = data.get('landlord_name', 'Nice City Homes LLC')
    phone       = data.get('landlord_phone', '330-495-8192')

    if output_path is None:
        safe = tenant.replace(' ', '_').replace('/', '_')
        output_path = f'/tmp/3DayNotice_{safe}.pdf'

    doc = SimpleDocTemplate(output_path, pagesize=letter,
        leftMargin=inch, rightMargin=inch,
        topMargin=0.75 * inch, bottomMargin=0.85 * inch)

    W = letter[0] - 2 * inch

    def mk(name):
        return {
            'title': ParagraphStyle('title', fontName='Helvetica-Bold', fontSize=18,
                                    textColor=NCH_RED, alignment=TA_CENTER, leading=22,
                                    spaceAfter=2, spaceBefore=0),
            'sub':   ParagraphStyle('sub', fontName='Helvetica-Bold', fontSize=12,
                                    textColor=NCH_RED, alignment=TA_CENTER, leading=16,
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
        }[name]

    def hr(color=NCH_RED, t=1, sp=6):
        return HRFlowable(width='100%', thickness=t, color=color,
                          spaceAfter=sp, spaceBefore=sp)

    def sp(n): return Spacer(1, n)

    story = []

    logo_path = os.path.abspath(os.path.join(
        os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'NCH_LOGO.png'))
    logo_h = 0.7 * inch
    logo_w = logo_h * (713 / 338)

    title_block = [
        Paragraph('OHIO EVICTION NOTICE', mk('title')),
        Paragraph('3-DAY NOTICE TO PAY OR VACATE', mk('sub')),
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

    story.append(Table([
        [Paragraph('Date:', mk('label')),     Paragraph(str(notice_date), mk('body'))],
        [Paragraph('Tenant:', mk('label')),   Paragraph(f'<b>{tenant}</b>', mk('body'))],
        [Paragraph('Property:', mk('label')), Paragraph(f'<b>{prop_addr}</b>', mk('body'))],
    ], colWidths=[0.85 * inch, W - 0.85 * inch],
    style=TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ])))
    story += [hr(color=HexColor('#CCCCCC'), t=0.5, sp=8)]

    story.append(Paragraph(
        f'This notice is served to <b>{tenant}</b> and all residents and occupants '
        f'of the premises at <b>{prop_addr}</b>. In accordance with Ohio law, '
        f'you must within <b>THREE (3) DAYS</b> of receipt of this notice '
        f'pay the full amount due below, OR vacate and surrender possession of the premises.',
        mk('body')))
    story.append(sp(10))

    rows = [[Paragraph('DESCRIPTION', mk('label')), Paragraph('AMOUNT', mk('label'))]]
    if past_rent > 0:
        desc = f'Past Due Rent \u2014 {rent_period}' if rent_period else 'Past Due Rent'
        rows.append([Paragraph(desc, mk('body')), Paragraph(f'${past_rent:,.2f}', mk('body'))])
    if late_fees > 0:
        rows.append([Paragraph('Late Fees', mk('body')),
                     Paragraph(f'${late_fees:,.2f}', mk('body'))])
    if other_fees > 0:
        desc = f'Other \u2014 {other_det}' if other_det else 'Other Fees'
        rows.append([Paragraph(desc, mk('body')), Paragraph(f'${other_fees:,.2f}', mk('body'))])
    rows.append([
        Paragraph('<b>TOTAL AMOUNT DUE</b>', mk('bold')),
        Paragraph(f'<b>${total_due:,.2f}</b>', mk('bold')),
    ])
    ct = Table(rows, colWidths=[W * 0.75, W * 0.25])
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

    story += [Paragraph(f'<b>Payment Instructions:</b> {pay_instr}', mk('body')), sp(10)]

    story += [
        hr(color=NCH_RED, t=0.5, sp=5),
        Paragraph(
            'Failure to pay the full amount or vacate within three (3) days will result '
            'in legal proceedings to recover possession and all amounts owed, including '
            'court costs as allowed by Ohio law.', mk('warn')),
        hr(color=NCH_RED, t=0.5, sp=10),
    ]

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
        [Paragraph('Landlord Signature:', mk('label')), sp(20),
         Paragraph('_' * 36, mk('sig')), sp(4),
         Paragraph(f'{landlord}  |  {phone}', mk('label'))],
        [Paragraph('Date:', mk('label')), sp(20),
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
        'tenant_name':      'John A. Smith',
        'property_address': '1117 Arlington Ave SW, Canton OH 44706',
        'notice_date':      'April 7, 2026',
        'past_rent_amount': 850.00,
        'rent_period':      'March & April 2026',
        'late_fees':        75.00,
        'other_fees':       0,
        'landlord_name':    'Nice City Homes LLC',
        'landlord_phone':   '330-495-8192',
    }
    out = generate(sample, '/home/claude/3DayNotice_Test.pdf')
    print(f'Generated: {out}')
