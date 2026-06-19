// Spec 149 U6 §Tests (TDD, RED first) — pure validation for a WHT certificate
// (ADR 0057 decision 9). Validates direction / tax form / 13-digit tax id / base /
// rate and computes wht_amount = round2(base * rate / 100). The record RPC mirrors
// this; deducted certs post Dr (payable) / Cr WHT-payable.

import { describe, it, expect } from "vitest";
import { validateWhtCertificate } from "@/lib/accounting/wht-certificate";

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
