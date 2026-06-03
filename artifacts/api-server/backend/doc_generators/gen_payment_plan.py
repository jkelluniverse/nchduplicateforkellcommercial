"""
Payment Plan / Catch-Up Agreement Generator — NCH Branded
===========================================================
Used when a tenant/purchaser falls behind and agrees to a structured
catch-up schedule on top of their regular payments.

FORM FIELDS:
  tenant_name          str    full name(s) of tenant/purchaser
  property_address     str    full property address
  agreement_date       str    date of agreement — defaults to today
  regular_payment      float  normal monthly payment amount
  arrears_amount       float  total amount behind
  arrears_description  str    description of what makes up the arrears
  plan_payments        list   [{"due_date": str, "amount": float, "description": str}]
                              catch-up payment schedule — separate from regular payment
  late_fees_waived     bool   True — fees waived while complying
  nch_signatory        str    NCH rep signing
  nch_title            str    NCH rep title

LEGAL TERMS BAKED IN:
  - Late fees waived while complying, reinstated if default
  - Full balance immediately due on default
  - NCH reserves right to pursue forfeiture/eviction on default
  - Agreement does not waive any rights under original contract
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
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
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
    agr_date     = data.get('agreement_date', date.today().strftime('%B %d, %Y'))
    regular_pmt  = float(data.get('regular_payment', 0))
    arrears      = float(data.get('arrears_amount', 0))
    arrears_desc = data.get('arrears_description', 'Past due amounts under the existing agreement')
    plan_pmts    = data.get('plan_payments', [])
    nch_sig      = data.get('nch_signatory', 'Jacob Kell')
    nch_title    = data.get('nch_title', 'Nice City Homes LLC')

    if output_path is None:
        safe = tenant.replace(' ', '_').replace('/', '_')
        output_path = f'/tmp/PaymentPlan_{safe}.pdf'

    doc = SimpleDocTemplate(output_path, pagesize=letter,
        leftMargin=inch, rightMargin=inch,
        topMargin=0.75 * inch, bottomMargin=0.85 * inch)

    W = letter[0] - 2 * inch

    def mk(name):
        return {
            'title':  ParagraphStyle('title', fontName='Helvetica-Bold', fontSize=18,
                                     textColor=NCH_RED, alignment=TA_CENTER, leading=22,
                                     spaceAfter=2, spaceBefore=0),
            'sub':    ParagraphStyle('sub', fontName='Helvetica-Bold', fontSize=11,
                                     textColor=NCH_RED, alignment=TA_CENTER, leading=15,
                                     spaceAfter=0, spaceBefore=0),
            'body':   ParagraphStyle('body', fontName='Helvetica', fontSize=10.5,
                                     textColor=DARK, leading=15, spaceAfter=0, spaceBefore=0),
            'bold':   ParagraphStyle('bold', fontName='Helvetica-Bold', fontSize=10.5,
                                     textColor=DARK, leading=15, spaceAfter=0, spaceBefore=0),
            'label':  ParagraphStyle('label', fontName='Helvetica-Bold', fontSize=9,
                                     textColor=MUTED, leading=12, spaceAfter=0, spaceBefore=0),
            'legal':  ParagraphStyle('legal', fontName='Helvetica', fontSize=9.5,
                                     textColor=DARK, leading=14, spaceAfter=0, spaceBefore=0),
            'sig':    ParagraphStyle('sig', fontName='Helvetica', fontSize=10,
                                     textColor=DARK, leading=13, spaceAfter=0, spaceBefore=0),
            'warn':   ParagraphStyle('warn', fontName='Helvetica-Bold', fontSize=10,
                                     textColor=NCH_RED, leading=14, spaceAfter=0, spaceBefore=0),
            'rcpt':   ParagraphStyle('rcpt', fontName='Helvetica', fontSize=10,
                                     textColor=MUTED, alignment=TA_RIGHT, leading=13,
                                     spaceAfter=0, spaceBefore=0),
        }[name]

    def hr(color=NCH_RED, t=1, sp=6):
        return HRFlowable(width='100%', thickness=t, color=color,
                          spaceAfter=sp, spaceBefore=sp)
    def sp(n): return Spacer(1, n)

    story = []

    # ── Header ────────────────────────────────────────────────────────────────────
    logo_path = os.path.abspath(os.path.join(
        os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'NCH_LOGO.png'))
    logo_h = 0.7 * inch
    logo_w = logo_h * (713 / 338)

    title_block = [
        Paragraph('PAYMENT PLAN AGREEMENT', mk('title')),
        Paragraph('Catch-Up Payment Schedule', mk('sub')),
    ]
    date_block = [
        Paragraph(f'Date: {agr_date}', mk('rcpt')),
    ]
    if os.path.exists(logo_path):
        hdr = Table([[RLImage(logo_path, width=logo_w, height=logo_h),
                      title_block, date_block]],
                    colWidths=[logo_w + 0.1 * inch, W * 0.52, W * 0.3])
    else:
        hdr = Table([['', title_block, date_block]],
                    colWidths=[0.1 * inch, W * 0.6, W * 0.3])
    hdr.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))
    story += [hdr, hr(t=1.5, sp=8)]

    # ── Party info ────────────────────────────────────────────────────────────────
    story.append(Table([
        [Paragraph('Tenant / Purchaser:', mk('label')),
         Paragraph(f'<b>{tenant}</b>', mk('body'))],
        [Paragraph('Property Address:', mk('label')),
         Paragraph(f'<b>{prop_addr}</b>', mk('body'))],
        [Paragraph('Regular Monthly Payment:', mk('label')),
         Paragraph(f'<b>${regular_pmt:,.2f}</b>', mk('body'))],
        [Paragraph('Total Amount in Arrears:', mk('label')),
         Paragraph(f'<b>${arrears:,.2f}</b>', mk('bold'))],
    ], colWidths=[1.5 * inch, W - 1.5 * inch],
    style=TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ])))
    story += [hr(color=HexColor('#CCCCCC'), t=0.5, sp=8)]

    # ── Arrears description ───────────────────────────────────────────────────────
    story.append(Paragraph('<b>Description of Amount Owed:</b>', mk('bold')))
    story.append(sp(4))
    story.append(Paragraph(arrears_desc, mk('body')))
    story.append(sp(10))

    # ── Catch-up schedule ─────────────────────────────────────────────────────────
    story.append(Paragraph('<b>Agreed Catch-Up Payment Schedule:</b>', mk('bold')))
    story.append(sp(4))
    story.append(Paragraph(
        f'In addition to the regular monthly payment of ${regular_pmt:,.2f}, '
        f'{tenant} agrees to make the following additional catch-up payments '
        f'toward the outstanding balance of ${arrears:,.2f}:',
        mk('body')))
    story.append(sp(8))

    if plan_pmts:
        rows = [[Paragraph('DUE DATE', mk('label')),
                 Paragraph('CATCH-UP AMOUNT', mk('label')),
                 Paragraph('DESCRIPTION', mk('label'))]]
        running = arrears
        for pmt in plan_pmts:
            amt = float(pmt.get('amount', 0))
            running -= amt
            rows.append([
                Paragraph(pmt.get('due_date', ''), mk('body')),
                Paragraph(f'${amt:,.2f}', mk('body')),
                Paragraph(pmt.get('description', ''), mk('body')),
            ])
        rows.append([
            Paragraph('', mk('body')),
            Paragraph(f'<b>Total: ${sum(float(p.get("amount",0)) for p in plan_pmts):,.2f}</b>',
                      mk('bold')),
            Paragraph('', mk('body')),
        ])
        ct = Table(rows, colWidths=[1.4 * inch, 1.4 * inch, W - 2.8 * inch])
        ct.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), LGRAY),
            ('BACKGROUND', (0, -1), (-1, -1), HexColor('#FFF0F0')),
            ('GRID', (0, 0), (-1, -2), 0.4, HexColor('#CCCCCC')),
            ('LINEABOVE', (0, -1), (-1, -1), 1, NCH_RED),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
            ('RIGHTPADDING', (0, 0), (-1, -1), 8),
            ('TOPPADDING', (0, 0), (-1, -1), 6),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]))
        story.append(ct)
    else:
        # Blank schedule — 5 empty rows for handwriting
        rows = [[Paragraph('DUE DATE', mk('label')),
                 Paragraph('CATCH-UP AMOUNT', mk('label')),
                 Paragraph('DESCRIPTION / NOTES', mk('label'))]]
        for _ in range(5):
            rows.append([Paragraph('', mk('body')),
                         Paragraph('', mk('body')),
                         Paragraph('', mk('body'))])
        rows.append([Paragraph('', mk('body')),
                     Paragraph('<b>Total: $____________</b>', mk('bold')),
                     Paragraph('', mk('body'))])
        ct = Table(rows, colWidths=[1.4 * inch, 1.6 * inch, W - 3.0 * inch])
        ct.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), LGRAY),
            ('BACKGROUND', (0, -1), (-1, -1), HexColor('#FFF0F0')),
            ('GRID', (0, 0), (-1, -1), 0.4, HexColor('#CCCCCC')),
            ('LINEABOVE', (0, -1), (-1, -1), 1, NCH_RED),
            ('LEFTPADDING', (0, 0), (-1, -1), 8),
            ('RIGHTPADDING', (0, 0), (-1, -1), 8),
            ('TOPPADDING', (0, 0), (-1, -1), 14),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 14),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ]))
        story.append(ct)

    story.append(sp(10))

    # ── Terms ─────────────────────────────────────────────────────────────────────
    story.append(Paragraph('<b>Terms and Conditions:</b>', mk('bold')))
    story.append(sp(5))

    terms = [
        f'1. <b>Regular Payment.</b> The regular monthly payment of ${regular_pmt:,.2f} '
        f'remains due on the 1st of each month and is not modified by this agreement.',

        f'2. <b>Catch-Up Payments.</b> Catch-up payments are due on the dates listed above '
        f'and are in addition to the regular monthly payment. Catch-up payments must be '
        f'received by the due date shown.',

        f'3. <b>Late Fees.</b> Late fees that have accrued as of the date of this agreement '
        f'are waived provided that {tenant} complies fully with this payment plan. '
        f'If this agreement is defaulted upon, all previously waived late fees are '
        f'immediately reinstated and added to the total balance due.',

        f'4. <b>Default.</b> Failure to make any regular monthly payment or any catch-up '
        f'payment by its due date constitutes a default of this agreement. Upon default, '
        f'the entire outstanding balance becomes immediately due and payable in full. '
        f'Nice City Homes LLC reserves all rights under the original agreement, including '
        f'the right to pursue forfeiture, eviction, or any other legal remedy available '
        f'under Ohio law.',

        f'5. <b>No Waiver of Rights.</b> This payment plan agreement does not waive, '
        f'modify, or supersede any rights of Nice City Homes LLC under the original '
        f'land contract, lease, or any other agreement between the parties. All original '
        f'terms remain in full force and effect.',

        f'6. <b>Good Faith.</b> Nice City Homes LLC agrees to work in good faith with '
        f'{tenant} provided that the terms of this agreement are met. Nothing in this '
        f'agreement obligates Nice City Homes LLC to enter into any future payment plan.',
    ]

    for term in terms:
        story.append(Paragraph(term, mk('legal')))
        story.append(sp(5))

    story.append(sp(5))

    # ── Warning ───────────────────────────────────────────────────────────────────
    story += [
        hr(color=NCH_RED, t=0.5, sp=5),
        Paragraph(
            'DEFAULT ON THIS AGREEMENT WILL RESULT IN THE FULL BALANCE BECOMING '
            'IMMEDIATELY DUE AND MAY RESULT IN FORFEITURE OR EVICTION PROCEEDINGS.',
            mk('warn')),
        hr(color=NCH_RED, t=0.5, sp=10),
    ]

    # ── Signatures ────────────────────────────────────────────────────────────────
    story.append(Paragraph(
        'By signing below, both parties agree to the terms of this payment plan.',
        mk('body')))
    story.append(sp(12))

    sig = Table([[
        [Paragraph('Tenant / Purchaser Signature:', mk('label')),
         sp(18),
         Paragraph('_' * 36, mk('sig')),
         sp(4),
         Paragraph(tenant, mk('label'))],
        [Paragraph('Date:', mk('label')),
         sp(18),
         Paragraph('_' * 22, mk('sig'))],
    ]], colWidths=[W * 0.62, W * 0.38])
    sig.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))
    story += [sig, sp(14)]

    sig2 = Table([[
        [Paragraph('NCH Representative Signature:', mk('label')),
         sp(18),
         Paragraph('_' * 36, mk('sig')),
         sp(4),
         Paragraph(f'{nch_sig}  |  {nch_title}', mk('label'))],
        [Paragraph('Date:', mk('label')),
         sp(18),
         Paragraph('_' * 22, mk('sig'))],
    ]], colWidths=[W * 0.62, W * 0.38])
    sig2.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))
    story.append(sig2)

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return output_path


if __name__ == '__main__':
    # Joas Rosier — 2010 9th St SW — blank schedule for Jacob to fill in with Joas
    sample_blank = {
        'tenant_name':         'Joas Rosier',
        'property_address':    '2010 9th St SW, Canton, Ohio',
        'agreement_date':      'April 15, 2026',
        'regular_payment':     1250.00,
        'arrears_amount':      1325.00,
        'arrears_description': (
            'February 2026 rent payment of $1,250.00 was not received. '
            'An additional balance of $75.00 in late fees has accrued. '
            'Total outstanding balance as of April 15, 2026: $1,325.00.'
        ),
        'plan_payments':       [],   # blank — Jacob fills in with Joas
        'nch_signatory':       'Jacob Kell',
        'nch_title':           'Nice City Homes LLC',
    }
    out = generate(sample_blank, '/home/claude/PaymentPlan_JoasRosier.pdf')
    print(f'Generated (blank schedule): {out}')
