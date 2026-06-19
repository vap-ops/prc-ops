// Spec 149 U5 §Tests (TDD, RED first) — pure billing breakdown for a งวด progress
// claim (ADR 0057 decision 8). Given the certified gross + the three rates
// (percent), derive retention (client-withheld 5%), output VAT, WHT-suffered, and
// the net cash receivable. The certify RPC mirrors this; the GL posting balances
// because net + retention + wht == gross + vat. Amounts round to 2dp.

import { describe, it, expect } from "vitest";
import { computeBillingBreakdown } from "@/lib/accounting/client-billing";

function input(over: Partial<Parameters<typeof computeBillingBreakdown>[0]> = {}) {
  return { grossAmount: 100000, retentionRate: 5, vatRate: 7, whtRate: 3, ...over };
}

describe("computeBillingBreakdown", () => {
  it("computes a standard claim (5% retention, 7% VAT, 3% WHT)", () => {
    const r = computeBillingBreakdown(input());
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.retentionAmount).toBe(5000);
      expect(r.value.vatAmount).toBe(7000);
      expect(r.value.whtSuffered).toBe(3000);
      // 100000 + 7000 VAT − 5000 retention − 3000 WHT
      expect(r.value.netReceivable).toBe(99000);
    }
  });

  it("keeps the posting balanced: net + retention + wht == gross + vat", () => {
    const r = computeBillingBreakdown(input({ grossAmount: 123456.78 }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      const dr = r.value.netReceivable + r.value.retentionAmount + r.value.whtSuffered;
      const cr = 123456.78 + r.value.vatAmount;
      expect(Math.round(dr * 100)).toBe(Math.round(cr * 100));
    }
  });

  it("handles zero WHT and zero VAT", () => {
    const r = computeBillingBreakdown(input({ vatRate: 0, whtRate: 0 }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.vatAmount).toBe(0);
      expect(r.value.whtSuffered).toBe(0);
      expect(r.value.netReceivable).toBe(95000); // 100000 − 5000 retention
    }
  });

  it("rejects a zero gross", () => {
    expect(computeBillingBreakdown(input({ grossAmount: 0 })).ok).toBe(false);
  });

  it("rejects a negative gross", () => {
    expect(computeBillingBreakdown(input({ grossAmount: -1 })).ok).toBe(false);
  });

  it("rejects a non-finite gross", () => {
    expect(computeBillingBreakdown(input({ grossAmount: Number.NaN })).ok).toBe(false);
  });

  it("rejects a retention rate outside 0..100", () => {
    expect(computeBillingBreakdown(input({ retentionRate: 150 })).ok).toBe(false);
    expect(computeBillingBreakdown(input({ retentionRate: -1 })).ok).toBe(false);
  });

  it("rejects a VAT or WHT rate outside 0..100", () => {
    expect(computeBillingBreakdown(input({ vatRate: 101 })).ok).toBe(false);
    expect(computeBillingBreakdown(input({ whtRate: -5 })).ok).toBe(false);
  });
});
