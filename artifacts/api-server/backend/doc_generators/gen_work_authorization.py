"""
Work Authorization Form — NCH Branded
=======================================
Client authorization to proceed with contractor work. One page.

FORM FIELDS:
  job_number          str    NCH-YYYY-### job number
  client_name         str    BSMK / Coastal Management LLC / Other
  client_name_other   str    only if client_name = Other
  property_address    str    work site address
  auth_date           str    defaults to today
  scope_of_work       str    description of all work authorized
  authorized_amount   float  total authorized dollar amount
  deposit_amount      float  calculated: authorized_amount * 0.5
  start_date          str    optional estimated start date
  client_signatory    str    client authorized representative
  nch_signatory       str    defaults to Jack Kanam
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
    job_num      = data.get('job_number', '')
    client       = data.get('client_name', '')
    if client == 'Other':
        client = data.get('client_name_other', client)
    prop_addr    = data['property_address']
    auth_date    = data.get('auth_date', date.today().strftime('%B %d, %Y'))
    scope        = data['scope_of_work']
    auth_amt     = float(data.get('authorized_amount', 0))
    deposit      = float(data.get('deposit_amount', auth_amt * 0.5))
    start_date   = data.get('start_date', '')
    client_sig   = data.get('client_signatory', '')
    nch_sig      = data.get('nch_signatory', 'Jack Kanam')

    if output_path is None:
        safe = prop_addr.replace(' ', '_').replace('/', '_').replace(',', '')[:30]
        output_path = f'/tmp/WorkAuth_{safe}.pdf'

    doc = SimpleDocTemplate(output_path, pagesize=letter,
        leftMargin=inch, rightMargin=inch,
        topMargin=0.75 * inch, bottomMargin=0.85 * inch)

    W = letter[0] - 2 * inch

    def mk(name):
        return {
            'title':  ParagraphStyle('title', fontName='Helvetica-Bold', fontSize=20,
                                     textColor=NCH_RED, alignment=TA_CENTER, leading=24,
                                     spaceAfter=2, spaceBefore=0),
            'sub':    ParagraphStyle('sub', fontName='Helvetica-Bold', fontSize=11,
                                     textColor=NCH_RED, alignment=TA_CENTER, leading=15,
                                     spaceAfter=0, spaceBefore=0),
            'body':   ParagraphStyle('body', fontName='Helvetica', fontSize=11,
                                     textColor=DARK, leading=15, spaceAfter=0, spaceBefore=0),
            'bold':   ParagraphStyle('bold', fontName='Helvetica-Bold', fontSize=11,
                                     textColor=DARK, leading=15, spaceAfter=0, spaceBefore=0),
            'label':  ParagraphStyle('label', fontName='Helvetica-Bold', fontSize=9,
                                     textColor=MUTED, leading=12, spaceAfter=0, spaceBefore=0),
            'scope':  ParagraphStyle('scope', fontName='Helvetica', fontSize=11,
                                     textColor=DARK, leading=16, spaceAfter=0, spaceBefore=0),
            'sig':    ParagraphStyle('sig', fontName='Helvetica', fontSize=10,
                                     textColor=DARK, leading=13, spaceAfter=0, spaceBefore=0),
            'terms':  ParagraphStyle('terms', fontName='Helvetica-Oblique', fontSize=9,
                                     textColor=MUTED, leading=13, spaceAfter=0, spaceBefore=0),
            'rcpt':   ParagraphStyle('rcpt', fontName='Helvetica', fontSize=10,
                                     textColor=MUTED, alignment=TA_RIGHT, leading=13,
                                     spaceAfter=0, spaceBefore=0),
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

    title_block = [Paragraph('WORK AUTHORIZATION', mk('title'))]
    job_block   = [
        Paragraph(f'Job #: {job_num}', mk('rcpt')),
        Paragraph(f'Date: {auth_date}', mk('rcpt')),
    ]
    if os.path.exists(logo_path):
        hdr = Table([[RLImage(logo_path, width=logo_w, height=logo_h),
                      title_block, job_block]],
                    colWidths=[logo_w + 0.1 * inch, W * 0.45, W * 0.38])
    else:
        hdr = Table([['', title_block, job_block]],
                    colWidths=[0.1 * inch, W * 0.5, W * 0.38])
    hdr.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))
    story += [hdr, hr(t=1.5, sp=8)]

    # Job info block
    info_rows = [
        [Paragraph('Client:', mk('label')),   Paragraph(f'<b>{client}</b>', mk('body')),
         Paragraph('Property:', mk('label')), Paragraph(f'<b>{prop_addr}</b>', mk('body'))],
    ]
    if start_date:
        info_rows.append([
            Paragraph('Est. Start Date:', mk('label')), Paragraph(start_date, mk('body')),
            '', '',
        ])
    it = Table(info_rows, colWidths=[0.9 * inch, W * 0.38, 0.7 * inch, W * 0.38])
    it.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 8),
        ('TOPPADDING', (0, 0), (-1, -1), 3),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 3),
    ]))
    story += [it, hr(color=HexColor('#CCCCCC'), t=0.5, sp=8)]

    # Scope of work box
    story.append(Paragraph('SCOPE OF WORK AUTHORIZED', mk('label')))
    story.append(sp(4))
    scope_table = Table([[Paragraph(scope, mk('scope'))]], colWidths=[W])
    scope_table.setStyle(TableStyle([
        ('BOX', (0, 0), (-1, -1), 0.5, HexColor('#CCCCCC')),
        ('BACKGROUND', (0, 0), (-1, -1), LGRAY),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
    ]))
    story += [scope_table, sp(10)]

    # Financial summary
    fin_rows = [
        [Paragraph('TOTAL AUTHORIZED AMOUNT', mk('label')),
         Paragraph(f'<b>${auth_amt:,.2f}</b>', mk('bold'))],
        [Paragraph('DEPOSIT REQUIRED (50%)', mk('label')),
         Paragraph(f'<b>${deposit:,.2f}</b>', mk('bold'))],
        [Paragraph('BALANCE DUE UPON COMPLETION', mk('label')),
         Paragraph(f'<b>${auth_amt - deposit:,.2f}</b>', mk('bold'))],
    ]
    ft = Table(fin_rows, colWidths=[W * 0.65, W * 0.35])
    ft.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), HexColor('#FFF0F0')),
        ('BACKGROUND', (0, 1), (-1, 1), LGRAY),
        ('BACKGROUND', (0, 2), (-1, 2), HexColor('#FFF0F0')),
        ('BOX', (0, 0), (-1, -1), 0.5, HexColor('#CCCCCC')),
        ('LINEABOVE', (0, 1), (-1, 1), 0.3, HexColor('#CCCCCC')),
        ('LINEABOVE', (0, 2), (-1, 2), 0.3, HexColor('#CCCCCC')),
        ('LEFTPADDING', (0, 0), (-1, -1), 10),
        ('RIGHTPADDING', (0, 0), (-1, -1), 10),
        ('TOPPADDING', (0, 0), (-1, -1), 7),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 7),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('ALIGN', (1, 0), (1, -1), 'RIGHT'),
    ]))
    story += [ft, sp(8)]

    # Terms
    story.append(Paragraph(
        'By signing below, the client authorizes Nice City Homes LLC to proceed with '
        'the above scope of work. A 50% deposit is required prior to commencement. '
        'Remaining balance is due upon completion. Any changes to scope must be '
        'agreed in writing.',
        mk('terms')))
    story.append(sp(12))

    # Dual signature block
    story.append(hr(color=HexColor('#CCCCCC'), t=0.5, sp=8))
    sig_rows = [[
        [Paragraph('Client Authorized Signature:', mk('label')),
         sp(20),
         Paragraph('_' * 32, mk('sig')),
         sp(4),
         Paragraph(client_sig if client_sig else client, mk('label'))],
        [Paragraph('NCH Representative:', mk('label')),
         sp(20),
         Paragraph('_' * 32, mk('sig')),
         sp(4),
         Paragraph(nch_sig, mk('label'))],
    ]]
    st2 = Table(sig_rows, colWidths=[W * 0.5, W * 0.5])
    st2.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (0, -1), 20),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))
    story.append(st2)

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return output_path


if __name__ == '__main__':
    sample = {
        'job_number':       'NCH-2026-014',
        'client_name':      'BSMK',
        'property_address': '814 McKinley Ave NW, Canton OH 44703',
        'auth_date':        'April 7, 2026',
        'scope_of_work':    'Basement floor repair including floor joist replacement, '
                            'subfloor OSB installation, and concrete patching. '
                            'All materials and labor included.',
        'authorized_amount': 4200.00,
        'deposit_amount':    2100.00,
        'start_date':        'April 14, 2026',
        'client_signatory':  'James Goody',
        'nch_signatory':     'Jack Kanam',
    }
    out = generate(sample, '/home/claude/WorkAuthorization_Test.pdf')
    print(f'Generated: {out}')
