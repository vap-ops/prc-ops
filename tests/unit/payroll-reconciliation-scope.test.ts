// Writing failing test first.
//
// Spec 311 U5 — payment reconciliation is period-wide, not per-project.
// wage_payments carries no project dimension, so under the spec-309 project
// filter the project-scoped roll-up (worker.amount = one project's days) would
// be reconciled against a project-BLIND payment (the whole period's paid amount)
// — false drift, misattributed "จ่ายแล้ว", and a blocked 2nd-project payment.
// reconcilePayroll suppresses reconciliation when a project filter is active
// (interim, until wage_payments gains a project dimension). The unfiltered view
// keeps the full annotatePayrollPayments behavior.

import { describe, expect, it } from "vitest";
import { reconcilePayroll } from "@/lib/labor/payments";
import type { PayrollRange, PayrollReport } from "@/lib/labor/payroll";
import type { WagePaymentRow } from "@/lib/labor/payments";

const RANGE: PayrollRange = { from: "2026-07-01", to: "2026-07-31" };

const REPORT: PayrollReport = {
  workers: [{ workerId: "w1", name: "สมชาย", days: 5, amount: 5000 }],
  totalDays: 5,
  totalAmount: 5000,
  workerCount: 1,
};

// A period payment whose paid amount spans BOTH projects (12000) — the exact
// mis-reconciliation the project filter would otherwise produce against the
// project-scoped 5000 roll-up.
const PAYMENTS: WagePaymentRow[] = [
  {
    id: "pay1",
    worker_id: "w1",
    period_from: "2026-07-01",
    period_to: "2026-07-31",
    computed_amount: 12000,
    paid_amount: 12000,
    paid_at: "2026-07-31",
    method: "bank_transfer",
    superseded_by: null,
  },
];

describe("reconcilePayroll", () => {
  it("suppresses reconciliation when a project filter is active (scoped view)", () => {
    const r = reconcilePayroll(REPORT, PAYMENTS, RANGE, "proj-a");
    expect(r.scoped).toBe(true);
    // No annotated report leaks the cross-project payment into a project view.
    expect("report" in r).toBe(false);
  });

  it("returns the full annotated report for the all-projects view", () => {
    const r = reconcilePayroll(REPORT, PAYMENTS, RANGE, undefined);
    expect(r.scoped).toBe(false);
    if (r.scoped) throw new Error("unreachable");
    expect(r.report.workers[0]?.payment?.paidAmount).toBe(12000);
    // The 5000 roll-up vs the 12000 payment is a genuine drift IN THE FULL VIEW
    // — this is why we only reconcile there, where the amounts are comparable.
    expect(r.report.workers[0]?.payment?.drifted).toBe(true);
    expect(r.report.paidCount).toBe(1);
  });

  it("ignores the payments in the scoped arm (no read dependency under filter)", () => {
    // Called with [] payments (the page skips the fetch under a filter) — still scoped.
    const r = reconcilePayroll(REPORT, [], RANGE, "proj-a");
    expect(r.scoped).toBe(true);
  });

  it("treats an empty-string projectId as all-projects (reconciles, not suppressed)", () => {
    // No project selected (the ทุกโครงการ option) → the roll-up and the payment
    // share scope, so reconcile. Guards against a caller passing "" instead of
    // undefined (the page normalizes, but the contract is truthiness).
    const r = reconcilePayroll(REPORT, PAYMENTS, RANGE, "");
    expect(r.scoped).toBe(false);
  });
});
