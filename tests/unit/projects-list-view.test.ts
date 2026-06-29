// Writing failing test first.
//
// Feedback 1d648880 set up the hub view layer (hide archived + status filter +
// sort). Feedback 7d9d2c2b (super_admin): "Add filtering by client. Remove all
// sorting — you can default sort, focus on filtering." So the sort control is
// gone (rows always default-sort by code) and a client facet is added alongside
// the status facet. The pure view layer parses the params, filters (status AND
// client), counts per status + per client, and builds the chip descriptors.

import { describe, it, expect } from "vitest";

import {
  parseProjectStatusFilter,
  parseProjectClientFilter,
  parseProjectQuery,
  viewProjects,
  buildProjectStatusChips,
  buildProjectClientChips,
  projectListHref,
  PROJECT_CLIENT_ALL,
  PROJECT_CLIENT_NONE,
  type ProjectListItem,
} from "@/lib/projects/list-view";

const P: ProjectListItem[] = [
  { id: "1", code: "B-003", name: "บ้านเอ", status: "active", client_id: "cli-a" },
  { id: "2", code: "B-001", name: "คอนโดบี", status: "completed", client_id: "cli-b" },
  // cli-c exists ONLY on an archived project — the archived view must still reach it.
  { id: "3", code: "B-002", name: "ออฟฟิศซี", status: "archived", client_id: "cli-c" },
  { id: "4", code: "B-004", name: "อาคารดี", status: "on_hold", client_id: null },
];

// Client display names (loader-provided). Latin keeps the sort assertion crisp.
const CLIENT_NAMES = new Map([
  ["cli-a", "Alpha"],
  ["cli-b", "Beta"],
]);

const ids = (rows: ReadonlyArray<{ id: string }>) => rows.map((r) => r.id);
const ALL = { status: "all", client: PROJECT_CLIENT_ALL } as const;

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

describe("parseProjectClientFilter", () => {
  it("defaults to 'all' for a missing/blank value", () => {
    expect(parseProjectClientFilter(undefined)).toBe(PROJECT_CLIENT_ALL);
    expect(parseProjectClientFilter("   ")).toBe(PROJECT_CLIENT_ALL);
  });
  it("passes a client id (or the 'none' sentinel) through", () => {
    expect(parseProjectClientFilter("cli-a")).toBe("cli-a");
    expect(parseProjectClientFilter(PROJECT_CLIENT_NONE)).toBe(PROJECT_CLIENT_NONE);
  });
});

describe("parseProjectQuery", () => {
  it("defaults to an empty string for a missing/blank value", () => {
    expect(parseProjectQuery(undefined)).toBe("");
    expect(parseProjectQuery("   ")).toBe("");
  });
  it("trims the query", () => {
    expect(parseProjectQuery("  บ้าน ")).toBe("บ้าน");
  });
});

describe("viewProjects — project name/code search (q)", () => {
  it("filters rows by a case-insensitive name substring", () => {
    expect(ids(viewProjects(P, { ...ALL, query: "บ้าน" }).rows)).toEqual(["1"]); // บ้านเอ
  });
  it("filters rows by a case-insensitive code substring", () => {
    expect(ids(viewProjects(P, { ...ALL, query: "b-004" }).rows)).toEqual(["4"]); // อาคารดี / B-004
  });
  it("combines with the status + client filters (AND)", () => {
    // อาคาร matches id4 (อาคารดี), which has no client → none bucket keeps it.
    expect(
      ids(viewProjects(P, { status: "all", client: PROJECT_CLIENT_NONE, query: "อาคาร" }).rows),
    ).toEqual(["4"]);
    // บ้านเอ is cli-a, so the none bucket excludes it even though the text matches.
    expect(
      ids(viewProjects(P, { status: "all", client: PROJECT_CLIENT_NONE, query: "บ้าน" }).rows),
    ).toEqual([]);
  });
  it("does NOT change the status counts or client facet counts (search narrows rows only)", () => {
    const v = viewProjects(P, { ...ALL, query: "บ้าน" });
    expect(v.rows).toHaveLength(1);
    expect(v.counts).toEqual({ all: 3, active: 1, on_hold: 1, completed: 1, archived: 1 });
    expect(v.clientCounts.get("cli-a")).toBe(1); // facet count unaffected by the query
  });
  it("an empty query is a no-op", () => {
    expect(ids(viewProjects(P, { ...ALL, query: "" }).rows)).toEqual(
      ids(viewProjects(P, ALL).rows),
    );
  });
});

describe("projectListHref carries the search query", () => {
  it("appends q after status/client, omitting defaults", () => {
    expect(projectListHref("all", PROJECT_CLIENT_ALL, "baan")).toBe("/projects?q=baan");
    expect(projectListHref("active", "cli-a", "x")).toBe(
      "/projects?status=active&client=cli-a&q=x",
    );
  });
  it("omits q when blank (clean canonical URL)", () => {
    expect(projectListHref("all", PROJECT_CLIENT_ALL, "")).toBe("/projects");
    expect(projectListHref("active", PROJECT_CLIENT_ALL)).toBe("/projects?status=active");
  });
});

describe("chip hrefs preserve an active search query", () => {
  it("status + client chips keep q", () => {
    const { counts, clientCounts } = viewProjects(P, ALL);
    const s = buildProjectStatusChips({
      counts,
      status: "all",
      client: PROJECT_CLIENT_ALL,
      query: "baan",
    });
    expect(s.find((c) => c.key === "archived")!.href).toBe("/projects?status=archived&q=baan");
    const c = buildProjectClientChips({
      clientCounts,
      clientNames: CLIENT_NAMES,
      status: "all",
      client: PROJECT_CLIENT_ALL,
      query: "baan",
    });
    expect(c.find((x) => x.key === "cli-a")!.href).toBe("/projects?client=cli-a&q=baan");
  });
});

describe("viewProjects — status filtering (unchanged)", () => {
  it("hides archived by default ('all' = the non-archived working set)", () => {
    const { rows } = viewProjects(P, ALL);
    expect(ids(rows)).toEqual(["2", "1", "4"]); // B-001, B-003, B-004 — no archived
    expect(rows.every((r) => r.status !== "archived")).toBe(true);
  });
  it("shows ONLY archived when explicitly filtered", () => {
    expect(ids(viewProjects(P, { status: "archived", client: PROJECT_CLIENT_ALL }).rows)).toEqual([
      "3",
    ]);
  });
  it("filters to a single status", () => {
    expect(ids(viewProjects(P, { status: "active", client: PROJECT_CLIENT_ALL }).rows)).toEqual([
      "1",
    ]);
  });
});

describe("viewProjects — client filtering (feedback 7d9d2c2b)", () => {
  it("filters to one client (within the status working set)", () => {
    // cli-a has id1 (active) + id3 (archived); status 'all' hides the archived one
    expect(ids(viewProjects(P, { status: "all", client: "cli-a" }).rows)).toEqual(["1"]);
  });
  it("the 'none' bucket filters to projects with no client", () => {
    expect(ids(viewProjects(P, { status: "all", client: PROJECT_CLIENT_NONE }).rows)).toEqual([
      "4",
    ]);
  });
  it("combines with the status filter (AND)", () => {
    expect(ids(viewProjects(P, { status: "archived", client: "cli-c" }).rows)).toEqual(["3"]);
  });
});

describe("viewProjects — the client facet matches the chosen status view", () => {
  it("counts clients over the SAME status-scoped set the rows come from (archived view)", () => {
    // status=archived: rows = [id3 (cli-c)]. The facet must describe THAT set —
    // an archived-only client (cli-c) gets a chip; the non-archived clients do not.
    const { rows, clientCounts } = viewProjects(P, {
      status: "archived",
      client: PROJECT_CLIENT_ALL,
    });
    expect(ids(rows)).toEqual(["3"]);
    expect([...clientCounts.keys()]).toEqual(["cli-c"]);
    expect(clientCounts.get("cli-c")).toBe(1);
    // the "ทั้งหมด" client chip total equals the archived row count (1), not the
    // non-archived total (counts.all would be 3) — no contradiction with the rows.
    const allChip = buildProjectClientChips({
      clientCounts,
      clientNames: CLIENT_NAMES,
      status: "archived",
      client: PROJECT_CLIENT_ALL,
    }).find((c) => c.key === PROJECT_CLIENT_ALL)!;
    expect(allChip.count).toBe(1);
  });
});

describe("viewProjects — counts", () => {
  it("counts each status plus the non-archived total", () => {
    expect(viewProjects(P, ALL).counts).toEqual({
      all: 3,
      active: 1,
      on_hold: 1,
      completed: 1,
      archived: 1,
    });
  });
  it("counts projects per client over the non-archived working set (archived excluded)", () => {
    const { clientCounts } = viewProjects(P, ALL);
    expect(clientCounts.get("cli-a")).toBe(1); // id3 (archived) is not counted
    expect(clientCounts.get("cli-b")).toBe(1);
    expect(clientCounts.get(PROJECT_CLIENT_NONE)).toBe(1);
  });
});

describe("viewProjects — default sort (sorting control removed)", () => {
  it("always sorts by code ascending", () => {
    expect(ids(viewProjects(P, ALL).rows)).toEqual(["2", "1", "4"]); // B-001, B-003, B-004
  });
});

describe("buildProjectStatusChips", () => {
  const { counts } = viewProjects(P, ALL);

  it("emits all five status chips with live counts and the active flag", () => {
    const chips = buildProjectStatusChips({ counts, status: "all", client: PROJECT_CLIENT_ALL });
    expect(chips.map((c) => c.key)).toEqual(["all", "active", "on_hold", "completed", "archived"]);
    expect(chips.map((c) => c.count)).toEqual([3, 1, 1, 1, 1]);
    expect(chips.find((c) => c.key === "all")!.active).toBe(true);
  });

  it("builds deep-linkable hrefs that omit defaults and preserve the client filter", () => {
    const def = buildProjectStatusChips({ counts, status: "all", client: PROJECT_CLIENT_ALL });
    expect(def.find((c) => c.key === "all")!.href).toBe("/projects");
    expect(def.find((c) => c.key === "archived")!.href).toBe("/projects?status=archived");

    const scoped = buildProjectStatusChips({ counts, status: "active", client: "cli-a" });
    expect(scoped.find((c) => c.key === "all")!.href).toBe("/projects?client=cli-a");
    expect(scoped.find((c) => c.key === "active")!.href).toBe(
      "/projects?status=active&client=cli-a",
    );
  });
});

describe("buildProjectClientChips (feedback 7d9d2c2b)", () => {
  const { clientCounts } = viewProjects(P, ALL);
  const base = {
    clientCounts,
    clientNames: CLIENT_NAMES,
    status: "all" as const,
    client: PROJECT_CLIENT_ALL,
  };

  it("leads with ทั้งหมด, lists clients by name, and ends with the no-client bucket", () => {
    const chips = buildProjectClientChips(base);
    expect(chips.map((c) => c.key)).toEqual(["all", "cli-a", "cli-b", PROJECT_CLIENT_NONE]);
    expect(chips.map((c) => c.label)).toEqual(["ทั้งหมด", "Alpha", "Beta", "ไม่ระบุลูกค้า"]);
    expect(chips.map((c) => c.count)).toEqual([3, 1, 1, 1]);
    expect(chips.find((c) => c.key === "all")!.active).toBe(true);
  });

  it("marks the chosen client active and omits the no-client bucket when none apply", () => {
    const chips = buildProjectClientChips({ ...base, client: "cli-b" });
    expect(chips.find((c) => c.key === "cli-b")!.active).toBe(true);
    expect(chips.find((c) => c.key === "all")!.active).toBe(false);

    const noNull = viewProjects(
      P.filter((p) => p.client_id !== null),
      ALL,
    );
    const chips2 = buildProjectClientChips({ ...base, clientCounts: noNull.clientCounts });
    expect(chips2.some((c) => c.key === PROJECT_CLIENT_NONE)).toBe(false);
  });

  it("builds hrefs that preserve the status filter and omit the default", () => {
    const chips = buildProjectClientChips({ ...base, status: "active" });
    expect(chips.find((c) => c.key === "all")!.href).toBe("/projects?status=active");
    expect(chips.find((c) => c.key === "cli-a")!.href).toBe("/projects?status=active&client=cli-a");
    expect(chips.find((c) => c.key === PROJECT_CLIENT_NONE)!.href).toBe(
      "/projects?status=active&client=none",
    );
  });
});
