import { describe, expect, it } from "vitest";
import {
  groupWorkPackagesByDeliverable,
  type GroupDeliverable,
} from "@/lib/deliverables/group-work-packages";

// Spec 11 TDD plan. The helper is pure: WPs (already ordered by the
// caller) + the project's deliverables → ordered groups, Ungrouped last.

interface TestWp {
  id: string;
  deliverableId: string | null;
  code: string;
}

const D = (id: string, code: string, sortOrder: number, name = `Deliverable ${code}`) =>
  ({ id, code, name, sortOrder }) satisfies GroupDeliverable;

const WP = (id: string, deliverableId: string | null, code = `WP-${id}`): TestWp => ({
  id,
  deliverableId,
  code,
});

describe("groupWorkPackagesByDeliverable", () => {
  it("returns [] for an empty WP list even when deliverables exist", () => {
    expect(groupWorkPackagesByDeliverable([], [D("d1", "D01", 1)])).toEqual([]);
    expect(groupWorkPackagesByDeliverable([], [])).toEqual([]);
  });

  it("puts every WP in one null group when there are no deliverables", () => {
    const wps = [WP("a", null), WP("b", null)];
    const groups = groupWorkPackagesByDeliverable(wps, []);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.deliverable).toBeNull();
    expect(groups[0]?.workPackages.map((w) => w.id)).toEqual(["a", "b"]);
  });

  it("orders groups by sortOrder regardless of input order, tie-broken by code", () => {
    const deliverables = [
      D("d3", "D03", 3),
      D("d1", "D01", 1),
      D("d2b", "D02b", 2),
      D("d2a", "D02a", 2),
    ];
    const wps = [WP("w3", "d3"), WP("w1", "d1"), WP("w2b", "d2b"), WP("w2a", "d2a")];
    const groups = groupWorkPackagesByDeliverable(wps, deliverables);
    expect(groups.map((g) => g.deliverable?.code)).toEqual(["D01", "D02a", "D02b", "D03"]);
  });

  it("preserves WP input order within a group", () => {
    const deliverables = [D("d1", "D01", 1)];
    const wps = [WP("z", "d1", "WP-009"), WP("a", "d1", "WP-001"), WP("m", "d1", "WP-005")];
    const groups = groupWorkPackagesByDeliverable(wps, deliverables);
    expect(groups[0]?.workPackages.map((w) => w.id)).toEqual(["z", "a", "m"]);
  });

  it("omits deliverables that have no WPs", () => {
    const deliverables = [D("d1", "D01", 1), D("d2", "D02", 2)];
    const wps = [WP("a", "d2")];
    const groups = groupWorkPackagesByDeliverable(wps, deliverables);
    expect(groups.map((g) => g.deliverable?.code)).toEqual(["D02"]);
  });

  it("sends null and unknown deliverable ids to a final Ungrouped group", () => {
    const deliverables = [D("d1", "D01", 1)];
    const wps = [WP("linked", "d1"), WP("orphan", "ghost-id"), WP("loose", null)];
    const groups = groupWorkPackagesByDeliverable(wps, deliverables);
    expect(groups).toHaveLength(2);
    expect(groups[0]?.deliverable?.code).toBe("D01");
    expect(groups[1]?.deliverable).toBeNull();
    expect(groups[1]?.workPackages.map((w) => w.id)).toEqual(["orphan", "loose"]);
  });

  it("renders no Ungrouped group when every WP is linked", () => {
    const deliverables = [D("d1", "D01", 1)];
    const wps = [WP("a", "d1"), WP("b", "d1")];
    const groups = groupWorkPackagesByDeliverable(wps, deliverables);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.deliverable).not.toBeNull();
  });

  it("passes extra WP fields through untouched (generic)", () => {
    const deliverables = [D("d1", "D01", 1)];
    const wps = [{ id: "a", deliverableId: "d1", code: "WP-1", status: "complete", extra: 42 }];
    const groups = groupWorkPackagesByDeliverable(wps, deliverables);
    expect(groups[0]?.workPackages[0]).toEqual({
      id: "a",
      deliverableId: "d1",
      code: "WP-1",
      status: "complete",
      extra: 42,
    });
  });
});
