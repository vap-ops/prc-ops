import { describe, expect, it } from "vitest";
import { deriveDeliverableProgress } from "@/lib/deliverables/derive-progress";

// Spec 12 TDD plan. Status derivation: complete iff every WP complete
// (and at least one), not_started iff every WP not_started (or empty,
// degenerate — empty groups never render), in_progress otherwise.

describe("deriveDeliverableProgress", () => {
  it("treats an empty group as not_started 0/0 at 0%", () => {
    expect(deriveDeliverableProgress([])).toEqual({
      status: "not_started",
      completeCount: 0,
      totalCount: 0,
      percent: 0,
    });
  });

  it("is complete at 100% when every WP is complete", () => {
    expect(deriveDeliverableProgress(["complete", "complete", "complete"])).toEqual({
      status: "complete",
      completeCount: 3,
      totalCount: 3,
      percent: 100,
    });
  });

  it("is complete for a single complete WP", () => {
    expect(deriveDeliverableProgress(["complete"])).toEqual({
      status: "complete",
      completeCount: 1,
      totalCount: 1,
      percent: 100,
    });
  });

  it("is not_started at 0% when every WP is not_started", () => {
    expect(deriveDeliverableProgress(["not_started", "not_started"])).toEqual({
      status: "not_started",
      completeCount: 0,
      totalCount: 0 + 2,
      percent: 0,
    });
  });

  it("is in_progress with rounded percent for a mix", () => {
    expect(deriveDeliverableProgress(["complete", "not_started", "in_progress"])).toEqual({
      status: "in_progress",
      completeCount: 1,
      totalCount: 3,
      percent: 33,
    });
  });

  it("counts only complete WPs toward percent", () => {
    expect(deriveDeliverableProgress(["complete", "complete", "pending_approval"])).toEqual({
      status: "in_progress",
      completeCount: 2,
      totalCount: 3,
      percent: 67,
    });
  });

  it("treats on_hold and pending_approval mixes as in_progress", () => {
    expect(deriveDeliverableProgress(["on_hold", "not_started"]).status).toBe("in_progress");
    expect(deriveDeliverableProgress(["pending_approval"]).status).toBe("in_progress");
    expect(deriveDeliverableProgress(["in_progress", "complete"]).status).toBe("in_progress");
  });
});
