export type RentStatusValue = "paid" | "unpaid" | "late" | "delinquent" | "partial";

export interface RentSummary {
  month: string;
  monthNum: number;
  year: number;
  total_properties: number;
  paid: { count: number; total_collected: number };
  late: { count: number; total_collected: number; late_fees_collected: number };
  unpaid: { count: number; total_outstanding: number; late_fees_outstanding: number };
  delinquent: { count: number; total_outstanding: number; avg_days_overdue: number };
  partial: { count: number; total_collected: number };
  total_collected_mtd: number;
  total_expected: number;
  total_remaining?: number;
  collection_rate: number;
  last_updated_at: string;
  source?: "rentec" | "local" | "ledger";
}

export interface RentRow {
  id: number;
  propertyId: number;
  address: string;
  tenantName: string | null;
  monthlyRent: number;
  month: number;
  year: number;
  status: RentStatusValue;
  amountPaid: number;
  lateFeeDue: number;
  lateFeePaid: number;
  paymentDate: string | null;
  daysOverdue: number;
  notes: string | null;
  updatedAt: string;
}

export interface RentPropertyDetail {
  property: {
    id: number;
    address: string;
    tenantName: string | null;
    monthlyPayment: number | null;
  };
  contact: {
    phone: string | null;
    email: string | null;
    residentName: string | null;
  };
  history: RentRow[];
}

export interface RentMonthOption {
  month: number;
  year: number;
  label: string;
}

export interface RentMonthHistory {
  month: string;
  monthNum: number;
  year: number;
  summary: RentSummary;
  rows: RentRow[];
}

export interface DocPrefillRequest {
  doc_type: "three_day_notice" | "ten_day_notice" | "notice_of_default";
  prefill: Record<string, string | number>;
}
