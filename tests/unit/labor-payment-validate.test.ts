// Spec 127 U2 — pure validation for the record-wage-payment form. Thai,
// PM-facing. The server action calls this before the RPC; the RPC re-guards
// (role, recompute, dup) — this is shape/UX validation, not the security gate.
// Spec 266 U4 (ADR 0073): renamed off "DC" — validateWagePayment /
// WAGE_PAYMENT_METHOD(S/_LABELS) as the payroll surface becomes ค่าแรง.

import { describe, it, expect } from "vitest";
import { validateWagePayment } from "@/lib/labor/validate";
import { WAGE_PAYMENT_METHODS, WAGE_PAYMENT_METHOD_LABELS } from "@/lib/labor/payments";

const W = "11111111-1111-4111-8111-111111111111";

function input(over: Partial<Parameters<typeof validateWagePayment>[0]> = {}) {
  return {
    workerId: W,
    from: "2026-06-01",
    to: "2026-06-30",
    paidAt: "2026-06-30",
    paidAmount: 1900,
    method: "bank_transfer",
    reference: "",
    note: "",
    ...over,
  };
}

describe("validateWagePayment", () => {
  it("accepts a well-formed payment", () => {
    expect(validateWagePayment(input())).toBeNull();
  });

  it("rejects a bad worker id", () => {
    expect(validateWagePayment(input({ workerId: "nope" }))).not.toBeNull();
  });

  it("rejects a malformed or inverted period", () => {
    expect(validateWagePayment(input({ from: "2026-13-01" }))).not.toBeNull();
    expect(validateWagePayment(input({ from: "2026-06-30", to: "2026-06-01" }))).not.toBeNull();
  });

  it("rejects a malformed payment date", () => {
    expect(validateWagePayment(input({ paidAt: "2026-02-31" }))).not.toBeNull();
    expect(validateWagePayment(input({ paidAt: "nope" }))).not.toBeNull();
  });

  it("rejects a negative, non-finite, or absurdly large amount", () => {
    expect(validateWagePayment(input({ paidAmount: -1 }))).not.toBeNull();
    expect(validateWagePayment(input({ paidAmount: Number.NaN }))).not.toBeNull();
    expect(validateWagePayment(input({ paidAmount: 1e12 }))).not.toBeNull();
  });

  it("accepts a zero amount (a recorded-but-unpaid / advance-settling entry)", () => {
    expect(validateWagePayment(input({ paidAmount: 0 }))).toBeNull();
  });

  it("rejects an unknown payment method", () => {
    expect(validateWagePayment(input({ method: "crypto" }))).not.toBeNull();
  });

  it("rejects an over-long reference or note", () => {
    expect(validateWagePayment(input({ reference: "x".repeat(121) }))).not.toBeNull();
    expect(validateWagePayment(input({ note: "x".repeat(501) }))).not.toBeNull();
  });
});

describe("wage payment method labels", () => {
  it("has a Thai label for every method", () => {
    for (const m of WAGE_PAYMENT_METHODS) {
      expect(WAGE_PAYMENT_METHOD_LABELS[m]).toBeTruthy();
    }
    expect(WAGE_PAYMENT_METHODS).toContain("bank_transfer");
    expect(WAGE_PAYMENT_METHODS).toContain("cash");
    expect(WAGE_PAYMENT_METHODS).toContain("cheque");
  });
});
