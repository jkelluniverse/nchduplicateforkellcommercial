export interface FieldSchema {
  id: string;
  label: string;
  type: "text" | "textarea" | "date" | "currency" | "number" | "percent" | "dropdown" | "radio" | "repeating_group" | "calculated" | "static";
  required?: boolean;
  placeholder?: string;
  default?: string;
  note?: string;
  options?: string[];
  formula?: string;
  subfields?: FieldSchema[];
}

export interface DocSchema {
  id: string;
  title: string;
  category: string;
  description: string;
  pdf_style: "branded" | "legal" | "static";
  drive_folder: string;
  filename_pattern: string;
  fields: FieldSchema[];
  static_file?: string;
}

export const DOC_SCHEMAS: DocSchema[] = [
  {
    id: "three_day_notice",
    title: "3-Day Notice to Pay or Vacate",
    category: "Notices",
    description: "Ohio notice for past-due amounts",
    pdf_style: "branded",
    drive_folder: "Nice City Homes Expansion/Documents/Notices",
    filename_pattern: "3DayNotice_{tenant_name}_{notice_date}",
    fields: [
      { id: "tenant_name", label: "Tenant Full Name(s)", type: "text", required: true, placeholder: "All adults on the contract" },
      { id: "property_address", label: "Property Address", type: "text", required: true, placeholder: "Full street address" },
      { id: "notice_date", label: "Date of Notice", type: "date", required: true, default: "today" },
      { id: "past_rent_amount", label: "Past Due Rent ($)", type: "currency", required: false, note: "Leave blank if no rent balance" },
      { id: "rent_period", label: "Rent Period", type: "text", required: false, placeholder: "e.g. March & April 2026" },
      { id: "late_fees", label: "Late Fees ($)", type: "currency", required: false, default: "0" },
      { id: "other_fees", label: "Other Fees ($)", type: "currency", required: false, default: "0" },
      { id: "other_fees_detail", label: "Other Fees Description", type: "text", required: false, placeholder: "Describe other charges if any" },
      { id: "payment_instructions", label: "Payment Instructions", type: "text", required: false, default: "Contact Nice City Homes LLC at 330-495-8192 to arrange payment." },
      { id: "landlord_name", label: "Landlord / Agent", type: "text", required: true, default: "Nice City Homes LLC" },
      { id: "landlord_phone", label: "Contact Phone", type: "text", required: true, default: "330-495-8192", placeholder: "e.g. 330-495-8192" },
    ],
  },
  {
    id: "ten_day_notice",
    title: "10-Day Notice — Forfeiture of Land Contract",
    category: "Notices",
    description: "Ohio forfeiture notice per ORC 5313",
    pdf_style: "branded",
    drive_folder: "Nice City Homes Expansion/Documents/Notices",
    filename_pattern: "10DayNotice_{tenant_name}_{notice_date}",
    fields: [
      { id: "tenant_name", label: "Purchaser Full Name(s)", type: "text", required: true },
      { id: "property_address", label: "Property Address", type: "text", required: true },
      { id: "notice_date", label: "Date of Notice", type: "date", required: true, default: "today" },
      { id: "default_amount", label: "Total Amount in Default ($)", type: "currency", required: true },
      {
        id: "default_items", label: "Default Items", type: "repeating_group", required: true,
        note: "List each missed payment or violation",
        subfields: [
          { id: "item_description", label: "Description", type: "text", placeholder: "e.g. January 2026 payment of $850.00" },
          { id: "item_amount", label: "Amount ($)", type: "currency" },
        ],
      },
      { id: "cure_deadline", label: "Cure Deadline", type: "date", required: true, default: "today+10", note: "Auto-set to 10 days from today" },
      { id: "forfeiture_date", label: "Forfeiture Effective Date", type: "date", required: true, default: "today+10" },
      { id: "seller_name", label: "Seller / Agent", type: "text", required: true, default: "Nice City Homes LLC" },
      { id: "seller_phone", label: "Contact Phone", type: "text", required: true, default: "330-495-8192", placeholder: "e.g. 330-495-8192" },
      { id: "seller_signatory", label: "Signed By", type: "text", required: true, placeholder: "Name of person signing" },
    ],
  },
  {
    id: "thirty_day_notice",
    title: "30-Day Notice to Vacate",
    category: "Notices",
    description: "Standard 30-day vacate notice",
    pdf_style: "branded",
    drive_folder: "Nice City Homes Expansion/Documents/Notices",
    filename_pattern: "30DayNotice_{tenant_name}_{notice_date}",
    fields: [
      { id: "tenant_name", label: "Tenant / Purchaser Full Name(s)", type: "text", required: true },
      { id: "property_address", label: "Property Address", type: "text", required: true },
      { id: "notice_date", label: "Date of Notice", type: "date", required: true, default: "today" },
      { id: "vacate_by_date", label: "Vacate By Date", type: "date", required: true, default: "today+30" },
      {
        id: "reason", label: "Reason for Notice", type: "dropdown", required: true,
        options: ["End of contract term", "Non-payment of amounts due", "Lease violation", "Property sold", "Other"],
      },
      { id: "reason_detail", label: "Additional Details", type: "textarea", required: false },
      { id: "landlord_name", label: "Landlord / Agent", type: "text", required: true, default: "Nice City Homes LLC" },
      { id: "landlord_phone", label: "Contact Phone", type: "text", required: true, default: "330-495-8192", placeholder: "e.g. 330-495-8192" },
    ],
  },
  {
    id: "notice_of_default",
    title: "Notice of Default — Land Contract",
    category: "Notices",
    description: "Formal default notice per Ohio land contract terms",
    pdf_style: "branded",
    drive_folder: "Nice City Homes Expansion/Documents/Notices",
    filename_pattern: "NoticeOfDefault_{buyer_name}_{notice_date}",
    fields: [
      { id: "buyer_name", label: "Purchaser Full Name(s)", type: "text", required: true },
      { id: "property_address", label: "Property Address", type: "text", required: true },
      { id: "notice_date", label: "Date of Notice", type: "date", required: true, default: "today" },
      { id: "default_amount", label: "Total Amount in Default ($)", type: "currency", required: true },
      {
        id: "default_items", label: "Default Items", type: "repeating_group", required: true,
        subfields: [
          { id: "item_description", label: "Description", type: "text" },
          { id: "item_amount", label: "Amount ($)", type: "currency" },
        ],
      },
      { id: "cure_period_days", label: "Cure Period (Days)", type: "number", required: true, default: "30" },
      { id: "cure_deadline", label: "Cure Deadline", type: "date", required: true, default: "today+30" },
      { id: "seller_name", label: "Seller Name", type: "text", required: true, default: "Nice City Homes LLC" },
      { id: "seller_phone", label: "Contact Phone", type: "text", required: true, default: "330-495-8192", placeholder: "e.g. 330-495-8192" },
      { id: "seller_signatory", label: "Signed By", type: "text", required: true, placeholder: "Name of person signing" },
    ],
  },
  {
    id: "occupancy_verification",
    title: "Occupancy Verification Letter",
    category: "Tenant / Occupant",
    description: "Confirms occupant status for utilities, ID, or other purposes",
    pdf_style: "legal",
    drive_folder: "Nice City Homes Expansion/Documents/Tenant",
    filename_pattern: "OccupancyVerification_{occupant_name}_{letter_date}",
    fields: [
      { id: "letter_date", label: "Letter Date", type: "date", required: true, default: "today" },
      { id: "occupant_name", label: "Occupant Full Name(s)", type: "text", required: true, placeholder: "e.g. Joy A. Resendiz, Matthew Resendiz" },
      { id: "property_address", label: "Property Address", type: "text", required: true, placeholder: "e.g. 1815 3rd St. SE, Canton, Ohio 44707" },
      { id: "parcel_no", label: "Parcel Number", type: "text", required: true },
      {
        id: "purpose", label: "Purpose of Letter", type: "dropdown", required: true,
        options: ["Utility service establishment", "State ID / Driver license", "Mail forwarding", "Government agency verification", "Other"],
      },
      { id: "purpose_other", label: "Specify Purpose", type: "text", required: false, note: "Complete only if Other selected above" },
      { id: "signatory_name", label: "Signed By", type: "text", required: true, default: "Michael Kell" },
      { id: "signatory_title", label: "Title / Capacity", type: "text", required: true, default: "Property Owner" },
      { id: "signatory_address", label: "Signatory Address", type: "text", required: true, default: "6521 Beverly Ave. NE, Canton, Ohio 44721" },
    ],
  },
  {
    id: "recurring_charge_auth",
    title: "Recurring Charge Authorization",
    category: "Financial",
    description: "Authorizes NCH to charge tenant's bank account or card on a recurring basis",
    pdf_style: "legal",
    drive_folder: "Nice City Homes Expansion/Documents/Financial",
    filename_pattern: "RecurringChargeAuth_{property_address}_{today}",
    fields: [
      { id: "tenant_name", label: "Tenant Full Name", type: "text", required: true, placeholder: "Full legal name as it appears on the lease" },
      { id: "property_address", label: "Property Address", type: "text", required: true, placeholder: "Full street address" },
      { id: "rent_amount", label: "Monthly Rent ($)", type: "currency", required: true, placeholder: "e.g. 1,250.00" },
    ],
  },
  {
    id: "payment_plan",
    title: "Payment Plan Agreement",
    category: "Financial",
    description: "Catch-up payment schedule for tenants/purchasers behind on payments",
    pdf_style: "branded",
    drive_folder: "Nice City Homes Expansion/Documents/Financial",
    filename_pattern: "PaymentPlan_{tenant_name}_{agreement_date}",
    fields: [
      { id: "tenant_name", label: "Tenant / Purchaser Full Name(s)", type: "text", required: true },
      { id: "property_address", label: "Property Address", type: "text", required: true },
      { id: "agreement_date", label: "Date of Agreement", type: "date", required: true, default: "today" },
      { id: "regular_payment", label: "Regular Monthly Payment ($)", type: "currency", required: true, note: "Their normal monthly payment amount — not modified by this plan" },
      { id: "arrears_amount", label: "Total Amount in Arrears ($)", type: "currency", required: true },
      { id: "arrears_description", label: "Description of Amount Owed", type: "textarea", required: true, placeholder: "Describe what makes up the arrears (e.g. February 2026 payment of $1,250.00 was not received...)" },
      {
        id: "plan_payments", label: "Catch-Up Payment Schedule", type: "repeating_group", required: false,
        note: "Add each catch-up installment. Leave empty to print a blank schedule for handwriting.",
        subfields: [
          { id: "due_date", label: "Due Date", type: "text", placeholder: "e.g. May 1, 2026" },
          { id: "amount", label: "Amount ($)", type: "currency" },
          { id: "description", label: "Description / Notes", type: "text", placeholder: "e.g. April 2026 catch-up" },
        ],
      },
      { id: "nch_signatory", label: "NCH Representative", type: "text", required: true, default: "Jacob Kell" },
      { id: "nch_title", label: "NCH Title", type: "text", required: true, default: "Nice City Homes LLC" },
    ],
  },
  {
    id: "payment_receipt",
    title: "Payment Receipt",
    category: "Financial",
    description: "Receipt for any payment received",
    pdf_style: "branded",
    drive_folder: "Nice City Homes Expansion/Documents/Receipts",
    filename_pattern: "Receipt_{received_from}_{payment_date}",
    fields: [
      { id: "receipt_number", label: "Receipt #", type: "text", required: true, note: "Auto-generated — edit if needed" },
      { id: "received_from", label: "Received From", type: "text", required: true },
      { id: "property_address", label: "Property Address", type: "text", required: true },
      { id: "payment_date", label: "Date of Payment", type: "date", required: true, default: "today" },
      { id: "amount_received", label: "Amount Received ($)", type: "currency", required: true },
      {
        id: "payment_for", label: "Payment For", type: "dropdown", required: true,
        options: ["Land contract payment", "Down payment / Deposit", "Late fee", "Repair reimbursement", "Other"],
      },
      { id: "payment_for_detail", label: "Details", type: "text", required: false, placeholder: "e.g. January 2026 payment" },
      {
        id: "payment_method", label: "Payment Method", type: "dropdown", required: true,
        options: ["Cash", "Check", "Zelle", "Money Order", "Other"],
      },
      { id: "check_number", label: "Check Number", type: "text", required: false, note: "Complete only if paid by check" },
      { id: "received_by", label: "Received By", type: "text", required: true, default: "Nice City Homes LLC" },
    ],
  },
  {
    id: "work_authorization",
    title: "Work Authorization Form",
    category: "Contracting",
    description: "Client authorization to proceed with contractor work",
    pdf_style: "branded",
    drive_folder: "Nice City Homes Expansion/Documents/Contracting",
    filename_pattern: "WorkAuth_{client_name}_{property_address}_{auth_date}",
    fields: [
      { id: "job_number", label: "Job Number", type: "text", required: true, placeholder: "NCH-2026-###" },
      { id: "client_name", label: "Client Name", type: "dropdown", required: true, options: ["BSMK", "Coastal Management LLC", "Other"] },
      { id: "client_name_other", label: "Client Name (if Other)", type: "text", required: false },
      { id: "property_address", label: "Property Address", type: "text", required: true },
      { id: "auth_date", label: "Authorization Date", type: "date", required: true, default: "today" },
      { id: "scope_of_work", label: "Scope of Work", type: "textarea", required: true, placeholder: "Describe all work being authorized" },
      { id: "authorized_amount", label: "Authorized Amount ($)", type: "currency", required: true },
      { id: "deposit_amount", label: "Deposit Required ($)", type: "calculated", formula: "authorized_amount * 0.5" },
      { id: "start_date", label: "Estimated Start Date", type: "date", required: false },
      { id: "client_signatory", label: "Authorized By (Client)", type: "text", required: true },
      { id: "nch_signatory", label: "NCH Representative", type: "text", required: true, default: "Jack Kanam" },
    ],
  },
  {
    id: "land_contract",
    title: "Land Contract",
    category: "Legal",
    description: "Ohio land contract / contract for deed — Stark County Recorder compliant",
    pdf_style: "legal",
    drive_folder: "Nice City Homes Expansion/Documents/Land Contracts",
    filename_pattern: "LandContract_{buyer_name}_{property_address}",
    fields: [
      { id: "effective_date", label: "Effective Date", type: "date", required: true, default: "today", note: "Will be written as e.g. 1st day of April, 2026" },
      { id: "seller_name", label: "Seller Full Name or Entity", type: "text", required: true, placeholder: "e.g. Nice City Homes LLC or John Smith" },
      { id: "seller_address", label: "Seller Full Address", type: "text", required: true, placeholder: "e.g. 123 Main St SW, Canton OH 44702" },
      { id: "seller_signatory", label: "Seller Signatory Name", type: "text", required: true, placeholder: "Person who will sign on behalf of seller" },
      { id: "buyer_name", label: "Purchaser Full Name", type: "text", required: true },
      { id: "property_address", label: "Property Address", type: "text", required: true, note: "Also used as purchaser's address in the contract" },
      { id: "parcel_no", label: "Parcel Number", type: "text", required: true, placeholder: "Stark County Auditor parcel ID" },
      { id: "legal_description", label: "Legal Description", type: "textarea", required: true, note: "Copy verbatim from deed or auditor records" },
      { id: "prior_deed_instrument", label: "Prior Deed Instrument #", type: "text", required: false },
      { id: "sale_price", label: "Purchase Price ($)", type: "currency", required: true },
      { id: "down_payment", label: "Down Payment ($)", type: "currency", required: true },
      { id: "financed_amount", label: "Financed Amount ($)", type: "calculated", formula: "sale_price - down_payment", note: "Auto-calculated: Purchase Price minus Down Payment" },
      { id: "interest_rate", label: "Interest Rate (%)", type: "percent", required: true },
      { id: "term_years", label: "Loan Term (Years)", type: "number", required: true, default: "4" },
      { id: "pi_amount", label: "Monthly P&I Payment ($)", type: "currency", required: true, note: "Principal and interest only — use amortization calculator" },
      {
        id: "start_month", label: "First Payment Month", type: "dropdown", required: true,
        options: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
      },
      { id: "start_year", label: "First Payment Year", type: "text", required: true, default: "2026" },
      { id: "balloon_date", label: "Balloon Payment Due Date", type: "date", required: true, note: "Typically 47 months from first payment date" },
      { id: "tax_monthly", label: "Monthly Tax Escrow ($)", type: "currency", required: true, note: "Check Stark County Auditor for current amount" },
      { id: "insurance_monthly", label: "Monthly Insurance Escrow ($)", type: "currency", required: true },
      { id: "monthly_total", label: "Total Monthly Payment ($)", type: "calculated", formula: "pi_amount + tax_monthly + insurance_monthly", note: "Auto-calculated: P&I + Tax + Insurance" },
      { id: "execution_year", label: "Year of Execution", type: "text", required: true, default: "2026" },
    ],
  },
  {
    id: "land_contract_nch",
    title: "Land Contract — NCH as Seller",
    category: "Legal",
    description: "Land contract with Nice City Homes LLC hardcoded as seller — dual member signatories",
    pdf_style: "legal",
    drive_folder: "Nice City Homes Expansion/Documents/Land Contracts",
    filename_pattern: "LandContract_NCH_{buyer_name}_{property_address}",
    fields: [
      { id: "buyer_name", label: "Purchaser Full Name", type: "text", required: true },
      { id: "property_address", label: "Property Address", type: "text", required: true, note: "Also used as purchaser's address in the contract" },
      { id: "parcel_no", label: "Parcel Number", type: "text", required: true, placeholder: "Stark County Auditor parcel ID" },
      { id: "legal_description", label: "Legal Description", type: "textarea", required: true, note: "Copy verbatim from deed or auditor records" },
      { id: "prior_deed_instrument", label: "Prior Deed Instrument #", type: "text", required: false },
      { id: "sale_price", label: "Purchase Price ($)", type: "currency", required: true },
      { id: "down_payment", label: "Down Payment ($)", type: "currency", required: true },
      { id: "financed_amount", label: "Financed Amount ($)", type: "calculated", formula: "sale_price - down_payment", note: "Auto-calculated: Purchase Price minus Down Payment" },
      { id: "interest_rate", label: "Interest Rate (%)", type: "percent", required: true },
      { id: "term_years", label: "Loan Term (Years)", type: "number", required: true, default: "25" },
      { id: "pi_amount", label: "Monthly P&I Payment ($)", type: "currency", required: true, note: "Principal and interest only — use amortization calculator" },
      {
        id: "start_month", label: "First Payment Month", type: "dropdown", required: true,
        options: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
      },
      { id: "start_year", label: "First Payment Year", type: "text", required: true, default: "2026" },
      { id: "balloon_date", label: "Balloon Payment Due Date", type: "text", required: true, placeholder: "e.g. April 1, 2030", note: "Typically 47 months from first payment date" },
      { id: "tax_monthly", label: "Monthly Tax Escrow ($)", type: "currency", required: true, note: "Check Stark County Auditor for current amount" },
      { id: "insurance_monthly", label: "Monthly Insurance Escrow ($)", type: "currency", required: true },
      { id: "monthly_total", label: "Total Monthly Payment ($)", type: "calculated", formula: "pi_amount + tax_monthly + insurance_monthly", note: "Auto-calculated: P&I + Tax + Insurance" },
      { id: "execution_year", label: "Year of Execution", type: "text", required: true, default: "2026" },
      { id: "seller_signatory", label: "Member Signatory 1", type: "text", required: true, default: "Michael T. Kell", placeholder: "First member signing on behalf of NCH" },
      { id: "seller_signatory_2", label: "Member Signatory 2", type: "text", required: true, default: "John M. Kanam", placeholder: "Second member signing on behalf of NCH" },
    ],
  },
  {
    id: "quit_claim_deed",
    title: "Quit Claim Deed",
    category: "Legal",
    description: "Ohio quit claim deed — Stark County Recorder compliant",
    pdf_style: "legal",
    drive_folder: "Nice City Homes Expansion/Documents/Deeds",
    filename_pattern: "QuitClaimDeed_{grantor_name}_{grantee_name}",
    fields: [
      {
        id: "grantor_type", label: "Grantor Type", type: "dropdown", required: true,
        options: ["individual", "company"], default: "individual",
        note: "Choose 'company' for an LLC or other entity, 'individual' for a person",
      },
      { id: "grantor_name", label: "Grantor Full Name (person/entity giving up property)", type: "text", required: true, placeholder: "e.g. John A. Smith or NICE CITY HOMES LLC" },
      { id: "grantor_entity_type", label: "Grantor Entity Type", type: "text", required: false, placeholder: "e.g. an Ohio Limited Liability Company", note: "Required only if grantor type is 'company'" },
      { id: "grantor_signatory", label: "Grantor Signatory", type: "text", required: true, note: "Person who physically signs — same as grantor if individual" },
      { id: "grantor_member_title", label: "Signatory Title", type: "text", required: false, default: "Sole Member", note: "Required only if grantor type is 'company' (e.g. Sole Member, Managing Member)" },
      { id: "grantee_name", label: "Grantee Full Name (person/entity receiving property)", type: "text", required: true },
      { id: "property_address", label: "Property Address", type: "text", required: true, placeholder: "Full street address including city, state, zip" },
      { id: "parcel_no", label: "Parcel ID Number", type: "text", required: true },
      { id: "legal_description", label: "Legal Description", type: "textarea", required: true, note: "Copy verbatim from deed or Stark County Auditor records" },
      { id: "prior_deed_reference", label: "Prior Deed Reference", type: "text", required: false, placeholder: "e.g. 202602090004704", note: "Recorder instrument number from the prior deed" },
      { id: "execution_year", label: "Year of Execution", type: "text", required: true, default: "2026" },
    ],
  },
  {
    id: "letter_of_acknowledgement",
    title: "Letter of Acknowledgement",
    category: "Legal",
    description: "Buyer acknowledges quit claim deed is signed as security against default",
    pdf_style: "legal",
    drive_folder: "Nice City Homes Expansion/Documents/Legal",
    filename_pattern: "LetterOfAcknowledgement_{buyer_name}_{property_address}",
    fields: [
      { id: "buyer_name", label: "Buyer Full Name", type: "text", required: true },
      { id: "property_address", label: "Property Address", type: "text", required: true },
      { id: "seller_name", label: "Seller Name", type: "text", required: true, placeholder: "e.g. Michael Kell or Nice City Homes LLC" },
      { id: "contract_day", label: "Land Contract Day", type: "text", required: true, placeholder: "e.g. 1st" },
      { id: "contract_month", label: "Land Contract Month", type: "text", required: true, placeholder: "e.g. April" },
      { id: "notary_day", label: "Day of Notarization", type: "text", required: false, placeholder: "Leave blank — fill at signing" },
      { id: "notary_month", label: "Month of Notarization", type: "text", required: false, placeholder: "Leave blank — fill at signing" },
      { id: "notary_year", label: "Year of Notarization", type: "text", required: false, placeholder: "Leave blank — fill at signing" },
    ],
  },
  {
    id: "hold_harmless",
    title: "Acknowledgement & Hold Harmless Agreement",
    category: "Legal",
    description: "Buyer acknowledges AS-IS purchase and releases NCH from liability",
    pdf_style: "legal",
    drive_folder: "Nice City Homes Expansion/Documents/Legal",
    filename_pattern: "HoldHarmless_{buyer_name}_{property_address}",
    fields: [
      { id: "property_address", label: "Property Address", type: "text", required: true },
      { id: "buyer_name", label: "Buyer Full Name", type: "text", required: true },
      { id: "sign_date", label: "Date of Signing", type: "date", required: true, default: "today" },
    ],
  },
  {
    id: "cancellation_land_contract",
    title: "Cancellation of Land Installment Contract",
    category: "Legal",
    description: "Cancels and terminates an existing land installment contract",
    pdf_style: "legal",
    drive_folder: "Nice City Homes Expansion/Documents/Legal",
    filename_pattern: "CancellationLandContract_{vendee_name}_{property_address}",
    fields: [
      { id: "execution_day", label: "Day of Execution", type: "text", required: true, placeholder: "e.g. 7th" },
      { id: "execution_month", label: "Month of Execution", type: "text", required: true, placeholder: "e.g. April" },
      { id: "execution_year", label: "Year of Execution", type: "text", required: true, default: "2026" },
      { id: "vendor_name", label: "Vendor (Seller) Name", type: "text", required: true },
      { id: "vendee_name", label: "Vendee (Buyer) Name", type: "text", required: true },
      { id: "vendee_address", label: "Vendee Full Address", type: "text", required: true },
      { id: "contract_date", label: "Original Contract Date", type: "text", required: true, placeholder: "e.g. April 1, 2026" },
      { id: "instrument_no", label: "Recorder Instrument Number", type: "text", required: true },
      { id: "property_description", label: "Property Description", type: "text", required: true },
      { id: "property_address", label: "Property Address", type: "text", required: true },
      { id: "parcel_no", label: "Parcel Number (PPN)", type: "text", required: true },
      { id: "prior_deed", label: "Prior Deed Reference", type: "text", required: false },
      { id: "seller_sig_name", label: "Seller Signature Name", type: "text", required: true },
      { id: "buyer_sig_name", label: "Buyer Signature Name", type: "text", required: true },
      { id: "notary_city", label: "Notary City", type: "text", required: true, default: "Canton" },
    ],
  },
  {
    id: "residential_lease",
    title: "Residential Lease Agreement",
    category: "Rental",
    description: "Full Ohio residential lease agreement with all NCH clauses — ready to print and sign",
    pdf_style: "legal",
    drive_folder: "Nice City Homes Expansion/Documents/Leases",
    filename_pattern: "Lease_{tenant_1_name}_{property_address}",
    fields: [
      { id: "tenant_1_name", label: "Tenant 1 — Full Name", type: "text", required: true },
      { id: "tenant_1_phone", label: "Tenant 1 — Phone", type: "text", required: true, placeholder: "e.g. (330) 555-1234" },
      { id: "tenant_1_email", label: "Tenant 1 — Email", type: "text", required: true, placeholder: "e.g. name@email.com" },
      { id: "tenant_2_name", label: "Tenant 2 — Full Name (if applicable)", type: "text", required: false },
      { id: "tenant_2_phone", label: "Tenant 2 — Phone", type: "text", required: false },
      { id: "tenant_2_email", label: "Tenant 2 — Email", type: "text", required: false },
      { id: "property_address", label: "Property Street Address", type: "text", required: true, placeholder: "e.g. 1708 5th St. SE" },
      { id: "city_state_zip", label: "City, State, Zip", type: "text", required: true, default: "Canton, Ohio 44707" },
      { id: "rental_inclusions", label: "Rental Also Includes", type: "text", required: false, default: "None", placeholder: "e.g. Garage, basement storage" },
      { id: "furnishings_appliances", label: "Furnishings / Appliances", type: "text", required: false, default: "None", placeholder: "e.g. Stove, refrigerator" },
      { id: "lease_start_date", label: "Lease Start Date", type: "date", required: true, default: "today" },
      { id: "lease_end_date", label: "Lease End Date", type: "date", required: true, default: "today+365" },
      { id: "monthly_rent", label: "Monthly Rent ($)", type: "currency", required: true },
      { id: "grace_period_day", label: "Grace Period Through Day #", type: "number", required: true, default: "10", note: "Late fee kicks in after this day of the month" },
      { id: "move_in_date", label: "Move-In Date", type: "date", required: true, default: "today" },
      { id: "prorated_rent", label: "Prorated First Month Rent ($)", type: "currency", required: true, default: "0", note: "Enter 0 if no proration needed" },
      { id: "security_deposit", label: "Security Deposit ($)", type: "currency", required: true },
      { id: "late_fee", label: "Late Fee ($)", type: "currency", required: true, default: "75", note: "Applied automatically after grace period" },
      { id: "pet_terms", label: "Pet Terms / Conditions", type: "text", required: false, default: "No pets permitted without prior written consent of Landlord." },
      { id: "nch_signatory", label: "NCH Signatory", type: "text", required: true, default: "Michael Kell" },
    ],
  },
  {
    id: "pre_closing_checklist",
    title: "Pre-Closing Checklist & Payment Guidelines",
    category: "Closing",
    description: "Required items, payment obligations, and acknowledgment for closing",
    pdf_style: "static",
    drive_folder: "",
    filename_pattern: "NCH_PreClosing_Checklist.pdf",
    fields: [],
    static_file: "NCH_PreClosing_Checklist.pdf",
  },
  {
    id: "doorloop_setup_guide",
    title: "DoorLoop Resident Portal Setup Guide",
    category: "Tenant Resources",
    description: "Step-by-step guide for tenants to activate DoorLoop and set up payments — bilingual (English/Spanish)",
    pdf_style: "static",
    drive_folder: "",
    filename_pattern: "NCH_DoorLoop_Setup_Guide.pdf",
    fields: [],
    static_file: "NCH_DoorLoop_Setup_Guide.pdf",
  },
];

export function getSchema(docType: string): DocSchema | undefined {
  return DOC_SCHEMAS.find((s) => s.id === docType);
}

export function computeCalculated(schema: DocSchema, data: Record<string, string | number>): Record<string, string | number> {
  const result = { ...data };
  for (const field of schema.fields) {
    if (field.type === "calculated" && field.formula) {
      let expr = field.formula;
      for (const [key, val] of Object.entries(result)) {
        const num = parseFloat(String(val)) || 0;
        expr = expr.replace(new RegExp(`\\b${key}\\b`, "g"), String(num));
      }
      try {
        result[field.id] = Function(`"use strict"; return (${expr})`)() as number;
      } catch {
        result[field.id] = 0;
      }
    }
  }
  return result;
}
