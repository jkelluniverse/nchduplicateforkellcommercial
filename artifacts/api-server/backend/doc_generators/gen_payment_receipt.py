"""
Payment Receipt — NCH Branded
==============================
Ohio compliant payment receipt. One page.

FORM FIELDS:
  receipt_number      str    auto-generated or manual
  received_from       str    payer full name
  property_address    str    associated property
  payment_date        str    defaults to today
  amount_received     float  amount paid
  payment_for         str    dropdown — what the payment is for
  payment_for_detail  str    optional detail
  payment_method      str    Cash / Check / Zelle / Money Order / Other
  check_number        str    optional — only if check
  received_by         str    defaults to Nice City Homes LLC
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
GREEN   = HexColor("#1A5C2A")


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
    receipt_num  = data.get('receipt_number', f'RCP-{date.today().strftime("%Y%m%d")}')
    from_name    = data['received_from']
    prop_addr    = data['property_address']
    pay_date     = data.get('payment_date', date.today().strftime('%B %d, %Y'))
    amount       = float(data.get('amount_received', 0))
    pay_for      = data.get('payment_for', 'Land contract payment')
    pay_detail   = data.get('payment_for_detail', '')
    pay_method   = data.get('payment_method', 'Cash')
    check_num    = data.get('check_number', '')
    received_by  = data.get('received_by', 'Nice City Homes LLC')

    if output_path is None:
        safe = from_name.replace(' ', '_').replace('/', '_')
        output_path = f'/tmp/Receipt_{safe}_{pay_date.replace(" ","_")}.pdf'

    doc = SimpleDocTemplate(output_path, pagesize=letter,
        leftMargin=inch, rightMargin=inch,
        topMargin=0.75 * inch, bottomMargin=0.85 * inch)

    W = letter[0] - 2 * inch

    def mk(name):
        return {
            'title':   ParagraphStyle('title', fontName='Helvetica-Bold', fontSize=22,
                                      textColor=NCH_RED, alignment=TA_CENTER, leading=26,
                                      spaceAfter=0, spaceBefore=0),
            'body':    ParagraphStyle('body', fontName='Helvetica', fontSize=11,
                                      textColor=DARK, leading=15, spaceAfter=0, spaceBefore=0),
            'bold':    ParagraphStyle('bold', fontName='Helvetica-Bold', fontSize=11,
                                      textColor=DARK, leading=15, spaceAfter=0, spaceBefore=0),
            'label':   ParagraphStyle('label', fontName='Helvetica-Bold', fontSize=9,
                                      textColor=MUTED, leading=12, spaceAfter=0, spaceBefore=0),
            'amount':  ParagraphStyle('amount', fontName='Helvetica-Bold', fontSize=28,
                                      textColor=GREEN, alignment=TA_CENTER, leading=34,
                                      spaceAfter=0, spaceBefore=0),
            'amtlbl':  ParagraphStyle('amtlbl', fontName='Helvetica-Bold', fontSize=10,
                                      textColor=MUTED, alignment=TA_CENTER, leading=13,
                                      spaceAfter=0, spaceBefore=0),
            'rcpt':    ParagraphStyle('rcpt', fontName='Helvetica', fontSize=10,
                                      textColor=MUTED, alignment=TA_RIGHT, leading=13,
                                      spaceAfter=0, spaceBefore=0),
            'sig':     ParagraphStyle('sig', fontName='Helvetica', fontSize=10,
                                      textColor=DARK, leading=13, spaceAfter=0, spaceBefore=0),
            'note':    ParagraphStyle('note', fontName='Helvetica-Oblique', fontSize=9,
                                      textColor=MUTED, alignment=TA_CENTER, leading=12,
                                      spaceAfter=0, spaceBefore=0),
        }[name]

    def hr(color=NCH_RED, t=1, sp=6):
        return HRFlowable(width='100%', thickness=t, color=color,
                          spaceAfter=sp, spaceBefore=sp)
    def sp(n): return Spacer(1, n)

    story = []

    # Header: logo left, title center, receipt # right
    logo_path = os.path.abspath(os.path.join(
        os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'NCH_LOGO.png'))
    logo_h = 0.7 * inch
    logo_w = logo_h * (713 / 338)

    hdr_right = [
        Paragraph('PAYMENT RECEIPT', mk('title')),
    ]
    rcpt_right = [
        Paragraph(f'Receipt #: {receipt_num}', mk('rcpt')),
        Paragraph(f'Date: {pay_date}', mk('rcpt')),
    ]
    if os.path.exists(logo_path):
        hdr = Table([[RLImage(logo_path, width=logo_w, height=logo_h),
                      hdr_right,
                      rcpt_right]],
                    colWidths=[logo_w + 0.1 * inch, W * 0.45, W * 0.35])
    else:
        hdr = Table([['', hdr_right, rcpt_right]],
                    colWidths=[0.1 * inch, W * 0.5, W * 0.4])
    hdr.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 0),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 0),
    ]))
    story += [hdr, hr(t=1.5, sp=10)]

    # Amount box — prominent
    amt_table = Table([[
        [Paragraph('AMOUNT RECEIVED', mk('amtlbl')),
         sp(4),
         Paragraph(f'${amount:,.2f}', mk('amount'))],
    ]], colWidths=[W])
    amt_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, -1), HexColor('#F0FFF4')),
        ('BOX', (0, 0), (-1, -1), 1.5, GREEN),
        ('LEFTPADDING', (0, 0), (-1, -1), 16),
        ('RIGHTPADDING', (0, 0), (-1, -1), 16),
        ('TOPPADDING', (0, 0), (-1, -1), 10),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 10),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
    ]))
    story += [amt_table, sp(12)]

    # Details
    pay_for_full = f'{pay_for} — {pay_detail}' if pay_detail else pay_for
    method_full  = f'{pay_method} (Check #{check_num})' if check_num else pay_method

    detail_rows = [
        [Paragraph('Received From:', mk('label')),
         Paragraph(f'<b>{from_name}</b>', mk('body'))],
        [Paragraph('Property:', mk('label')),
         Paragraph(prop_addr, mk('body'))],
        [Paragraph('Payment For:', mk('label')),
         Paragraph(pay_for_full, mk('body'))],
        [Paragraph('Payment Method:', mk('label')),
         Paragraph(method_full, mk('body'))],
        [Paragraph('Received By:', mk('label')),
         Paragraph(received_by, mk('body'))],
    ]
    dt = Table(detail_rows, colWidths=[1.2 * inch, W - 1.2 * inch])
    dt.setStyle(TableStyle([
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 0),
        ('RIGHTPADDING', (0, 0), (-1, -1), 0),
        ('TOPPADDING', (0, 0), (-1, -1), 5),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 5),
        ('LINEBELOW', (0, 0), (-1, -2), 0.3, HexColor('#EEEEEE')),
    ]))
    story += [dt, sp(14)]

    story += [hr(color=HexColor('#CCCCCC'), t=0.5, sp=10)]

    # Signature block
    sig = Table([[
        [Paragraph('Received By (Signature):', mk('label')), sp(20),
         Paragraph('_' * 36, mk('sig')), sp(4),
         Paragraph(received_by, mk('label'))],
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
    story += [sig, sp(12)]

    story.append(Paragraph(
        'This receipt is provided as confirmation of payment received. '
        'Please retain for your records.',
        mk('note')))

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return output_path


if __name__ == '__main__':
    sample = {
        'receipt_number':    'RCP-2026-001',
        'received_from':     'John A. Smith',
        'property_address':  '1117 Arlington Ave SW, Canton OH 44706',
        'payment_date':      'April 7, 2026',
        'amount_received':   828.56,
        'payment_for':       'Land contract payment',
        'payment_for_detail':'April 2026',
        'payment_method':    'Zelle',
        'received_by':       'Nice City Homes LLC',
    }
    out = generate(sample, '/home/claude/PaymentReceipt_Test.pdf')
    print(f'Generated: {out}')
