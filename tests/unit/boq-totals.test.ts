// Writing failing test first.
//
// Spec 237 (ADR 0066 / S10-U2) — the pure BOQ money helpers. A line total is
// qty × (material_rate + labor_rate); the template total is the Σ of its line
// totals. Both round through the format.ts SSOT (round2) — no re-rolled rounding.

import { describe, expect, it } from "vitest";
import { lineTotal, templateTotal } from "@/lib/boq/totals";

describe("lineTotal (spec 237)", () => {
  it("is qty × (material + labor)", () => {
    expect(lineTotal({ qty: 2, materialRate: 100, laborRate: 50 })).toBe(300);
  });

  it("rounds to 2 decimals (kills float noise)", () => {
    // 3 × (10.1 + 0) = 30.299999… → 30.3
    expect(lineTotal({ qty: 3, materialRate: 10.1, laborRate: 0 })).toBe(30.3);
  });

  it("a zero-rate line totals 0", () => {
    expect(lineTotal({ qty: 5, materialRate: 0, laborRate: 0 })).toBe(0);
  });
});

describe("templateTotal (spec 237)", () => {
  it("sums the line totals", () => {
    expect(
      templateTotal([
        { qty: 2, materialRate: 100, laborRate: 50 }, // 300
        { qty: 1, materialRate: 0, laborRate: 25 }, // 25
      ]),
    ).toBe(325);
  });

  it("is 0 for an empty template", () => {
    expect(templateTotal([])).toBe(0);
  });

  it("rounds the sum to 2 decimals", () => {
    expect(
      templateTotal([
        { qty: 3, materialRate: 10.1, laborRate: 0 }, // 30.3
        { qty: 3, materialRate: 0.1, laborRate: 0 }, // 0.3
      ]),
    ).toBe(30.6);
  });
});
