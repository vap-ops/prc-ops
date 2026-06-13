// Spec 68 P2 — close-out variance: photo-activity days vs logged labor
// days (both Asia/Bangkok calendar dates). Surfaces when the symmetric
// difference reaches the threshold OR photos exist with zero labor (the
// "we have site activity but nobody logged" signal the Head Tech pilot
// needs). Pure set arithmetic — the page buckets the timestamps.

import { describe, it, expect } from "vitest";
import { LABOR_VARIANCE_MIN_DIFF, computeLaborVariance } from "@/lib/labor/variance";

describe("computeLaborVariance", () => {
  it("threshold is 2 days", () => {
    expect(LABOR_VARIANCE_MIN_DIFF).toBe(2);
  });

  it("does not surface when the two sets match", () => {
    const v = computeLaborVariance(["2026-06-10", "2026-06-11"], ["2026-06-11", "2026-06-10"]);
    expect(v.symmetricDiff).toBe(0);
    expect(v.surfaces).toBe(false);
  });

  it("does not surface at a symmetric difference of 1", () => {
    const v = computeLaborVariance(["2026-06-10", "2026-06-11"], ["2026-06-10"]);
    expect(v.photoOnlyDays).toEqual(["2026-06-11"]);
    expect(v.symmetricDiff).toBe(1);
    expect(v.surfaces).toBe(false);
  });

  it("surfaces at a symmetric difference of 2", () => {
    const v = computeLaborVariance(["2026-06-10", "2026-06-11"], ["2026-06-12"]);
    expect(v.symmetricDiff).toBe(3);
    expect(v.surfaces).toBe(true);
  });

  it("surfaces when photos exist but no labor was logged (even diff of 1)", () => {
    const v = computeLaborVariance(["2026-06-10"], []);
    expect(v.photosWithoutLabor).toBe(true);
    expect(v.symmetricDiff).toBe(1);
    expect(v.surfaces).toBe(true);
  });

  it("does not surface when both sets are empty", () => {
    const v = computeLaborVariance([], []);
    expect(v.photosWithoutLabor).toBe(false);
    expect(v.surfaces).toBe(false);
  });

  it("dedupes repeated days before comparing", () => {
    const v = computeLaborVariance(["2026-06-10", "2026-06-10"], ["2026-06-10"]);
    expect(v.symmetricDiff).toBe(0);
    expect(v.surfaces).toBe(false);
  });

  it("reports labor-only days too", () => {
    const v = computeLaborVariance([], ["2026-06-10", "2026-06-11"]);
    expect(v.laborOnlyDays).toEqual(["2026-06-10", "2026-06-11"]);
    expect(v.photosWithoutLabor).toBe(false);
    expect(v.surfaces).toBe(true); // symmetric diff 2
  });
});
