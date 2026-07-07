// Spec 278 U1 — wpWalkFrom(): given a project's leaf work packages, resolve the
// prev/next WP for the "งานถัดไป" walk that lets the SA step through work without
// backing out to the list. Walk set = non-complete leaves + the current WP,
// ordered by code (lens-independent). Pure, unit-testable.

import { describe, it, expect } from "vitest";
import { wpWalkFrom, type LeafWpRow } from "@/lib/work-packages/wp-walk";

const wp = (id: string, code: string, status: LeafWpRow["status"] = "in_progress"): LeafWpRow => ({
  id,
  code,
  status,
});

describe("wpWalkFrom", () => {
  it("returns an empty walk when there are no rows", () => {
    expect(wpWalkFrom([], "x")).toEqual({ prev: null, next: null, index: -1, total: 0 });
  });

  it("orders by code and resolves neighbours around the current WP", () => {
    const walk = wpWalkFrom([wp("c", "WP-03"), wp("a", "WP-01"), wp("b", "WP-02")], "b");
    expect(walk.prev).toEqual({ id: "a", code: "WP-01" });
    expect(walk.next).toEqual({ id: "c", code: "WP-03" });
    expect(walk).toMatchObject({ index: 1, total: 3 });
  });

  it("has no prev at the start and no next at the end", () => {
    const seq = [wp("a", "WP-01"), wp("b", "WP-02")];
    expect(wpWalkFrom(seq, "a").prev).toBeNull();
    expect(wpWalkFrom(seq, "b").next).toBeNull();
  });

  it("excludes complete leaves but keeps the current WP even if complete", () => {
    const walk = wpWalkFrom(
      [
        wp("a", "WP-01"),
        wp("b", "WP-02", "complete"),
        wp("c", "WP-03", "complete"),
        wp("d", "WP-04"),
      ],
      "c", // current is complete → still anchored in the walk
    );
    // sequence = WP-01, WP-03(current), WP-04 (WP-02 complete dropped)
    expect(walk.prev).toEqual({ id: "a", code: "WP-01" });
    expect(walk.next).toEqual({ id: "d", code: "WP-04" });
    expect(walk.total).toBe(3);
    expect(walk.index).toBe(1);
  });

  it("returns no neighbours when the current WP is not in the set", () => {
    const walk = wpWalkFrom([wp("a", "WP-01")], "ghost");
    expect(walk).toMatchObject({ prev: null, next: null, index: -1 });
  });
});
