/**
 * Single source of truth for generated document filenames.
 *
 * Spec (per Jacob, May 2026):
 *   - Notices / dated docs: "<Display Name> - <property_address>_<MM-DD-YYYY>.pdf"
 *   - Timeless legal docs:  "<Display Name> - <property_address>.pdf"
 *   - Available Properties: "NCH Available Properties - <Month YYYY>.pdf"
 *   - Estimates / Invoices: "NCH Estimate|Invoice - <jobNumber>_<MM-DD-YYYY>.pdf"
 *
 * Rules:
 *   - Spaces and hyphens are preserved (NOT replaced with underscores).
 *   - Strip only characters that are invalid in filenames: / \ : * ? " < > |
 *   - Date format is MM-DD-YYYY.
 *   - Same filename is used for both the local download AND the Google Drive
 *     filename — callers pass it once.
 */

const FILENAME_INVALID_CHARS = /[/\\:*?"<>|]/g;

export function sanitizeForFilename(s: string): string {
  return s
    .replace(FILENAME_INVALID_CHARS, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Format a Date as MM-DD-YYYY. */
export function fmtMMDDYYYY(d?: Date): string {
  const dt = d ?? new Date();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const day = String(dt.getDate()).padStart(2, "0");
  return `${m}-${day}-${dt.getFullYear()}`;
}

/**
 * Parse a date value from form data and return MM-DD-YYYY.
 * Accepts ISO `YYYY-MM-DD`, US `M/D/YYYY`, or anything Date can parse.
 * Falls back to today if the value is missing or unparseable.
 */
function dateFromInput(val: unknown): string {
  if (val == null || val === "") return fmtMMDDYYYY();
  const s = String(val).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[2]}-${iso[3]}-${iso[1]}`;
  const us = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (us) return `${us[1].padStart(2, "0")}-${us[2].padStart(2, "0")}-${us[3]}`;
  const d = new Date(s);
  if (!isNaN(d.getTime())) return fmtMMDDYYYY(d);
  return fmtMMDDYYYY();
}

/**
 * Per-doc-type display name and whether the filename includes a date.
 *
 * Doc types not listed here are not covered by Jacob's filename spec
 * (e.g. residential_lease, pre_closing_checklist, doorloop_setup_guide).
 * Callers should fall back to the doc's existing `filename_pattern` for
 * those — we don't want to silently rename them to a format he didn't ask
 * for.
 */
const DOC_NAMING: Record<string, { displayName: string; dated: boolean }> = {
  three_day_notice:           { displayName: "3 Day Notice",                dated: true  },
  ten_day_notice:             { displayName: "10 Day Notice",               dated: true  },
  thirty_day_notice:          { displayName: "30 Day Notice",               dated: true  },
  notice_of_default:          { displayName: "Notice of Default",           dated: true  },
  land_contract:              { displayName: "Land Contract",               dated: false },
  land_contract_nch:          { displayName: "Land Contract",               dated: false },
  quit_claim_deed:            { displayName: "Quit Claim Deed",             dated: false },
  occupancy_verification:     { displayName: "Occupancy Verification",      dated: true  },
  letter_of_acknowledgement:  { displayName: "Letter of Acknowledgement",   dated: false },
  hold_harmless:              { displayName: "Hold Harmless",               dated: false },
  cancellation_land_contract: { displayName: "Cancellation Land Contract",  dated: false },
  payment_receipt:            { displayName: "Payment Receipt",             dated: true  },
  work_authorization:         { displayName: "Work Authorization",          dated: true  },
  payment_plan:               { displayName: "Payment Plan",                dated: true  },
};

/**
 * Common date-field IDs across the doc schemas, in priority order.
 * The first one present in the form data is used as the doc date.
 */
const DATE_FIELD_PRIORITY = [
  "notice_date",
  "payment_date",
  "agreement_date",
  "auth_date",
  "letter_date",
  "issue_date",
  "issued_date",
  "doc_date",
  "date",
];

/**
 * Build the filename for a Doc Maker document, or return null if the doc
 * type is not in the spec (caller should fall back to its existing logic).
 */
export function buildDocFilename(
  docType: string,
  data: Record<string, unknown>,
): string | null {
  const naming = DOC_NAMING[docType];
  if (!naming) return null;

  const rawAddr = sanitizeForFilename(String(data["property_address"] ?? ""));
  const propertyAddress = rawAddr || "UNKNOWN";

  if (!naming.dated) {
    return `${naming.displayName} - ${propertyAddress}.pdf`;
  }

  let dateRaw: unknown;
  for (const key of DATE_FIELD_PRIORITY) {
    if (data[key] != null && data[key] !== "") {
      dateRaw = data[key];
      break;
    }
  }
  const dateStr = dateFromInput(dateRaw);
  return `${naming.displayName} - ${propertyAddress}_${dateStr}.pdf`;
}

/**
 * "NCH Available Properties - May 2026.pdf"
 *
 * Pass either a Date (uses its month/year) or a pre-formatted "Month YYYY"
 * string.
 */
export function buildAvailablePropertiesFilename(when?: Date | string): string {
  let monthYear: string;
  if (typeof when === "string") {
    monthYear = sanitizeForFilename(when);
  } else {
    const d = when ?? new Date();
    monthYear = d.toLocaleString("en-US", { month: "long", year: "numeric" });
  }
  return `NCH Available Properties - ${monthYear}.pdf`;
}

/** "NCH Estimate - NCH-2026-001_05-01-2026.pdf" */
export function buildEstimateFilename(jobNumber: string, when?: Date): string {
  return `NCH Estimate - ${sanitizeForFilename(jobNumber)}_${fmtMMDDYYYY(when)}.pdf`;
}

/** "NCH Invoice - NCH-2026-001_05-01-2026.pdf" */
export function buildInvoiceFilename(jobNumber: string, when?: Date): string {
  return `NCH Invoice - ${sanitizeForFilename(jobNumber)}_${fmtMMDDYYYY(when)}.pdf`;
}
