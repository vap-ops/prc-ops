// Writing failing test first.
//
// Spec 369 U1 / ADR 0082 — the gross day-rate derivation, extracted so BOTH the
// /settings/labor-rates editor and the /workers cost-confirm preview show the same
// number the DB's level_gross_rate() will stamp. Previously a file-local helper on
// the labor-rates page; a second copy on /workers would be a second SSOT for money.

import { describe, expect, it } from "vitest";

import { grossRate } from "@/lib/labor/gross-rate";

describe("spec 369 U1 — grossRate", () => {
  it("passes a before_wht rate through untouched", () => {
    expect(grossRate(600, "before_wht", 3)).toBe(600);
  });

  it("grosses an after_wht rate up by the firm percentage", () => {
    // 500 net at 3% WHT → 500 / 0.97 = 515.46 (2dp).
    expect(grossRate(500, "after_wht", 3)).toBe(515.46);
  });

  it("returns null when no rate is entered for the level", () => {
    expect(grossRate(null, "after_wht", 3)).toBeNull();
    expect(grossRate(null, "before_wht", null)).toBeNull();
  });

  it("treats a missing firm percentage as zero", () => {
    expect(grossRate(500, "after_wht", null)).toBe(500);
  });

  it("does not gross up a before_wht rate even when a percentage is set", () => {
    // The basis is what decides; a non-null pct must not leak into before_wht.
    expect(grossRate(650, "before_wht", 15)).toBe(650);
  });
});
