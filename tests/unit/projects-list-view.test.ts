// Writing failing test first.
//
// Feedback 1d648880: archived projects must not show on the projects hub by
// default, plus a status filter + sort. The pure view layer: parse the URL
// params, filter (default hides archived), sort, count per status, and build
// the chip/sort link descriptors. (The page + filter bar wire these.)

import { describe, it, expect } from "vitest";

import {
  parseProjectStatusFilter,
  parseProjectSort,
  viewProjects,
  buildProjectStatusChips,
  buildProjectSortControls,
  type ProjectListItem,
} from "@/lib/projects/list-view";

const P: ProjectListItem[] = [
  { id: "1", code: "B-003", name: "บ้านเอ", status: "active", created_at: "2026-01-03T00:00:00Z" },
  {
    id: "2",
    code: "B-001",
    name: "คอนโดบี",
    status: "completed",
    created_at: "2026-01-01T00:00:00Z",
  },
  {
    id: "3",
    code: "B-002",
    name: "ออฟฟิศซี",
    status: "archived",
    created_at: "2026-01-02T00:00:00Z",
  },
  {
    id: "4",
    code: "B-004",
    name: "อาคารดี",
    status: "on_hold",
    created_at: "2026-01-04T00:00:00Z",
  },
];

const ids = (rows: ReadonlyArray<{ id: string }>) => rows.map((r) => r.id);

describe("parseProjectStatusFilter", () => {
  it("defaults to 'all' for missing/unknown values", () => {
    expect(parseProjectStatusFilter(undefined)).toBe("all");
    expect(parseProjectStatusFilter("nonsense")).toBe("all");
  });
  it("passes through the known statuses", () => {
    for (const s of ["all", "active", "on_hold", "completed", "archived"] as const) {
      expect(parseProjectStatusFilter(s)).toBe(s);
    }
  });
});

describe("parseProjectSort", () => {
  it("defaults to 'code' for missing/unknown values", () => {
    expect(parseProjectSort(undefined)).toBe("code");
    expect(parseProjectSort("nope")).toBe("code");
  });
  it("passes through the known sorts", () => {
    for (const s of ["code", "name", "newest"] as const) expect(parseProjectSort(s)).toBe(s);
  });
});

describe("viewProjects filtering", () => {
  it("hides archived by default ('all' = the non-archived working set)", () => {
    const { rows } = viewProjects(P, { status: "all", sort: "code" });
    expect(ids(rows)).toEqual(["2", "1", "4"]); // B-001, B-003, B-004 — no archived
    expect(rows.every((r) => r.status !== "archived")).toBe(true);
  });
  it("shows ONLY archived when explicitly filtered", () => {
    const { rows } = viewProjects(P, { status: "archived", sort: "code" });
    expect(ids(rows)).toEqual(["3"]);
  });
  it("filters to a single status", () => {
    expect(ids(viewProjects(P, { status: "active", sort: "code" }).rows)).toEqual(["1"]);
    expect(ids(viewProjects(P, { status: "on_hold", sort: "code" }).rows)).toEqual(["4"]);
    expect(ids(viewProjects(P, { status: "completed", sort: "code" }).rows)).toEqual(["2"]);
  });
});

describe("viewProjects counts", () => {
  it("counts each status plus the non-archived total", () => {
    const { counts } = viewProjects(P, { status: "all", sort: "code" });
    expect(counts).toEqual({
      all: 3, // non-archived
      active: 1,
      on_hold: 1,
      completed: 1,
      archived: 1,
    });
  });
});

describe("viewProjects sorting", () => {
  it("sorts by code ascending (default)", () => {
    expect(ids(viewProjects(P, { status: "all", sort: "code" }).rows)).toEqual(["2", "1", "4"]);
  });
  it("sorts by created_at descending for 'newest'", () => {
    expect(ids(viewProjects(P, { status: "all", sort: "newest" }).rows)).toEqual(["4", "1", "2"]);
  });
  it("sorts by name (locale order, non-decreasing)", () => {
    const names = viewProjects(P, { status: "all", sort: "name" }).rows.map((r) => r.name);
    for (let i = 1; i < names.length; i++) {
      expect(names[i - 1]!.localeCompare(names[i]!, "th")).toBeLessThanOrEqual(0);
    }
  });
});

describe("buildProjectStatusChips", () => {
  const { counts } = viewProjects(P, { status: "all", sort: "code" });

  it("emits all five status chips with live counts and the active flag", () => {
    const chips = buildProjectStatusChips({ counts, status: "all", sort: "code" });
    expect(chips.map((c) => c.key)).toEqual(["all", "active", "on_hold", "completed", "archived"]);
    expect(chips.map((c) => c.count)).toEqual([3, 1, 1, 1, 1]);
    expect(chips.find((c) => c.key === "all")!.active).toBe(true);
    expect(chips.find((c) => c.key === "active")!.active).toBe(false);
  });

  it("builds deep-linkable hrefs that omit defaults and preserve the sort", () => {
    const def = buildProjectStatusChips({ counts, status: "all", sort: "code" });
    expect(def.find((c) => c.key === "all")!.href).toBe("/projects");
    expect(def.find((c) => c.key === "archived")!.href).toBe("/projects?status=archived");

    const sorted = buildProjectStatusChips({ counts, status: "active", sort: "newest" });
    expect(sorted.find((c) => c.key === "all")!.href).toBe("/projects?sort=newest");
    expect(sorted.find((c) => c.key === "active")!.href).toBe(
      "/projects?status=active&sort=newest",
    );
    expect(sorted.find((c) => c.key === "active")!.active).toBe(true);
  });
});

describe("buildProjectSortControls", () => {
  it("emits the three sorts with the active flag and default-omitting hrefs", () => {
    const opts = buildProjectSortControls({ status: "all", sort: "code" });
    expect(opts.map((o) => o.key)).toEqual(["code", "name", "newest"]);
    expect(opts.find((o) => o.key === "code")!.active).toBe(true);
    expect(opts.find((o) => o.key === "code")!.href).toBe("/projects");
    expect(opts.find((o) => o.key === "newest")!.href).toBe("/projects?sort=newest");
  });

  it("preserves the current status filter when switching sort", () => {
    const opts = buildProjectSortControls({ status: "active", sort: "code" });
    expect(opts.find((o) => o.key === "code")!.href).toBe("/projects?status=active");
    expect(opts.find((o) => o.key === "name")!.href).toBe("/projects?status=active&sort=name");
  });
});
