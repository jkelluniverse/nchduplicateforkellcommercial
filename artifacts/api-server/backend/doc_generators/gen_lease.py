"""
Residential Lease Agreement Generator — NCH
============================================
Produces a filled Residential Lease Agreement PDF matching the NCH_Lease_2026 template.

FORM FIELDS:
  landlord_name          str   default "Nice City Homes, LLC"
  landlord_phone         str   default "(330) 495-8192"
  landlord_address       str   default "6521 Beverly Ave NE, Canton OH 44721"
  tenant_1_name          str   required
  tenant_1_phone         str
  tenant_1_email         str
  tenant_2_name          str   optional
  tenant_2_phone         str   optional
  tenant_2_email         str   optional
  property_address       str   required  (street line)
  city_state_zip         str   required  (e.g. "Canton, Ohio 44707")
  rental_inclusions      str   e.g. "None" or "Garage, basement storage"
  furnishings_appliances str   e.g. "Stove, refrigerator"
  lease_start_date       str   e.g. "May 1, 2026"
  lease_end_date         str   e.g. "April 30, 2027"
  monthly_rent           float
  grace_period_day       int   default 10
  move_in_date           str   e.g. "May 1, 2026"
  prorated_rent          float prorated first month amount
  late_fee               float default 75.00
  security_deposit       float
  pet_terms              str   optional, default "No pets permitted without prior written consent."
  nch_signatory          str   default "Michael Kell"
"""

import os
from datetime import date
from reportlab.lib.pagesizes import letter
from reportlab.lib.units import inch
from reportlab.lib.colors import HexColor
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, HRFlowable, Table, TableStyle, PageBreak
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
    canvas.setFont('Helvetica', 8)
    canvas.setFillColor(MUTED)
    canvas.drawString(inch, 0.45 * inch,
        'Nice City Homes, LLC  \u00b7  6521 Beverly Ave NE, Canton OH 44721  \u00b7  (330) 495-8192')
    canvas.drawRightString(letter[0] - inch, 0.45 * inch,
        f'Page {doc.page} of 7')
    canvas.setStrokeColor(NCH_RED)
    canvas.setLineWidth(0.5)
    canvas.line(inch, 0.62 * inch, letter[0] - inch, 0.62 * inch)
    canvas.restoreState()


def generate(data, output_path=None):
    landlord    = data.get('landlord_name', 'Nice City Homes, LLC')
    ll_phone    = data.get('landlord_phone', '(330) 495-8192')
    ll_addr     = data.get('landlord_address', '6521 Beverly Ave NE, Canton OH 44721')
    t1_name     = data['tenant_1_name']
    t1_phone    = data.get('tenant_1_phone', '')
    t1_email    = data.get('tenant_1_email', '')
    t2_name     = data.get('tenant_2_name', '').strip()
    t2_phone    = data.get('tenant_2_phone', '')
    t2_email    = data.get('tenant_2_email', '')
    prop_addr   = data['property_address']
    city_zip    = data.get('city_state_zip', '')
    inclusions  = data.get('rental_inclusions', 'None')
    furnish     = data.get('furnishings_appliances', 'None')
    start_date  = data.get('lease_start_date', '')
    end_date    = data.get('lease_end_date', '')
    rent        = float(data.get('monthly_rent', 0))
    grace_day   = int(float(data.get('grace_period_day', 10)))
    move_in     = data.get('move_in_date', '')
    prorated    = float(data.get('prorated_rent', 0))
    late_fee    = float(data.get('late_fee', 75.00))
    deposit     = float(data.get('security_deposit', 0))
    pet_terms   = data.get('pet_terms', 'No pets permitted without prior written consent of Landlord.')
    nch_sig     = data.get('nch_signatory', 'Michael Kell')

    all_tenants = t1_name + (f' and {t2_name}' if t2_name else '')

    if output_path is None:
        safe = t1_name.replace(' ', '_').replace('/', '_')
        output_path = f'/tmp/Lease_{safe}.pdf'

    doc = SimpleDocTemplate(output_path, pagesize=letter,
        leftMargin=inch, rightMargin=inch,
        topMargin=0.75 * inch, bottomMargin=0.9 * inch)

    W = letter[0] - 2 * inch

    def mk(name):
        return {
            'title':   ParagraphStyle('title',  fontName='Helvetica-Bold', fontSize=15,
                                      textColor=NCH_RED, alignment=TA_CENTER, leading=20, spaceAfter=2),
            'sub':     ParagraphStyle('sub',    fontName='Helvetica-Bold', fontSize=10,
                                      textColor=NCH_RED, alignment=TA_CENTER, leading=14, spaceAfter=0),
            'h1':      ParagraphStyle('h1',     fontName='Helvetica-Bold', fontSize=10.5,
                                      textColor=NCH_RED, leading=14, spaceBefore=10, spaceAfter=3),
            'body':    ParagraphStyle('body',   fontName='Helvetica', fontSize=9.5,
                                      textColor=DARK, leading=14, spaceAfter=0),
            'bold':    ParagraphStyle('bold',   fontName='Helvetica-Bold', fontSize=9.5,
                                      textColor=DARK, leading=14, spaceAfter=0),
            'label':   ParagraphStyle('label',  fontName='Helvetica-Bold', fontSize=8,
                                      textColor=MUTED, leading=11, spaceAfter=0),
            'val':     ParagraphStyle('val',    fontName='Helvetica-Bold', fontSize=9.5,
                                      textColor=NCH_RED, leading=14, spaceAfter=0),
            'sig':     ParagraphStyle('sig',    fontName='Helvetica', fontSize=9.5,
                                      textColor=DARK, leading=13, spaceAfter=0),
            'indent':  ParagraphStyle('indent', fontName='Helvetica', fontSize=9.5,
                                      textColor=DARK, leading=14, leftIndent=18, spaceAfter=0),
            'small':   ParagraphStyle('small',  fontName='Helvetica', fontSize=8.5,
                                      textColor=MUTED, leading=12, spaceAfter=0),
        }[name]

    def hr(color=NCH_RED, t=0.75, sp=5):
        return HRFlowable(width='100%', thickness=t, color=color, spaceAfter=sp, spaceBefore=sp)
    def sp(n): return Spacer(1, n)
    def clause(num, title): return Paragraph(f'Clause {num}. {title}', mk('h1'))

    def field_row(label, value, label_w=1.5):
        return Table([[Paragraph(label, mk('label')), Paragraph(str(value), mk('val'))]],
            colWidths=[label_w * inch, W - label_w * inch],
            style=TableStyle([
                ('VALIGN', (0,0), (-1,-1), 'TOP'),
                ('LEFTPADDING', (0,0), (-1,-1), 0),
                ('RIGHTPADDING', (0,0), (-1,-1), 0),
                ('TOPPADDING', (0,0), (-1,-1), 2),
                ('BOTTOMPADDING', (0,0), (-1,-1), 2),
            ]))

    def two_col(lbl1, v1, lbl2, v2):
        return Table([
            [Paragraph(lbl1, mk('label')), Paragraph(lbl2, mk('label'))],
            [Paragraph(str(v1), mk('val')), Paragraph(str(v2), mk('val'))],
        ], colWidths=[W * 0.5, W * 0.5],
        style=TableStyle([
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
            ('LEFTPADDING', (0,0), (-1,-1), 0),
            ('RIGHTPADDING', (0,0), (-1,-1), 6),
            ('TOPPADDING', (0,0), (-1,-1), 2),
            ('BOTTOMPADDING', (0,0), (-1,-1), 2),
        ]))

    story = []

    # ── Header ────────────────────────────────────────────────────────────────────
    logo_path = os.path.abspath(os.path.join(
        os.path.dirname(os.path.abspath(__file__)), '..', 'assets', 'NCH_LOGO.png'))
    logo_h = 0.65 * inch
    logo_w = logo_h * (713 / 338)

    title_block = [
        Paragraph('RESIDENTIAL LEASE AGREEMENT', mk('title')),
        Paragraph('Nice City Homes, LLC — Canton, Ohio', mk('sub')),
    ]
    if os.path.exists(logo_path):
        hdr = Table([[RLImage(logo_path, width=logo_w, height=logo_h), title_block, '']],
                    colWidths=[logo_w + 0.1*inch, W * 0.65, W * 0.15])
    else:
        hdr = Table([['', title_block, '']],
                    colWidths=[0.1*inch, W * 0.75, W * 0.15])
    hdr.setStyle(TableStyle([
        ('VALIGN', (0,0), (-1,-1), 'MIDDLE'),
        ('LEFTPADDING', (0,0), (-1,-1), 0),
        ('RIGHTPADDING', (0,0), (-1,-1), 0),
        ('TOPPADDING', (0,0), (-1,-1), 0),
        ('BOTTOMPADDING', (0,0), (-1,-1), 0),
    ]))
    story += [hdr, hr(t=1.5, sp=8)]

    # ── Clause 1: Parties ─────────────────────────────────────────────────────────
    story.append(clause(1, 'Identification of Landlord and Tenant(s)'))
    story.append(Paragraph(
        'This Residential Lease Agreement ("Agreement") is entered into between:', mk('body')))
    story.append(sp(6))

    story.append(two_col('Landlord:', landlord, 'Phone:', ll_phone))
    story.append(sp(2))
    story.append(field_row('Landlord Address:', ll_addr))
    story.append(sp(8))

    story.append(Paragraph(
        'AND the following Tenant(s), each of whom is jointly and severally liable for the full '
        'payment of rent and performance of all other terms of this Agreement:', mk('body')))
    story.append(sp(6))

    story.append(Paragraph('<b>Tenant 1</b>', mk('bold')))
    story.append(sp(3))
    story.append(two_col('Full Name:', t1_name, 'Phone:', t1_phone))
    story.append(sp(2))
    story.append(field_row('Email:', t1_email))
    story.append(sp(8))

    if t2_name:
        story.append(Paragraph('<b>Tenant 2</b>', mk('bold')))
        story.append(sp(3))
        story.append(two_col('Full Name:', t2_name, 'Phone:', t2_phone))
        story.append(sp(2))
        story.append(field_row('Email:', t2_email))
        story.append(sp(8))
    else:
        story.append(Paragraph('<b>Tenant 2 (if applicable):</b> N/A', mk('body')))
        story.append(sp(8))

    story.append(Paragraph(
        'Each Tenant named above is fully and equally responsible for all obligations under this '
        'Agreement regardless of which Tenant physically occupies the premises.', mk('small')))
    story.append(hr(color=HexColor('#CCCCCC'), t=0.4, sp=6))

    # ── Clause 2: Premises ────────────────────────────────────────────────────────
    story.append(clause(2, 'Identification of Premises'))
    story.append(Paragraph(
        'Subject to the terms and conditions of this Agreement, Landlord rents to Tenant(s), '
        'and Tenant(s) rents from Landlord, for residential purposes only, the premises '
        'located at:', mk('body')))
    story.append(sp(6))
    story.append(field_row('Property Address:', prop_addr))
    story.append(sp(2))
    story.append(field_row('City, State, Zip:', city_zip))
    story.append(sp(2))
    story.append(field_row('Rental also includes:', inclusions))
    story.append(sp(2))
    story.append(field_row('Furnishings/Appliances:', furnish))
    story.append(hr(color=HexColor('#CCCCCC'), t=0.4, sp=6))

    # ── Clause 3: Use ─────────────────────────────────────────────────────────────
    story.append(clause(3, 'Limits on Use and Occupancy'))
    story.append(Paragraph(
        'The premises are to be used only as a private residence for the Tenant(s) listed in '
        'Clause 1 of this Agreement and their minor children. Occupancy by guests for more than '
        '30 consecutive days is prohibited without Landlord\'s prior written consent and will be '
        'considered a breach of this Agreement.', mk('body')))
    story.append(hr(color=HexColor('#CCCCCC'), t=0.4, sp=6))

    # ── Clause 4: Term ────────────────────────────────────────────────────────────
    story.append(clause(4, 'Term of the Tenancy'))
    story.append(two_col('Lease Start Date:', start_date, 'Lease End Date:', end_date))
    story.append(sp(5))
    story.append(Paragraph(
        'Upon expiration, this Agreement shall convert to a month-to-month tenancy unless either '
        'party provides written notice of termination at least 30 days prior to the end of the term.',
        mk('body')))
    story.append(hr(color=HexColor('#CCCCCC'), t=0.4, sp=6))

    # ── Clause 5: Rent ────────────────────────────────────────────────────────────
    story.append(clause(5, 'Payment of Rent'))
    story.append(Paragraph('<b>Regular Monthly Rent</b>', mk('bold')))
    story.append(sp(4))
    story.append(two_col('Monthly Rent Amount:', f'${rent:,.2f}', 'Due Date:', '1st of each month'))
    story.append(sp(5))
    story.append(Paragraph(
        f'Rent is payable in advance on the first day of each month. When the due date falls on a '
        f'weekend or legal holiday, rent is due on the next business day. A grace period extends '
        f'through the {grace_day}th day of the month, after which late charges apply per Clause 6.',
        mk('body')))
    story.append(sp(8))

    story.append(Paragraph('<b>Prorated First Month\'s Rent</b>', mk('bold')))
    story.append(sp(4))
    story.append(two_col('Move-In Date:', move_in, 'Prorated Amount:', f'${prorated:,.2f}'))
    story.append(sp(5))
    story.append(Paragraph(
        'The prorated amount above will be paid on or before the Tenant\'s move-in date.',
        mk('body')))
    story.append(sp(8))

    story.append(Paragraph(
        '<b>Primary Form of Payment — DoorLoop Tenant Portal (REQUIRED)</b>', mk('bold')))
    story.append(sp(4))
    story.append(Paragraph(
        'ALL rent payments must be submitted through the Nice City Homes tenant portal powered '
        'by DoorLoop. Portal access is provided to each Tenant upon signing this Agreement.',
        mk('body')))
    story.append(sp(4))
    story.append(field_row('Portal address:', 'nicecityhomes.app.doorloop.com', 1.4))
    story.append(sp(2))
    story.append(Paragraph(
        'Mobile app: Available on iOS (App Store) and Android (Google Play) — search "DoorLoop"',
        mk('body')))
    story.append(sp(5))
    story.append(Paragraph(
        'The following payment methods are accepted through the DoorLoop portal:', mk('body')))
    for line in [
        '\u2022 ACH Bank Transfer (direct bank-to-bank) — FREE, recommended',
        '\u2022 Credit/Debit Card — accepted through the portal (3.5% processing fee applies, charged by processor)',
        '\u2022 Apple Pay / Google Pay — available through the portal where supported',
    ]:
        story.append(Paragraph(line, mk('indent')))
    story.append(sp(8))

    story.append(Paragraph(
        '<b>Alternative Payment Methods — Only by Explicit Landlord Approval</b>', mk('bold')))
    story.append(sp(4))
    story.append(Paragraph(
        'The following payment methods are NOT accepted as routine payment. They may only be used '
        'in exceptional circumstances and only with Landlord\'s prior verbal or written approval '
        'for that specific payment (e.g. security deposit & first month rent, holding a property):',
        mk('body')))
    for line in [
        '\u2610 Cash — accepted only if DoorLoop portal is temporarily unavailable. Receipt will be provided.',
        '\u2610 Zelle — accepted only with Landlord\'s advance written approval per individual payment.',
        '\u2610 Venmo — accepted only with Landlord\'s advance written approval per individual payment.',
    ]:
        story.append(Paragraph(line, mk('indent')))
    story.append(sp(5))
    story.append(Paragraph(
        'Tenant acknowledges that repeated use of alternative payment methods without approval, '
        'or tendering payment in a form not listed above, does not obligate Landlord to accept '
        'such payment and may be deemed a default under this Agreement.', mk('small')))
    story.append(sp(6))

    story.append(Paragraph('<b>Portal Registration</b>', mk('bold')))
    story.append(sp(4))
    story.append(Paragraph(
        'Tenant(s) agree to register on the DoorLoop portal within 5 days of signing this '
        'Agreement. Failure to register does not excuse Tenant from the obligation to pay rent '
        'on time. Payments Manager, Jacob Kell may be contacted at (330) 495-7821 or '
        'jacob@nicecityhomes.com for portal setup assistance.', mk('body')))
    story.append(hr(color=HexColor('#CCCCCC'), t=0.4, sp=6))

    # ── Clause 6: Late Charges ────────────────────────────────────────────────────
    story.append(clause(6, 'Late Charges'))
    story.append(Paragraph(
        f'If Tenant fails to pay the full rent amount by the end of the grace period stated in '
        f'Clause 5, Tenant will pay Landlord a late charge of:', mk('body')))
    story.append(sp(4))
    story.append(field_row('Late Fee Amount:', f'${late_fee:,.2f}'))
    story.append(sp(5))
    story.append(Paragraph(
        'This late fee is applied automatically through the DoorLoop portal at the end of the '
        'grace period. Landlord does not waive the right to insist on payment of rent in full '
        'on the date it is due. Repeated late payment may be grounds for termination of tenancy.',
        mk('body')))
    story.append(hr(color=HexColor('#CCCCCC'), t=0.4, sp=6))

    # ── Clause 7: Returned Payments ───────────────────────────────────────────────
    story.append(clause(7, 'Returned Check and Failed Electronic Payment Charges'))
    story.append(Paragraph(
        'If any check or electronic payment offered by Tenant in payment of rent or any other '
        'amount due under this Agreement is returned, declined, or reversed for any reason '
        '(including insufficient funds, stop payment, or bank rejection), Tenant will pay '
        'Landlord a returned payment charge of:', mk('body')))
    story.append(sp(4))
    story.append(field_row('Returned Payment Fee:', '$55.00'))
    story.append(hr(color=HexColor('#CCCCCC'), t=0.4, sp=6))

    # ── Clause 8: Security Deposit ────────────────────────────────────────────────
    story.append(clause(8, 'Security Deposit'))
    story.append(Paragraph(
        'On signing this Agreement, Tenant(s) will pay to Landlord the sum of:', mk('body')))
    story.append(sp(4))
    story.append(field_row('Security Deposit Amount:', f'${deposit:,.2f}'))
    story.append(sp(5))
    story.append(Paragraph(
        'Tenant may not, without Landlord\'s prior written consent, apply this security deposit '
        'to the last month\'s rent or to any other sum due under this Agreement. Within 30 days '
        'after Tenant has vacated the premises, returned all keys, and provided Landlord with a '
        'forwarding address, Landlord will return the deposit in full or provide Tenant with an '
        'itemized written statement of any deductions, along with a check for any remaining balance.',
        mk('body')))
    story.append(hr(color=HexColor('#CCCCCC'), t=0.4, sp=6))

    # ── Clause 9: Utilities ───────────────────────────────────────────────────────
    story.append(clause(9, 'Utilities'))
    story.append(Paragraph(
        'Tenant(s) shall be responsible for all utility services associated with the premises, '
        'including but not limited to electric, gas, and water/trash collection. Tenant(s) agree '
        'to place all applicable utility accounts in their own name(s) within three (3) days of '
        'the lease signing date. Failure to transfer utilities within this timeframe will be '
        'considered a breach of this Agreement.', mk('body')))
    story.append(sp(5))
    story.append(Paragraph(
        'Within the same three (3) day period, Tenant(s) must provide the associated utility '
        'account numbers for each of the following to Jacob Kell at (330) 495-7821 or '
        'jacob@nicecityhomes.com:', mk('body')))
    for line in [
        '\u25cf Electric: AEP Ohio (or applicable provider) — Account Number: ___________________',
        '\u25cf Gas: Dominion Energy / Columbia Gas (or applicable provider) — Account Number: ___________________',
        '\u25cf Water / Trash: Canton City Utilities — Account Number: ___________________',
    ]:
        story.append(Paragraph(line, mk('indent')))
    story.append(sp(5))
    story.append(Paragraph(
        'Tenant(s) acknowledge that Landlord is not responsible for any utility interruptions, '
        'deposits required by utility companies, or service charges resulting from Tenant\'s '
        'failure to establish service in a timely manner.', mk('small')))
    story.append(hr(color=HexColor('#CCCCCC'), t=0.4, sp=6))

    # ── Clause 10: No Subletting ──────────────────────────────────────────────────
    story.append(clause(10, 'Prohibition of Assignment and Subletting'))
    story.append(Paragraph(
        'Tenant(s) will not sublet any part of the premises or assign this Agreement without '
        'the prior written consent of Landlord.', mk('body')))
    for line in [
        'a. Tenant(s) will not sublet or rent any part of the premises for short-term stays of '
        'any duration, including vacation or platform-based rentals (e.g., Airbnb, VRBO).',
        'b. Any unauthorized assignment or subletting shall constitute a material breach of this Agreement.',
    ]:
        story.append(Paragraph(line, mk('indent')))
    story.append(hr(color=HexColor('#CCCCCC'), t=0.4, sp=6))

    # ── Clause 11: Tenant Maintenance ─────────────────────────────────────────────
    story.append(clause(11, "Tenant's Maintenance Responsibilities"))
    story.append(Paragraph(
        'Tenant will: (1) keep the premises clean, sanitary, and in good condition and, upon '
        'termination of the tenancy, return the premises to Landlord in a condition identical '
        'to that which existed when Tenant took occupancy, except for ordinary wear and tear; '
        '(2) immediately notify Landlord of any defects or dangerous conditions in and about '
        'the premises; and (3) reimburse Landlord, on demand, for the cost of any repairs to '
        'the premises damaged by Tenant or Tenant\'s guests through misuse or neglect.', mk('body')))
    story.append(sp(5))
    story.append(Paragraph(
        'Tenant has examined the premises, including appliances, fixtures, carpets, drapes, and '
        'paint, and has found them to be in good, safe, and clean condition and repair, except '
        'as noted in the Landlord-Tenant Move-In Checklist attached hereto.', mk('body')))
    story.append(hr(color=HexColor('#CCCCCC'), t=0.4, sp=6))

    # ── Clause 12: Repairs by Tenant ──────────────────────────────────────────────
    story.append(clause(12, 'Repairs and Alterations by Tenant'))
    for line in [
        'a. Except as provided by law, or as authorized by the prior written consent of Landlord, '
        'Tenant will not make any repairs or alterations to the premises, including nailing holes '
        'in walls or painting the rental unit.',
        'b. Tenant will not, without Landlord\'s prior written consent, alter, rekey, or install '
        'any locks to the premises or install or alter any burglar alarm system. Tenant will '
        'provide Landlord with a key or keys capable of unlocking all such locks and instructions '
        'for any alarm system.',
    ]:
        story.append(Paragraph(line, mk('indent')))
    story.append(hr(color=HexColor('#CCCCCC'), t=0.4, sp=6))

    # ── Clause 13: No Disturbances ────────────────────────────────────────────────
    story.append(clause(13, 'Prohibition of Violating Laws and Causing Disturbances'))
    story.append(Paragraph(
        'Tenant and guests or invitees will not use the premises or adjacent areas in such a '
        'way as to: (1) violate any law or ordinance, including laws prohibiting the use, '
        'possession, or sale of illegal drugs; (2) commit waste (severe property damage); or '
        '(3) create a nuisance by annoying, disturbing, inconveniencing, or interfering with '
        'the quiet enjoyment and peace and quiet of any other tenant or nearby resident.', mk('body')))
    story.append(hr(color=HexColor('#CCCCCC'), t=0.4, sp=6))

    # ── Clause 14: Pets ───────────────────────────────────────────────────────────
    story.append(clause(14, 'Pets'))
    story.append(Paragraph(
        'No animal may be kept on the premises without Landlord\'s prior written consent, except '
        'animals needed by tenants who have a disability as defined by law, and under the '
        'following conditions:', mk('body')))
    story.append(sp(4))
    story.append(field_row('Pet terms/conditions:', pet_terms))
    story.append(hr(color=HexColor('#CCCCCC'), t=0.4, sp=6))

    # ── Clause 15: Landlord Access ────────────────────────────────────────────────
    story.append(clause(15, "Landlord's Right to Access"))
    story.append(Paragraph(
        'Landlord or Landlord\'s agents may enter the premises in the event of an emergency, '
        'to make repairs or improvements, or to show the premises to prospective buyers or '
        'tenants. Landlord may also enter to conduct an annual inspection. Except in cases of '
        'emergency, Tenant\'s abandonment, court order, or where impractical, Landlord shall '
        'give Tenant 24 hours notice before entering.', mk('body')))
    story.append(hr(color=HexColor('#CCCCCC'), t=0.4, sp=6))

    # ── Clause 16: Extended Absences ──────────────────────────────────────────────
    story.append(clause(16, 'Extended Absences by Tenant'))
    story.append(Paragraph(
        'Tenant will notify the Landlord in advance if Tenant will be away from the premises '
        'for 14 or more consecutive days. During such absence, Landlord may enter the premises '
        'at times reasonably necessary to maintain the property and inspect for needed repairs.',
        mk('body')))
    story.append(hr(color=HexColor('#CCCCCC'), t=0.4, sp=6))

    # ── Clause 17: Possession ─────────────────────────────────────────────────────
    story.append(clause(17, 'Possession of the Premises'))
    story.append(Paragraph(
        'a. Tenant\'s failure to take possession. If, after signing this Agreement, Tenant '
        'fails to take possession of the premises, Tenant shall still be responsible for '
        'paying rent and complying with all other terms of this Agreement.', mk('indent')))
    story.append(sp(4))
    story.append(Paragraph(
        'b. Landlord\'s failure to deliver possession. If Landlord is unable to deliver '
        'possession of the premises to Tenant for any reason not within Landlord\'s control, '
        'Tenant\'s only right will be a refund of all payments made. Landlord shall not be '
        'liable to Tenant for damages for failure to deliver possession.', mk('indent')))
    story.append(hr(color=HexColor('#CCCCCC'), t=0.4, sp=6))

    # ── Clause 18: Tenant's Remedies ──────────────────────────────────────────────
    story.append(clause(18, "Tenant's Remedies"))
    story.append(Paragraph(
        'Tenant acknowledges that Tenant has had ample opportunity to inspect the premises '
        'prior to signing this Agreement, and accepts the premises in its current "AS IS" '
        'condition. Tenant\'s exclusive remedy for breach of this Agreement by Landlord shall '
        'be to terminate this Agreement upon proper written notice.', mk('body')))
    story.append(hr(color=HexColor('#CCCCCC'), t=0.4, sp=6))

    # ── Clause 19: Rules and Regulations ──────────────────────────────────────────
    story.append(clause(19, 'Rules and Regulations'))
    story.append(Paragraph(
        'Tenant agrees to abide by any additional rules and regulations established by Landlord '
        'for the use and occupancy of the premises. Tenant acknowledges receipt of such rules '
        'if any are attached to this Agreement as an addendum.', mk('body')))
    story.append(hr(color=HexColor('#CCCCCC'), t=0.4, sp=6))

    # ── Clause 20: Notices ────────────────────────────────────────────────────────
    story.append(clause(20, 'Notices'))
    story.append(Paragraph(
        'All notices and communications between the parties shall be delivered in person, sent '
        'by certified mail, or sent by text/email and confirmed as received. Notices to Landlord '
        'shall be sent to the Landlord address listed in Clause 1. Notices to Tenant shall be '
        'delivered to the premises address listed in Clause 2.', mk('body')))
    story.append(hr(color=HexColor('#CCCCCC'), t=0.4, sp=6))

    # ── Clause 21: Validity ───────────────────────────────────────────────────────
    story.append(clause(21, 'Validity of Each Part'))
    story.append(Paragraph(
        'If any portion of this Agreement is held to be invalid, its invalidity will not affect '
        'the validity or enforceability of any other provision of this Agreement.', mk('body')))
    story.append(hr(color=HexColor('#CCCCCC'), t=0.4, sp=6))

    # ── Clause 22: Entire Agreement ───────────────────────────────────────────────
    story.append(clause(22, 'Entire Agreement'))
    story.append(Paragraph(
        'This Agreement constitutes the entire agreement of the parties, and supersedes all '
        'prior representations, understandings, or agreements. This Agreement may be modified '
        'only by a written amendment signed by both Landlord and Tenant(s).', mk('body')))
    story.append(hr(t=1.5, sp=10))

    # ── Signatures ────────────────────────────────────────────────────────────────
    story.append(Paragraph(
        'IN WITNESS WHEREOF, the parties have executed this Residential Lease Agreement as '
        'of the date last signed below.', mk('body')))
    story.append(sp(16))

    def sig_block(label, name, note=''):
        rows = [
            [Paragraph(label, mk('label')), Paragraph('Date:', mk('label'))],
            [Paragraph('_' * 44, mk('sig')), Paragraph('_' * 22, mk('sig'))],
            [Paragraph(name, mk('label')), Paragraph('', mk('label'))],
        ]
        if note:
            rows.append([Paragraph(note, mk('small')), Paragraph('', mk('small'))])
        t = Table(rows, colWidths=[W * 0.65, W * 0.35])
        t.setStyle(TableStyle([
            ('VALIGN', (0,0), (-1,-1), 'TOP'),
            ('LEFTPADDING', (0,0), (-1,-1), 0),
            ('RIGHTPADDING', (0,0), (-1,-1), 6),
            ('TOPPADDING', (0,0), (-1,-1), 3),
            ('BOTTOMPADDING', (0,0), (-1,-1), 3),
        ]))
        return t

    story.append(Paragraph('<b>Landlord / Authorized Agent:</b>', mk('bold')))
    story.append(sp(6))
    story.append(sig_block('Signature:', nch_sig, f'{landlord}  |  {ll_phone}'))
    story.append(sp(18))

    story.append(Paragraph('<b>Tenant(s):</b>', mk('bold')))
    story.append(sp(6))
    story.append(sig_block('Tenant 1 Signature:', t1_name, t1_email))
    story.append(sp(18))

    if t2_name:
        story.append(sig_block('Tenant 2 Signature:', t2_name, t2_email))
        story.append(sp(18))

    story.append(hr(color=HexColor('#CCCCCC'), t=0.4, sp=8))
    story.append(Paragraph(
        'Nice City Homes, LLC  \u00b7  6521 Beverly Ave NE, Canton OH 44721  \u00b7  '
        '(330) 495-8192  \u00b7  nicecityhomes.app.doorloop.com', mk('small')))

    doc.build(story, onFirstPage=_footer, onLaterPages=_footer)
    return output_path
