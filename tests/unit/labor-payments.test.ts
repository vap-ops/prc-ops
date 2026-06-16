// Spec 127 U1 — DC payment reconciliation. annotatePayrollPayments maps a
// payroll report (spec 69) against recorded dc_payments rows: per contractor
// group, is there a CURRENT (non-superseded, non-tombstone) payment for this
// exact period? "drifted" = the live owed (group.amount) has moved away from
// the computed snapshot taken at record time (same frozen-vs-live idea as the
// cost-freeze drift, spec 68). Pure — no I/O.

import { describe, it, expect } from "vitest";
import { annotatePayrollPayments, round2, type DcPaymentRow } from "@/lib/labor/payments";
import type { ContractorGroup, PayrollReport, PayrollRange } from "@/lib/labor/payroll";

const RANGE: PayrollRange = { from: "2026-06-01", to: "2026-06-30" };

function group(over: Partial<ContractorGroup> = {}): ContractorGroup {
  return {
    contractorId: "c1",
    contractorName: "บริษัท ก",
    workers: [],
    days: 5,
    amount: 1900,
    ...over,
  };
}

function report(contractors: ContractorGroup[]): PayrollReport {
  return {
    contractors,
    totalDays: contractors.reduce((s, g) => s + g.days, 0),
    totalAmount: contractors.reduce((s, g) => s + g.amount, 0),
    workerCount: contractors.reduce((s, g) => s + g.workers.length, 0),
  };
}

function pay(over: Partial<DcPaymentRow> = {}): DcPaymentRow {
  return {
    id: "p1",
    contractor_id: "c1",
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
  it("marks a group unpaid when there are no payments", () => {
    const r = annotatePayrollPayments(report([group()]), [], RANGE);
    expect(r.contractors[0]!.payment).toBeNull();
    expect(r.paidCount).toBe(0);
    expect(r.unpaidCount).toBe(1);
    expect(r.outstandingAmount).toBe(1900);
    expect(r.paidAmountTotal).toBe(0);
  });

  it("matches a current payment for the exact period", () => {
    const r = annotatePayrollPayments(report([group()]), [pay()], RANGE);
    const p = r.contractors[0]!.payment;
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
    const r = annotatePayrollPayments(report([group()]), [pay({ period_to: "2026-06-29" })], RANGE);
    expect(r.contractors[0]!.payment).toBeNull();
  });

  it("does NOT match a payment for a different contractor", () => {
    const r = annotatePayrollPayments(
      report([group({ contractorId: "c1" })]),
      [pay({ contractor_id: "c2" })],
      RANGE,
    );
    expect(r.contractors[0]!.payment).toBeNull();
  });

  it("ignores a superseded payment (anti-join) and a voiding tombstone leaves the group unpaid", () => {
    // p1 (the original, matches the period) is superseded by p2, a tombstone
    // (paid_amount null) that voids it → no current paid row → unpaid.
    const original = pay({ id: "p1" });
    const voidRow = pay({ id: "p2", paid_amount: null, superseded_by: "p1" });
    const r = annotatePayrollPayments(report([group()]), [original, voidRow], RANGE);
    expect(r.contractors[0]!.payment).toBeNull();
    expect(r.unpaidCount).toBe(1);
  });

  it("uses the CURRENT (superseding) payment when it carries a corrected amount", () => {
    // p1 superseded by p2 which corrects paid_amount to 1500 → group is paid 1500.
    const original = pay({ id: "p1", paid_amount: 1900 });
    const corrected = pay({
      id: "p2",
      paid_amount: 1500,
      computed_amount: 1900,
      superseded_by: "p1",
    });
    const r = annotatePayrollPayments(report([group()]), [original, corrected], RANGE);
    expect(r.contractors[0]!.payment!.paidAmount).toBe(1500);
    expect(r.paidAmountTotal).toBe(1500);
  });

  it("flags drift when live owed moved away from the computed snapshot", () => {
    // recorded computed 1900, but a later labor correction pushed live to 2100.
    const r = annotatePayrollPayments(
      report([group({ amount: 2100 })]),
      [pay({ computed_amount: 1900 })],
      RANGE,
    );
    expect(r.contractors[0]!.payment!.drifted).toBe(true);
  });

  it("does not flag drift for sub-cent differences (2-dp compare)", () => {
    const r = annotatePayrollPayments(
      report([group({ amount: 1900.004 })]),
      [pay({ computed_amount: 1900 })],
      RANGE,
    );
    expect(r.contractors[0]!.payment!.drifted).toBe(false);
  });

  it("never marks the unassigned (null-contractor) group as paid", () => {
    const r = annotatePayrollPayments(
      report([group({ contractorId: null, contractorName: "ไม่ระบุผู้รับเหมา" })]),
      [pay({ contractor_id: "c1" })],
      RANGE,
    );
    expect(r.contractors[0]!.payment).toBeNull();
  });

  it("rolls up counts and outstanding across mixed paid/unpaid groups", () => {
    const r = annotatePayrollPayments(
      report([
        group({ contractorId: "c1", amount: 1900 }),
        group({ contractorId: "c2", contractorName: "บริษัท ข", amount: 800 }),
      ]),
      [pay({ contractor_id: "c1", paid_amount: 1900 })],
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

describe("round2", () => {
  it("rounds to 2 decimal places", () => {
    expect(round2(1900.004)).toBe(1900);
    expect(round2(1900.005)).toBe(1900.01);
    expect(round2(1899.995)).toBe(1900);
  });
});
