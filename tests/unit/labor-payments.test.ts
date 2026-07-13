// Spec 127 U1 / spec 170 U3 / spec 266 U4 — wage payment reconciliation.
// annotatePayrollPayments maps a payroll report (spec 69) against recorded
// wage_payments rows: per ช่าง, is there a CURRENT (non-superseded, non-tombstone)
// payment for this exact period? "drifted" = the live owed (worker.gross) has
// moved away from the computed snapshot taken at record time (same frozen-vs-live
// idea as the cost-freeze drift, spec 68). Reconciliation is on GROSS (spec 314
// U4 kept the pre-314 basis). Pure — no I/O.

import { describe, it, expect } from "vitest";
import { annotatePayrollPayments, type WagePaymentRow } from "@/lib/labor/payments";
import type { WorkerPay, PayrollReport, PayrollRange } from "@/lib/labor/payroll";

const RANGE: PayrollRange = { from: "2026-06-01", to: "2026-06-30" };

function worker(over: Partial<WorkerPay> = {}): WorkerPay {
  const gross = over.gross ?? 1900;
  return {
    workerId: "w1",
    name: "ช่าง ก",
    days: 5,
    gross,
    wht: 0,
    net: gross,
    ...over,
  };
}

function report(workers: WorkerPay[]): PayrollReport {
  return {
    workers,
    totalDays: workers.reduce((s, w) => s + w.days, 0),
    totalGross: workers.reduce((s, w) => s + w.gross, 0),
    totalWht: workers.reduce((s, w) => s + w.wht, 0),
    totalNet: workers.reduce((s, w) => s + w.net, 0),
    workerCount: workers.length,
  };
}

function pay(over: Partial<WagePaymentRow> = {}): WagePaymentRow {
  return {
    id: "p1",
    worker_id: "w1",
    period_from: "2026-06-01",
    period_to: "2026-06-30",
    computed_amount: 1900,
    paid_amount: 1900,
    paid_at: "2026-06-30",
    method: "bank_transfer",
    superseded_by: null,
    ...over,
  };
}

describe("annotatePayrollPayments", () => {
  it("marks a worker unpaid when there are no payments", () => {
    const r = annotatePayrollPayments(report([worker()]), [], RANGE);
    expect(r.workers[0]!.payment).toBeNull();
    expect(r.paidCount).toBe(0);
    expect(r.unpaidCount).toBe(1);
    expect(r.outstandingAmount).toBe(1900);
    expect(r.paidAmountTotal).toBe(0);
  });

  it("matches a current payment for the exact period", () => {
    const r = annotatePayrollPayments(report([worker()]), [pay()], RANGE);
    const p = r.workers[0]!.payment;
    expect(p).not.toBeNull();
    expect(p!.paid).toBe(true);
    expect(p!.paidAmount).toBe(1900);
    expect(p!.paidAt).toBe("2026-06-30");
    expect(p!.method).toBe("bank_transfer");
    expect(p!.computedAmount).toBe(1900);
    expect(p!.drifted).toBe(false);
    expect(r.paidCount).toBe(1);
    expect(r.unpaidCount).toBe(0);
    expect(r.outstandingAmount).toBe(0);
    expect(r.paidAmountTotal).toBe(1900);
  });

  it("does NOT match a payment whose period differs (off-by-one)", () => {
    const r = annotatePayrollPayments(
      report([worker()]),
      [pay({ period_to: "2026-06-29" })],
      RANGE,
    );
    expect(r.workers[0]!.payment).toBeNull();
  });

  it("does NOT match a payment for a different worker", () => {
    const r = annotatePayrollPayments(
      report([worker({ workerId: "w1" })]),
      [pay({ worker_id: "w2" })],
      RANGE,
    );
    expect(r.workers[0]!.payment).toBeNull();
  });

  it("ignores a superseded payment (anti-join) and a voiding tombstone leaves the worker unpaid", () => {
    // p1 (the original, matches the period) is superseded by p2, a tombstone
    // (paid_amount null) that voids it → no current paid row → unpaid.
    const original = pay({ id: "p1" });
    const voidRow = pay({ id: "p2", paid_amount: null, superseded_by: "p1" });
    const r = annotatePayrollPayments(report([worker()]), [original, voidRow], RANGE);
    expect(r.workers[0]!.payment).toBeNull();
    expect(r.unpaidCount).toBe(1);
  });

  it("uses the CURRENT (superseding) payment when it carries a corrected amount", () => {
    // p1 superseded by p2 which corrects paid_amount to 1500 → worker is paid 1500.
    const original = pay({ id: "p1", paid_amount: 1900 });
    const corrected = pay({
      id: "p2",
      paid_amount: 1500,
      computed_amount: 1900,
      superseded_by: "p1",
    });
    const r = annotatePayrollPayments(report([worker()]), [original, corrected], RANGE);
    expect(r.workers[0]!.payment!.paidAmount).toBe(1500);
    expect(r.paidAmountTotal).toBe(1500);
  });

  it("flags drift when live owed moved away from the computed snapshot", () => {
    // recorded computed 1900, but a later labor correction pushed live to 2100.
    const r = annotatePayrollPayments(
      report([worker({ gross: 2100 })]),
      [pay({ computed_amount: 1900 })],
      RANGE,
    );
    expect(r.workers[0]!.payment!.drifted).toBe(true);
  });

  it("does not flag drift for sub-cent differences (2-dp compare)", () => {
    const r = annotatePayrollPayments(
      report([worker({ gross: 1900.004 })]),
      [pay({ computed_amount: 1900 })],
      RANGE,
    );
    expect(r.workers[0]!.payment!.drifted).toBe(false);
  });

  it("rolls up counts and outstanding across mixed paid/unpaid workers", () => {
    const r = annotatePayrollPayments(
      report([
        worker({ workerId: "w1", gross: 1900 }),
        worker({ workerId: "w2", name: "ช่าง ข", gross: 800 }),
      ]),
      [pay({ worker_id: "w1", paid_amount: 1900 })],
      RANGE,
    );
    expect(r.paidCount).toBe(1);
    expect(r.unpaidCount).toBe(1);
    expect(r.paidAmountTotal).toBe(1900);
    expect(r.outstandingAmount).toBe(800);
    // passthrough totals from the underlying report are preserved
    expect(r.totalAmount).toBe(2700);
  });
});
