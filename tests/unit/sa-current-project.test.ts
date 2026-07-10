// Spec 292 U2 — the SA current-project resolver SSOT (pure part).
// Precedence: validated ?project= (query) > sa_active_project cookie (override,
// validated against the visible list) > is_primary (primary) > most-recent
// membership (derived; lead-only rows last; code/id tiebreak) > none.
import { describe, expect, it } from "vitest";
import { resolveSaCurrentProject, type SaVisibleProject } from "@/lib/sa/current-project";

const project = (over: Partial<SaVisibleProject> & { id: string }): SaVisibleProject => ({
  code: over.id.toUpperCase(),
  isPrimary: false,
  addedAt: null,
  hasMembership: false,
  ...over,
});

// Three visible projects: A = pinned primary (oldest), B = newest membership,
// C = lead-only (no membership row).
const A = project({
  id: "a",
  code: "PRC-A",
  isPrimary: true,
  hasMembership: true,
  addedAt: "2026-01-01T00:00:00Z",
});
const B = project({
  id: "b",
  code: "PRC-B",
  hasMembership: true,
  addedAt: "2026-06-01T00:00:00Z",
});
const C = project({ id: "c", code: "PRC-C" });
const VISIBLE = [A, B, C];

describe("resolveSaCurrentProject — precedence", () => {
  it("a valid visible ?project= wins over override and primary", () => {
    expect(
      resolveSaCurrentProject({
        visibleProjects: VISIBLE,
        queryProjectId: "b",
        overrideProjectId: "c",
      }),
    ).toEqual({ projectId: "b", source: "query" });
  });

  it("a non-visible ?project= with no override falls through to the primary", () => {
    expect(
      resolveSaCurrentProject({ visibleProjects: VISIBLE, queryProjectId: "not-mine" }),
    ).toEqual({ projectId: "a", source: "primary" });
  });

  it("a non-visible ?project= falls through to the override", () => {
    expect(
      resolveSaCurrentProject({
        visibleProjects: VISIBLE,
        queryProjectId: "not-mine",
        overrideProjectId: "c",
      }),
    ).toEqual({ projectId: "c", source: "override" });
  });

  it("a valid override cookie wins over the primary", () => {
    expect(resolveSaCurrentProject({ visibleProjects: VISIBLE, overrideProjectId: "c" })).toEqual({
      projectId: "c",
      source: "override",
    });
  });

  it("a stale/forged cookie naming a non-visible project falls through to the primary", () => {
    expect(
      resolveSaCurrentProject({
        visibleProjects: VISIBLE,
        overrideProjectId: "11111111-1111-1111-1111-111111111111",
      }),
    ).toEqual({ projectId: "a", source: "primary" });
  });

  it("no query, no override → the pinned primary", () => {
    expect(resolveSaCurrentProject({ visibleProjects: VISIBLE })).toEqual({
      projectId: "a",
      source: "primary",
    });
  });

  it("null/empty override values are ignored, not matched", () => {
    expect(
      resolveSaCurrentProject({
        visibleProjects: VISIBLE,
        overrideProjectId: null,
        queryProjectId: "",
      }),
    ).toEqual({ projectId: "a", source: "primary" });
  });
});

describe("resolveSaCurrentProject — derived fallback (no primary)", () => {
  it("picks the most-recently-added membership", () => {
    const older = project({
      id: "x",
      code: "PRC-X",
      hasMembership: true,
      addedAt: "2026-02-01T00:00:00Z",
    });
    const newer = project({
      id: "y",
      code: "PRC-Y",
      hasMembership: true,
      addedAt: "2026-05-01T00:00:00Z",
    });
    expect(resolveSaCurrentProject({ visibleProjects: [older, newer] })).toEqual({
      projectId: "y",
      source: "derived",
    });
  });

  it("lead-only rows (no membership, null addedAt) sort LAST — any membership beats them", () => {
    const leadOnly = project({ id: "lead", code: "PRC-0AAA" });
    const oldMembership = project({
      id: "m",
      code: "PRC-ZZZ",
      hasMembership: true,
      addedAt: "2025-01-01T00:00:00Z",
    });
    expect(resolveSaCurrentProject({ visibleProjects: [leadOnly, oldMembership] })).toEqual({
      projectId: "m",
      source: "derived",
    });
  });

  it("a membership row with null addedAt sorts after dated memberships but before lead-only", () => {
    const dated = project({
      id: "dated",
      code: "PRC-Z",
      hasMembership: true,
      addedAt: "2025-01-01T00:00:00Z",
    });
    const nullDated = project({ id: "nulldated", code: "PRC-M", hasMembership: true });
    const leadOnly = project({ id: "lead", code: "PRC-A" });
    expect(resolveSaCurrentProject({ visibleProjects: [leadOnly, nullDated, dated] })).toEqual({
      projectId: "dated",
      source: "derived",
    });
    expect(resolveSaCurrentProject({ visibleProjects: [leadOnly, nullDated] })).toEqual({
      projectId: "nulldated",
      source: "derived",
    });
  });

  it("only lead-only rows → derived by code asc", () => {
    const l1 = project({ id: "z-id", code: "PRC-B2" });
    const l2 = project({ id: "a-id", code: "PRC-A1" });
    expect(resolveSaCurrentProject({ visibleProjects: [l1, l2] })).toEqual({
      projectId: "a-id",
      source: "derived",
    });
  });

  it("addedAt tie → code asc breaks it", () => {
    const t = "2026-03-01T00:00:00Z";
    const p1 = project({ id: "1", code: "PRC-B", hasMembership: true, addedAt: t });
    const p2 = project({ id: "2", code: "PRC-A", hasMembership: true, addedAt: t });
    expect(resolveSaCurrentProject({ visibleProjects: [p1, p2] })).toEqual({
      projectId: "2",
      source: "derived",
    });
  });

  it("addedAt + code tie → id asc breaks it (fully deterministic)", () => {
    const t = "2026-03-01T00:00:00Z";
    const p1 = project({ id: "bbb", code: "PRC-S", hasMembership: true, addedAt: t });
    const p2 = project({ id: "aaa", code: "PRC-S", hasMembership: true, addedAt: t });
    expect(resolveSaCurrentProject({ visibleProjects: [p1, p2] })).toEqual({
      projectId: "aaa",
      source: "derived",
    });
  });

  it("the input array is not mutated by the derived sort", () => {
    const l1 = project({ id: "1", code: "PRC-B" });
    const l2 = project({ id: "2", code: "PRC-A" });
    const input = [l1, l2];
    resolveSaCurrentProject({ visibleProjects: input });
    expect(input[0]).toBe(l1);
  });
});

describe("resolveSaCurrentProject — none", () => {
  it("zero visible projects → null/'none'", () => {
    expect(resolveSaCurrentProject({ visibleProjects: [] })).toEqual({
      projectId: null,
      source: "none",
    });
  });

  it("zero visible projects ignores query and override", () => {
    expect(
      resolveSaCurrentProject({
        visibleProjects: [],
        queryProjectId: "a",
        overrideProjectId: "b",
      }),
    ).toEqual({ projectId: null, source: "none" });
  });
});
