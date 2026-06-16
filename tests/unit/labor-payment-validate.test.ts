// Spec 127 U2 — pure validation for the record-DC-payment form. Thai,
// PM-facing. The server action calls this before the RPC; the RPC re-guards
// (role, recompute, dup) — this is shape/UX validation, not the security gate.

import { describe, it, expect } from "vitest";
import { validateDcPayment } from "@/lib/labor/validate";
import { DC_PAYMENT_METHODS, DC_PAYMENT_METHOD_LABELS } from "@/lib/labor/payments";

const C = "11111111-1111-4111-8111-111111111111";

function input(over: Partial<Parameters<typeof validateDcPayment>[0]> = {}) {
  return {
    contractorId: C,
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

describe("validateDcPayment", () => {
  it("accepts a well-formed payment", () => {
    expect(validateDcPayment(input())).toBeNull();
  });

  it("rejects a bad contractor id", () => {
    expect(validateDcPayment(input({ contractorId: "nope" }))).not.toBeNull();
  });

  it("rejects a malformed or inverted period", () => {
    expect(validateDcPayment(input({ from: "2026-13-01" }))).not.toBeNull();
    expect(validateDcPayment(input({ from: "2026-06-30", to: "2026-06-01" }))).not.toBeNull();
  });

  it("rejects a malformed payment date", () => {
    expect(validateDcPayment(input({ paidAt: "2026-02-31" }))).not.toBeNull();
    expect(validateDcPayment(input({ paidAt: "nope" }))).not.toBeNull();
  });

  it("rejects a negative, non-finite, or absurdly large amount", () => {
    expect(validateDcPayment(input({ paidAmount: -1 }))).not.toBeNull();
    expect(validateDcPayment(input({ paidAmount: Number.NaN }))).not.toBeNull();
    expect(validateDcPayment(input({ paidAmount: 1e12 }))).not.toBeNull();
  });

  it("accepts a zero amount (a recorded-but-unpaid / advance-settling entry)", () => {
    expect(validateDcPayment(input({ paidAmount: 0 }))).toBeNull();
  });

  it("rejects an unknown payment method", () => {
    expect(validateDcPayment(input({ method: "crypto" }))).not.toBeNull();
  });

  it("rejects an over-long reference or note", () => {
    expect(validateDcPayment(input({ reference: "x".repeat(121) }))).not.toBeNull();
    expect(validateDcPayment(input({ note: "x".repeat(501) }))).not.toBeNull();
  });
});

describe("DC payment method labels", () => {
  it("has a Thai label for every method", () => {
    for (const m of DC_PAYMENT_METHODS) {
      expect(DC_PAYMENT_METHOD_LABELS[m]).toBeTruthy();
    }
    expect(DC_PAYMENT_METHODS).toContain("bank_transfer");
    expect(DC_PAYMENT_METHODS).toContain("cash");
    expect(DC_PAYMENT_METHODS).toContain("cheque");
  });
});
