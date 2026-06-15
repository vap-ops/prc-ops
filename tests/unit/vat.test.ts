// Spec 119 / ADR 0045 — VAT helpers. The user enters a price and picks a VAT
// mode (inclusive / exclusive / none); the form computes the GROSS to store
// (amount is canonically gross — spend = what you pay) + the rate. The breakdown
// (net / VAT / gross) is derived for display; net + VAT always sum back to gross.

import { describe, expect, it } from "vitest";
import { VAT_RATE, rateForMode, grossFromEntry, deriveVatBreakdown } from "@/lib/purchasing/vat";

describe("rateForMode", () => {
  it("maps the VAT mode to the stored rate", () => {
    expect(rateForMode("none")).toBe(0);
    expect(rateForMode("inclusive")).toBe(VAT_RATE);
    expect(rateForMode("exclusive")).toBe(VAT_RATE);
  });
});

describe("grossFromEntry", () => {
  it("exclusive: the entry is net → gross adds VAT", () => {
    expect(grossFromEntry(100, "exclusive", 7)).toBe(107);
  });
  it("inclusive: the entry already is the gross", () => {
    expect(grossFromEntry(107, "inclusive", 7)).toBe(107);
  });
  it("none: the entry is the gross, rate ignored", () => {
    expect(grossFromEntry(100, "none", 0)).toBe(100);
  });
  it("rounds the computed gross to 2 dp", () => {
    expect(grossFromEntry(33.33, "exclusive", 7)).toBe(35.66);
  });
});

describe("deriveVatBreakdown", () => {
  it("splits a clean gross at 7%", () => {
    expect(deriveVatBreakdown(107, 7)).toEqual({ net: 100, vat: 7, gross: 107 });
  });
  it("rate 0 → all net, no VAT", () => {
    expect(deriveVatBreakdown(100, 0)).toEqual({ net: 100, vat: 0, gross: 100 });
  });
  it("net + VAT always sum back to the gross (rounded)", () => {
    const b = deriveVatBreakdown(100, 7);
    expect(b.gross).toBe(100);
    expect(b.net + b.vat).toBeCloseTo(100, 2);
    expect(b.net).toBe(93.46);
    expect(b.vat).toBe(6.54);
  });
});
