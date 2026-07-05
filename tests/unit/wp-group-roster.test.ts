// Spec 270 U3 — pure grouped-roster view-model. A project that ADOPTED the
// two-level model (any is_group row) renders งาน sections with งานย่อย inside;
// a legacy flat project (no groups) keeps today's flat rendering. Sorting is
// natural-numeric by code so WP-2 < WP-10 regardless of zero-padding.

import { describe, expect, it } from "vitest";
import { buildGroupedRoster } from "@/lib/work-packages/group-roster";

interface Wp {
  id: string;
  code: string;
  isGroup: boolean;
  parentId: string | null;
  status: "not_started" | "in_progress" | "on_hold" | "complete" | "pending_approval" | "rework";
}

function wp(partial: Partial<Wp> & { id: string; code: string }): Wp {
  return {
    isGroup: false,
    parentId: null,
    status: "not_started",
    ...partial,
  };
}

describe("buildGroupedRoster", () => {
  it("legacy project (no groups): adopted=false, leaves pass through in input order", () => {
    const rows = [wp({ id: "a", code: "WP-002" }), wp({ id: "b", code: "WP-001" })];
    const roster = buildGroupedRoster(rows);
    expect(roster.adopted).toBe(false);
    expect(roster.sections).toEqual([]);
    expect(roster.leaves.map((r) => r.id)).toEqual(["a", "b"]);
    expect(roster.ungrouped.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("adopted project: sections sorted by group code, children sorted by code inside", () => {
    const rows = [
      wp({ id: "g2", code: "WP-10", isGroup: true }),
      wp({ id: "g1", code: "WP-02", isGroup: true }),
      wp({ id: "c3", code: "WP-02-10", parentId: "g1" }),
      wp({ id: "c1", code: "WP-02-02", parentId: "g1" }),
      wp({ id: "c2", code: "WP-02-1", parentId: "g1" }),
      wp({ id: "d1", code: "WP-10-01", parentId: "g2" }),
    ];
    const roster = buildGroupedRoster(rows);
    expect(roster.adopted).toBe(true);
    expect(roster.sections.map((s) => s.group.id)).toEqual(["g1", "g2"]);
    // natural-numeric: WP-02-1 < WP-02-02 (=2) < WP-02-10
    expect(roster.sections[0]?.children.map((c) => c.id)).toEqual(["c2", "c1", "c3"]);
    expect(roster.sections[1]?.children.map((c) => c.id)).toEqual(["d1"]);
  });

  it("counts child completion per section (n/m + percent)", () => {
    const rows = [
      wp({ id: "g", code: "WP-01", isGroup: true, status: "in_progress" }),
      wp({ id: "a", code: "WP-01-01", parentId: "g", status: "complete" }),
      wp({ id: "b", code: "WP-01-02", parentId: "g", status: "in_progress" }),
      wp({ id: "c", code: "WP-01-03", parentId: "g", status: "complete" }),
    ];
    const section = buildGroupedRoster(rows).sections[0];
    expect(section?.completeCount).toBe(2);
    expect(section?.totalCount).toBe(3);
    expect(section?.percent).toBe(67);
  });

  it("keeps an empty งาน visible as a 0/0 section", () => {
    const rows = [wp({ id: "g", code: "WP-05", isGroup: true })];
    const roster = buildGroupedRoster(rows);
    expect(roster.sections).toHaveLength(1);
    expect(roster.sections[0]?.totalCount).toBe(0);
    expect(roster.leaves).toEqual([]);
  });

  it("adopted project: parentless / orphaned leaves land in the ungrouped bucket", () => {
    const rows = [
      wp({ id: "g", code: "WP-01", isGroup: true }),
      wp({ id: "in", code: "WP-01-01", parentId: "g" }),
      wp({ id: "loose", code: "WP-099" }),
      wp({ id: "orphan", code: "WP-098", parentId: "gone" }),
    ];
    const roster = buildGroupedRoster(rows);
    expect(roster.ungrouped.map((r) => r.id)).toEqual(["loose", "orphan"]);
    // leaves = every non-group row (the exclusion feed for other lenses)
    expect(roster.leaves.map((r) => r.id).sort()).toEqual(["in", "loose", "orphan"]);
  });
});
