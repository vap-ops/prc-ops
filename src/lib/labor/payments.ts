// Spec 127 U1 — DC payment reconciliation. Pure: maps a payroll report
// (spec 69) against recorded dc_payments rows so the payroll surface can show
// "จ่ายแล้ว" vs "ค้างจ่าย" per contractor for the viewed period. A payment is
// keyed to (contractor × exact period); a CURRENT payment is one not superseded
// and not a tombstone (paid_amount NULL). "drifted" mirrors the cost-freeze
// frozen-vs-live idea (spec 68): the live owed has moved away from the amount
// computed when the payment was recorded. No I/O — money is read via the admin
// client and rendered only on the PM payroll surface (requireRole-gated).

import type { Database } from "@/lib/db/database.types";
import type { ContractorGroup, PayrollRange, PayrollReport } from "./payroll";

type PaymentRow = Database["public"]["Tables"]["dc_payments"]["Row"];
type DcPaymentMethod = Database["public"]["Enums"]["dc_payment_method"];

// Money columns present — pinned to the schema Row so a column rename is a type
// error here. Read via the admin client (zero authenticated grant, spec 127).
export type DcPaymentRow = Pick<
  PaymentRow,
  | "id"
  | "contractor_id"
  | "period_from"
  | "period_to"
  | "computed_amount"
  | "paid_amount"
  | "paid_at"
  | "method"
  | "superseded_by"
>;

export interface PaymentStatus {
  paid: true;
  paidAmount: number;
  paidAt: string;
  method: DcPaymentMethod;
  computedAmount: number;
  drifted: boolean;
}

export interface AnnotatedGroup extends ContractorGroup {
  payment: PaymentStatus | null;
}

export interface AnnotatedPayrollReport {
  contractors: AnnotatedGroup[];
  totalDays: number;
  totalAmount: number;
  workerCount: number;
  paidCount: number;
  unpaidCount: number;
  paidAmountTotal: number;
  outstandingAmount: number;
}

// Payment methods (mirror the dc_payment_method enum) + Thai labels for the
// record sheet. Pure data — kept here with the domain types.
export const DC_PAYMENT_METHODS = [
  "bank_transfer",
  "cash",
  "cheque",
] as const satisfies readonly DcPaymentMethod[];

export const DC_PAYMENT_METHOD_LABELS: Record<DcPaymentMethod, string> = {
  bank_transfer: "โอนเงิน",
  cash: "เงินสด",
  cheque: "เช็ค",
};

// 2-dp money compare — avoids float noise flagging spurious drift.
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Current rows only: drop anything pointed at by another row's superseded_by.
// Trivially replicated (not cross-imported) to keep modules decoupled, same as
// payroll.ts currentRows.
function currentPayments(payments: ReadonlyArray<DcPaymentRow>): DcPaymentRow[] {
  const superseded = new Set(
    payments.map((p) => p.superseded_by).filter((id): id is string => id !== null),
  );
  return payments.filter((p) => !superseded.has(p.id));
}

export function annotatePayrollPayments(
  report: PayrollReport,
  payments: ReadonlyArray<DcPaymentRow>,
  range: PayrollRange,
): AnnotatedPayrollReport {
  const current = currentPayments(payments);

  let paidCount = 0;
  let unpaidCount = 0;
  let paidAmountTotal = 0;
  let outstandingAmount = 0;

  const contractors: AnnotatedGroup[] = report.contractors.map((group) => {
    // The unassigned group has a null contractorId and can never be keyed to a
    // payment (contractor_id is NOT NULL); a tombstone (paid_amount NULL) is not
    // a paid row.
    const match =
      group.contractorId === null
        ? undefined
        : current.find(
            (p) =>
              p.contractor_id === group.contractorId &&
              p.period_from === range.from &&
              p.period_to === range.to &&
              p.paid_amount !== null,
          );

    if (match && match.paid_amount !== null) {
      paidCount += 1;
      paidAmountTotal += match.paid_amount;
      return {
        ...group,
        payment: {
          paid: true,
          paidAmount: match.paid_amount,
          paidAt: match.paid_at,
          method: match.method,
          computedAmount: match.computed_amount,
          drifted: round2(group.amount) !== round2(match.computed_amount),
        },
      };
    }

    unpaidCount += 1;
    outstandingAmount += group.amount;
    return { ...group, payment: null };
  });

  return {
    contractors,
    totalDays: report.totalDays,
    totalAmount: report.totalAmount,
    workerCount: report.workerCount,
    paidCount,
    unpaidCount,
    paidAmountTotal,
    outstandingAmount,
  };
}
