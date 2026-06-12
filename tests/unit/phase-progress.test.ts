// Unit tests for the phase-progress derivation behind the spec 54
// progress bar, plus the new HH:MM formatter.

import { describe, it, expect } from "vitest";

import { derivePhaseProgress } from "@/lib/photos/phase-progress";
import { formatThaiTime } from "@/lib/i18n/labels";

describe("derivePhaseProgress", () => {
  it("no photos at all → 0 of 3, current is 'before', all segments empty", () => {
    const p = derivePhaseProgress({ before: 0, during: 0, after: 0 });
    expect(p.doneCount).toBe(0);
    expect(p.currentPhase).toBe("before");
    expect(p.segments).toEqual(["empty", "empty", "empty"]);
  });

  it("before only → 1 of 3, current 'before' (the last phase with photos)", () => {
    const p = derivePhaseProgress({ before: 6, during: 0, after: 0 });
    expect(p.doneCount).toBe(1);
    expect(p.currentPhase).toBe("before");
    expect(p.segments).toEqual(["current", "empty", "empty"]);
  });

  it("mockup case: before + during → 2 of 3, current 'during', green/blue/empty", () => {
    const p = derivePhaseProgress({ before: 6, during: 2, after: 0 });
    expect(p.doneCount).toBe(2);
    expect(p.currentPhase).toBe("during");
    expect(p.segments).toEqual(["complete", "current", "empty"]);
  });

  it("gap case: before + after without during — skipped phase stays empty", () => {
    const p = derivePhaseProgress({ before: 3, during: 0, after: 1 });
    expect(p.doneCount).toBe(2);
    expect(p.currentPhase).toBe("after");
    expect(p.segments).toEqual(["complete", "empty", "current"]);
  });

  it("all phases → 3 of 3, current 'after'", () => {
    const p = derivePhaseProgress({ before: 1, during: 1, after: 1 });
    expect(p.doneCount).toBe(3);
    expect(p.currentPhase).toBe("after");
    expect(p.segments).toEqual(["complete", "complete", "current"]);
  });
});

describe("formatThaiTime", () => {
  it("renders HH:MM pinned to Asia/Bangkok (UTC+7)", () => {
    // 02:42 UTC = 09:42 Bangkok — the mockup's อัปเดตล่าสุด 09:42.
    expect(formatThaiTime("2026-06-12T02:42:00Z")).toBe("09:42");
  });

  it("degrades to the raw string on invalid input (formatter doctrine)", () => {
    expect(formatThaiTime("not-a-date")).toBe("not-a-date");
  });
});
