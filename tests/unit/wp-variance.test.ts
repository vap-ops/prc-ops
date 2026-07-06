// Writing failing test first.
//
// Spec 271 U2a — variance classification (§3 ordered decision table, first
// match wins) + the per-งาน rollup pill. Pure lib; the roster loader feeds it.
// The TS class list must mirror the DB variance_class enum 1:1 (U1 pin).

import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/db/database.types";
import {
  COVERAGE_RED_FLOOR,
  VARIANCE_CLASSES,
  classifyLeaf,
  groupVariancePill,
  type VarianceClass,
  type VarianceLeafInput,
} from "@/lib/work-packages/variance";
import { VARIANCE_CLASS_LABEL } from "@/lib/i18n/labels";

const TODAY = "2026-07-10";

const base: VarianceLeafInput = {
  plannedStart: "2026-07-05",
  plannedEnd: "2026-07-08",
  status: "not_started",
  actualStart: null,
  actualEnd: null,
  hasEvidence: false,
};

describe("classifyLeaf — §3 ordered table", () => {
  it("1: either planned date NULL → unplanned (even with evidence)", () => {
    expect(
      classifyLeaf(
        { ...base, plannedEnd: null, hasEvidence: true, actualStart: "2026-07-06" },
        TODAY,
      ).class,
    ).toBe("unplanned");
  });

  it("2: no evidence at all ∧ not complete → no_evidence (neutral, beats lateness)", () => {
    // planned_end already passed — still grey, never red off missing data.
    expect(classifyLeaf(base, TODAY).class).toBe("no_evidence");
  });

  it("3: completed with an anchor → completed + signed slip", () => {
    const late = classifyLeaf(
      { ...base, status: "complete", hasEvidence: true, actualEnd: "2026-07-11" },
      TODAY,
    );
    expect(late.class).toBe("completed");
    expect(late.slipDays).toBe(3); // 11 vs planned 08
    const early = classifyLeaf(
      { ...base, status: "complete", hasEvidence: true, actualEnd: "2026-07-06" },
      TODAY,
    );
    expect(early.slipDays).toBe(-2);
  });

  it("4: complete without a reconstructable anchor → completed_undated, no slip", () => {
    const v = classifyLeaf({ ...base, status: "complete", hasEvidence: true }, TODAY);
    expect(v.class).toBe("completed_undated");
    expect(v.slipDays).toBeNull();
  });

  it("5: not started ∧ today past planned_end → never_started_past_end", () => {
    expect(classifyLeaf({ ...base, hasEvidence: true }, TODAY).class).toBe(
      "never_started_past_end",
    );
  });

  it("6: not started ∧ today past planned_start only → late_start", () => {
    expect(
      classifyLeaf({ ...base, plannedEnd: "2026-07-20", hasEvidence: true }, TODAY).class,
    ).toBe("late_start");
  });

  it("7: started ∧ today past planned_end → late with overrun days", () => {
    const v = classifyLeaf(
      {
        ...base,
        status: "in_progress",
        hasEvidence: true,
        actualStart: "2026-07-05",
      },
      TODAY,
    );
    expect(v.class).toBe("late");
    expect(v.slipDays).toBe(2); // today 10 vs planned_end 08
  });

  it("8: in_progress near the end → at_risk (min(7d, half-duration) window)", () => {
    // planned 2026-07-05 → 2026-07-20 (16 days) → window = min(7, 8) = 7 → at_risk from 07-13.
    const risky = classifyLeaf(
      {
        ...base,
        plannedEnd: "2026-07-20",
        status: "in_progress",
        hasEvidence: true,
        actualStart: "2026-07-06",
      },
      "2026-07-13",
    );
    expect(risky.class).toBe("at_risk");
    // Short 3-day leaf: window = min(7, ceil(3/2)=2) → not at-risk 3 days out.
    const shortLeaf = classifyLeaf(
      {
        ...base,
        plannedStart: "2026-07-10",
        plannedEnd: "2026-07-12",
        status: "in_progress",
        hasEvidence: true,
        actualStart: "2026-07-10",
      },
      "2026-07-09",
    );
    expect(shortLeaf.class).toBe("on_track");
  });

  it("9: else → on_track", () => {
    expect(
      classifyLeaf(
        {
          ...base,
          plannedEnd: "2026-07-30",
          status: "in_progress",
          hasEvidence: true,
          actualStart: "2026-07-06",
        },
        TODAY,
      ).class,
    ).toBe("on_track");
  });

  it("rework rounds stay out of schedule slip: a complete leaf never re-enters LATE (D7)", () => {
    const v = classifyLeaf(
      { ...base, status: "complete", hasEvidence: true, actualEnd: "2026-07-07" },
      "2026-08-01",
    );
    expect(v.class).toBe("completed");
  });
});

describe("groupVariancePill", () => {
  const leaf = (over: Partial<VarianceLeafInput>): VarianceLeafInput => ({ ...base, ...over });

  it("counts classes and surfaces the worst (never_started_past_end ranks above late)", () => {
    const pill = groupVariancePill(
      [
        leaf({ hasEvidence: true }), // never_started_past_end
        leaf({ status: "in_progress", hasEvidence: true, actualStart: "2026-07-05" }), // late
        leaf({
          plannedEnd: "2026-07-30",
          status: "in_progress",
          hasEvidence: true,
          actualStart: "2026-07-06",
        }), // on_track
      ],
      TODAY,
    );
    expect(pill.worst).toBe("never_started_past_end");
    expect(pill.counts.never_started_past_end).toBe(1);
    expect(pill.counts.late).toBe(1);
    expect(pill.counts.on_track).toBe(1);
  });

  it("coverage-aware: red suppressed below the floor → lowCoverage pill", () => {
    // 4 leaves past planned_start, only 1 evidenced → 25% < floor.
    const pill = groupVariancePill(
      [leaf({ hasEvidence: true }), leaf({}), leaf({}), leaf({})],
      TODAY,
    );
    expect(pill.coveragePct).toBe(25);
    expect(pill.lowCoverage).toBe(true);
    expect(COVERAGE_RED_FLOOR).toBeGreaterThan(0.25);
  });

  it("all-complete group → worst is completed, not a red class", () => {
    const pill = groupVariancePill(
      [
        leaf({ status: "complete", hasEvidence: true, actualEnd: "2026-07-07" }),
        leaf({ status: "complete", hasEvidence: true }),
      ],
      TODAY,
    );
    expect(pill.worst).toBe("completed");
    expect(pill.lowCoverage).toBe(false);
  });

  it("leaves before planned_start don't drag coverage down", () => {
    const pill = groupVariancePill(
      [
        leaf({ plannedStart: "2026-08-01", plannedEnd: "2026-08-05" }), // future — not in denominator
        leaf({ hasEvidence: true }),
      ],
      TODAY,
    );
    expect(pill.coveragePct).toBe(100);
  });
});

describe("enum ↔ TS ↔ label SSOT pins", () => {
  it("VARIANCE_CLASSES mirrors the DB enum exactly", () => {
    type DbClass = Database["public"]["Enums"]["variance_class"];
    // Compile-time both directions:
    const _toDb: DbClass[] = [...VARIANCE_CLASSES];
    const _fromDb: readonly VarianceClass[] = [] as DbClass[];
    void _toDb;
    void _fromDb;
    expect([...VARIANCE_CLASSES].sort()).toEqual(
      (
        [
          "unplanned",
          "no_evidence",
          "completed",
          "completed_undated",
          "never_started_past_end",
          "late_start",
          "late",
          "at_risk",
          "on_track",
        ] as const
      )
        .slice()
        .sort(),
    );
  });

  it("every class has a Thai label in the SSOT", () => {
    for (const c of VARIANCE_CLASSES) {
      expect(VARIANCE_CLASS_LABEL[c]).toBeTruthy();
    }
  });
});
