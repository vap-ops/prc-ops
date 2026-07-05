// Spec 127 U1 / spec 170 U3 — DC payment reconciliation. Pure: maps a payroll
// report (spec 69) against recorded wage_payments rows so the payroll surface can
// show "จ่ายแล้ว" vs "ค้างจ่าย" per worker for the viewed period. ADR 0062: a DC
// is a worker, so a payment is keyed to (worker × exact period); a CURRENT
// payment is one not superseded and not a tombstone (paid_amount NULL).
// "drifted" mirrors the cost-freeze frozen-vs-live idea (spec 68): the live owed
// has moved away from the amount computed when the payment was recorded. No I/O —
// money is read via the admin client and rendered only on the PM payroll surface
// (requireRole-gated).

import { round2 } from "@/lib/format";
import type { Database } from "@/lib/db/database.types";
import type { WorkerPay, PayrollRange, PayrollReport } from "./payroll";

type PaymentRow = Database["public"]["Tables"]["wage_payments"]["Row"];
type WagePaymentMethod = Database["public"]["Enums"]["wage_payment_method"];

// Money columns present — pinned to the schema Row so a column rename is a type
// error here. Read via the admin client (zero authenticated grant, spec 127).
export type WagePaymentRow = Pick<
  PaymentRow,
  | "id"
  | "worker_id"
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
  method: WagePaymentMethod;
  computedAmount: number;
  drifted: boolean;
}

export interface AnnotatedWorker extends WorkerPay {
  payment: PaymentStatus | null;
}

export interface AnnotatedPayrollReport {
  workers: AnnotatedWorker[];
  totalDays: number;
  totalAmount: number;
  workerCount: number;
  paidCount: number;
  unpaidCount: number;
  paidAmountTotal: number;
  outstandingAmount: number;
}

// Payment methods (mirror the wage_payment_method enum) + Thai labels for the
// record sheet. Pure data — kept here with the domain types.
export const DC_PAYMENT_METHODS = [
  "bank_transfer",
  "cash",
  "cheque",
] as const satisfies readonly WagePaymentMethod[];

export const DC_PAYMENT_METHOD_LABELS: Record<WagePaymentMethod, string> = {
  bank_transfer: "โอนเงิน",
  cash: "เงินสด",
  cheque: "เช็ค",
};

// Current rows only: drop anything pointed at by another row's superseded_by.
// Trivially replicated (not cross-imported) to keep modules decoupled, same as
// payroll.ts currentRows.
function currentPayments(payments: ReadonlyArray<WagePaymentRow>): WagePaymentRow[] {
  const superseded = new Set(
    payments.map((p) => p.superseded_by).filter((id): id is string => id !== null),
  );
  return payments.filter((p) => !superseded.has(p.id));
}

export function annotatePayrollPayments(
  report: PayrollReport,
  payments: ReadonlyArray<WagePaymentRow>,
  range: PayrollRange,
): AnnotatedPayrollReport {
  const current = currentPayments(payments);

  let paidCount = 0;
  let unpaidCount = 0;
  let paidAmountTotal = 0;
  let outstandingAmount = 0;

  const workers: AnnotatedWorker[] = report.workers.map((worker) => {
    // A tombstone (paid_amount NULL) is not a paid row; match the CURRENT
    // payment for this worker × the exact viewed period.
    const match = current.find(
      (p) =>
        p.worker_id === worker.workerId &&
        p.period_from === range.from &&
        p.period_to === range.to &&
        p.paid_amount !== null,
    );

    if (match && match.paid_amount !== null) {
      paidCount += 1;
      paidAmountTotal += match.paid_amount;
      return {
        ...worker,
        payment: {
          paid: true,
          paidAmount: match.paid_amount,
          paidAt: match.paid_at,
          method: match.method,
          computedAmount: match.computed_amount,
          drifted: round2(worker.amount) !== round2(match.computed_amount),
        },
      };
    }

    unpaidCount += 1;
    outstandingAmount += worker.amount;
    return { ...worker, payment: null };
  });

  return {
    workers,
    totalDays: report.totalDays,
    totalAmount: report.totalAmount,
    workerCount: report.workerCount,
    paidCount,
    unpaidCount,
    paidAmountTotal,
    outstandingAmount,
  };
}
