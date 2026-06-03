"""
Notice of Default — Land Contract
===================================
Ohio ORC Chapter 5313 compliant. NCH branded.

FORM FIELDS:
  buyer_name        str    purchaser full name(s)
  property_address  str    full property address
  notice_date       str    defaults to today
  default_amount    float  total amount in default
  default_items     list   [{"item_description": str, "item_amount": float}]
  cure_period_days  int    defaults to 30
  cure_deadline     str    defaults to today+30
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
    buyer        = data['buyer_name']
    prop_addr    = data['property_address']
    notice_date  = data.get('notice_date', date.today().strftime('%B %d, %Y'))
    default_amt  = float(data.get('default_amount', 0) or 0)
    items        = data.get('default_items', [])
    cure_days    = int(data.get('cure_period_days', 30))
    cure_dl      = data.get('cure_deadline',
                            (date.today() + timedelta(days=cure_days)).strftime('%B %d, %Y'))
    seller       = data.get('seller_name', 'Nice City Homes LLC')
    phone        = data.get('seller_phone', '330-495-8192')
    signatory    = data.get('seller_signatory', '')

    if output_path is None:
        safe = buyer.replace(' ', '_').replace('/', '_')
        output_path = f'/tmp/NoticeOfDefault_{safe}.pdf'

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
            'orc':   ParagraphStyle('orc', fontName='Helvetica-Oblique', fontSize=9,
                                    textColor=MUTED, leading=12, spaceAfter=0, spaceBefore=0),
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
        Paragraph('NOTICE OF DEFAULT', mk('title')),
        Paragraph('Land Installment Contract', mk('sub')),
        Paragraph('Pursuant to Ohio Revised Code Chapter 5313', mk('orc')),
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
        [Paragraph('Date:', mk('label')),        Paragraph(str(notice_date), mk('body'))],
        [Paragraph('To (Purchaser):', mk('label')), Paragraph(f'<b>{buyer}</b>', mk('body'))],
        [Paragraph('Property:', mk('label')),    Paragraph(f'<b>{prop_addr}</b>', mk('body'))],
        [Paragraph('From (Seller):', mk('label')), Paragraph(f'<b>{seller}</b>', mk('body'))],
    ], colWidths=[1.0 * inch, W - 1.0 * inch],
    style=TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ])))
    story += [hr(color=HexColor('#CCCCCC'), t=0.5, sp=8)]

    story.append(Paragraph(
        f'YOU ARE HEREBY NOTIFIED that you are in default of your obligations under the '
        f'Land Installment Contract for the premises at <b>{prop_addr}</b>. '
        f'The nature and amount of the default is as follows:',
        mk('body')))
    story.append(sp(10))

    rows = [[Paragraph('DESCRIPTION OF DEFAULT', mk('label')),
             Paragraph('AMOUNT', mk('label'))]]
    for item in items:
        desc = item.get('item_description', '')
        amt  = float(item.get('item_amount', 0) or 0)
        rows.append([
            Paragraph(desc, mk('body')),
            Paragraph(f'${amt:,.2f}' if amt else '', mk('body')),
        ])
    if not items:
        rows.append([Paragraph('Past due payments under Land Installment Contract',
                               mk('body')),
                     Paragraph(f'${default_amt:,.2f}', mk('body'))])
    rows.append([
        Paragraph('<b>TOTAL DEFAULT AMOUNT</b>', mk('bold')),
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

    story.append(Paragraph(
        f'You have <b>{cure_days} days</b> from the date of this notice to cure the '
        f'above default. The cure deadline is <b>{cure_dl}</b>. To cure, you must '
        f'pay the full amount stated above to {seller} at {phone}.',
        mk('body')))
    story.append(sp(8))

    story += [
        hr(color=NCH_RED, t=0.5, sp=5),
        Paragraph(
            f'FAILURE TO CURE THIS DEFAULT BY {cure_dl.upper()} may result in '
            f'forfeiture of your rights under the Land Installment Contract and '
            f'legal proceedings pursuant to Ohio Revised Code Chapter 5313.',
            mk('warn')),
        hr(color=NCH_RED, t=0.5, sp=10),
    ]

    sig_name = signatory if signatory else seller
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
        'buyer_name':      'John A. Smith',
        'property_address':'1117 Arlington Ave SW, Canton OH 44706',
        'notice_date':     'April 7, 2026',
        'default_amount':  1700.00,
        'default_items': [
            {'item_description': 'February 2026 payment', 'item_amount': 850.00},
            {'item_description': 'March 2026 payment',    'item_amount': 850.00},
        ],
        'cure_period_days': 30,
        'cure_deadline':   'May 7, 2026',
        'seller_name':     'Nice City Homes LLC',
        'seller_signatory':'Michael Kell',
    }
    out = generate(sample, '/home/claude/NoticeOfDefault_Test.pdf')
    print(f'Generated: {out}')
