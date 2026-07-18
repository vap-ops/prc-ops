// Writing failing test first.
//
// Spec 327 U5 — the equipment period check (pure). PROJECT grain (allocations
// are project-bound; a WP-grain compare has no join — 323 D6): a rental whose
// effective end (allocation ends_on ?? batch ends_on) lands BEFORE the
// project's planned completion flags amber (the gap invites extend/record);
// open-ended (null end) rentals and a null project end never flag.

import { describe, expect, it } from "vitest";

import { flagRentalPeriodGaps, type RentalPeriodRow } from "@/lib/equipment/rental-period-check";

const PROJECT_END = "2026-12-31";

function row(overrides: Partial<RentalPeriodRow>): RentalPeriodRow {
  return { id: "r1", endsOn: "2026-10-01", status: "active", ...overrides };
}

describe("flagRentalPeriodGaps", () => {
  it("flags a rental ending before the project's planned completion", () => {
    const out = flagRentalPeriodGaps([row({})], PROJECT_END);
    expect(out[0]?.gap).toBe(true);
  });

  it("does not flag a rental covering through (or past) project end", () => {
    const out = flagRentalPeriodGaps(
      [row({ endsOn: "2026-12-31" }), row({ id: "r2", endsOn: "2027-01-15" })],
      PROJECT_END,
    );
    expect(out.every((r) => !r.gap)).toBe(true);
  });

  it("open-ended rentals (null ends_on) never flag", () => {
    expect(flagRentalPeriodGaps([row({ endsOn: null })], PROJECT_END)[0]?.gap).toBe(false);
  });

  it("a null project end flags nothing (nothing to compare against)", () => {
    expect(flagRentalPeriodGaps([row({})], null)[0]?.gap).toBe(false);
  });

  it("non-active batches are excluded entirely (cancelled/closed rentals are history)", () => {
    const out = flagRentalPeriodGaps([row({ status: "cancelled" })], PROJECT_END);
    expect(out).toHaveLength(0);
  });
});
