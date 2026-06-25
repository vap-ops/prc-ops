// Spec 149 U6 §Tests (TDD, RED first) — pure validation for a WHT certificate
// (ADR 0057 decision 9). Validates direction / tax form / 13-digit tax id / base /
// rate and computes wht_amount = round2(base * rate / 100). The record RPC mirrors
// this; deducted certs post Dr (payable) / Cr WHT-payable.

import { describe, it, expect } from "vitest";
import { validateWhtCertificate, resolveWhtRate } from "@/lib/accounting/wht-certificate";

function input(over: Partial<Parameters<typeof validateWhtCertificate>[0]> = {}) {
  return {
    direction: "deducted",
    taxForm: "pnd53",
    taxId: "0105556000123",
    baseAmount: 100000,
    whtRate: 3,
    ...over,
  };
}

describe("validateWhtCertificate", () => {
  it("computes WHT at 3% (service)", () => {
    const r = validateWhtCertificate(input());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.whtAmount).toBe(3000);
  });

  it("computes WHT at 5% (rent)", () => {
    const r = validateWhtCertificate(input({ whtRate: 5 }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.whtAmount).toBe(5000);
  });

  it("accepts both directions and all three forms", () => {
    expect(validateWhtCertificate(input({ direction: "suffered" })).ok).toBe(true);
    for (const taxForm of ["pnd3", "pnd53", "pnd1"]) {
      expect(validateWhtCertificate(input({ taxForm })).ok).toBe(true);
    }
  });

  it("rejects a tax id that is not 13 digits", () => {
    expect(validateWhtCertificate(input({ taxId: "12345" })).ok).toBe(false);
    expect(validateWhtCertificate(input({ taxId: "01055560001AB" })).ok).toBe(false);
  });

  it("rejects an unknown direction", () => {
    expect(validateWhtCertificate(input({ direction: "both" })).ok).toBe(false);
  });

  it("rejects an unknown tax form", () => {
    expect(validateWhtCertificate(input({ taxForm: "pnd90" })).ok).toBe(false);
  });

  it("rejects a non-positive base", () => {
    expect(validateWhtCertificate(input({ baseAmount: 0 })).ok).toBe(false);
    expect(validateWhtCertificate(input({ baseAmount: -1 })).ok).toBe(false);
  });

  it("rejects a rate outside 0..100", () => {
    expect(validateWhtCertificate(input({ whtRate: 150 })).ok).toBe(false);
    expect(validateWhtCertificate(input({ whtRate: -1 })).ok).toBe(false);
  });
});

// Spec 206 — resolveWhtRate mirrors the RPC's coalesce(p_wht_rate, default_rate):
// the explicit override wins; otherwise the income type's standard rate; unknown
// type with no override resolves to null (the RPC raises on unknown income_type).
describe("resolveWhtRate", () => {
  const rates = [
    { incomeType: "service", defaultRate: 3 },
    { incomeType: "rent", defaultRate: 5 },
    { incomeType: "transport", defaultRate: 1 },
  ] as const;

  it("uses the income type's default when no override", () => {
    expect(resolveWhtRate("service", null, rates)).toBe(3);
    expect(resolveWhtRate("rent", null, rates)).toBe(5);
    expect(resolveWhtRate("transport", null, rates)).toBe(1);
  });

  it("lets a finite override win over the default", () => {
    expect(resolveWhtRate("service", 7, rates)).toBe(7);
  });

  it("treats a 0 override as a real rate (coalesce, not falsy)", () => {
    expect(resolveWhtRate("service", 0, rates)).toBe(0);
  });

  it("falls back to the default when the override is not finite", () => {
    expect(resolveWhtRate("service", Number.NaN, rates)).toBe(3);
  });

  it("returns null for an unknown income type with no override", () => {
    expect(resolveWhtRate("bonus", null, rates)).toBeNull();
  });

  it("still honours an override for an unknown income type", () => {
    expect(resolveWhtRate("bonus", 10, rates)).toBe(10);
  });
});
