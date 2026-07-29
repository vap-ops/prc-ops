// Spec 192 U4 — the site-admin daily home's "งานของฉัน" list. Pure builder: the
// SA's visible, not-done work packages joined to their project name, sorted by
// project then WP code (a stable field order). The page does the RLS-scoped read;
// this is the view-model assembly, unit-testable without Supabase.
//
// Spec 277 P0 — each item also carries its reconciled GLOBAL work-category code
// (project_category id → W0x) so the card can render the category letter·color·icon.

import { describe, it, expect } from "vitest";
import { buildMyWorkList, type MyWorkWp } from "@/lib/sa/my-work";

const PROJECTS = new Map([
  ["p1", { code: "PRJ-001", name: "อาคารสำนักงาน" }],
  ["p2", { code: "PRJ-002", name: "บ้านพักอาศัย" }],
]);

function wp(p: Partial<MyWorkWp> & Pick<MyWorkWp, "id" | "code" | "project_id">): MyWorkWp {
  return {
    name: "งาน",
    status: "in_progress",
    category_id: null,
    updated_at: "2026-01-01T00:00:00.000Z",
    ...p,
  };
}

describe("buildMyWorkList", () => {
  it("returns an empty list for no work packages", () => {
    expect(buildMyWorkList([], PROJECTS)).toEqual([]);
  });

  it("joins each WP to its project and sorts by project code then WP code", () => {
    const result = buildMyWorkList(
      [
        wp({ id: "b", code: "WP-02", project_id: "p2" }),
        wp({ id: "a", code: "WP-02", project_id: "p1" }),
        wp({ id: "c", code: "WP-01", project_id: "p1" }),
      ],
      PROJECTS,
    );
    expect(result.map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(result[0]).toMatchObject({
      id: "c",
      code: "WP-01",
      projectId: "p1",
      projectCode: "PRJ-001",
      projectName: "อาคารสำนักงาน",
      categoryCode: null,
    });
  });

  it("falls back to — for an unknown project", () => {
    const result = buildMyWorkList([wp({ id: "x", code: "WP-09", project_id: "ghost" })], PROJECTS);
    expect(result[0]?.projectName).toBe("—");
    expect(result[0]?.projectCode).toBe("");
  });

  it("resolves each WP's category_id to its GLOBAL work-category code", () => {
    const categoryCodeById = new Map([["cat-elec", "W05"]]);
    const result = buildMyWorkList(
      [
        wp({ id: "a", code: "WP-01", project_id: "p1", category_id: "cat-elec" }),
        wp({ id: "b", code: "WP-02", project_id: "p1", category_id: "cat-missing" }),
        wp({ id: "c", code: "WP-03", project_id: "p1", category_id: null }),
      ],
      PROJECTS,
      categoryCodeById,
    );
    expect(result.find((r) => r.id === "a")?.categoryCode).toBe("W05");
    expect(result.find((r) => r.id === "b")?.categoryCode).toBeNull();
    expect(result.find((r) => r.id === "c")?.categoryCode).toBeNull();
  });
});

// Spec 375 U1 — the list is ordered by MOVEMENT, not by alphabet.
//
// Measured on prod 2026-07-29: the SA home rendered 139 rows sorted by project
// code then WP code, 105 of them cold backlog. The app's own ranking SSOT could
// not fix it — `rankFromPriority` reads `work_packages.priority` and all 177 open
// leaf WPs are `priority='normal'`, so it is a constant. Last-photo recency is
// the only input with variance.
//
// ⚠️ The sort key and the cold-divider key MUST be the same field, or the cold
// rows are not contiguous and the `ไม่มีรูปใน 14 วัน` rule lands mid-list with hot
// rows below it. So the order is: last photo desc (nulls last) → updated_at desc
// → the pre-existing project/code order as the final stable tie-break.
describe("buildMyWorkList — movement ordering (spec 375 U1)", () => {
  const COLD_BEFORE = "2026-07-15T00:00:00.000Z";

  it("orders by last photo, newest first", () => {
    const result = buildMyWorkList(
      [
        wp({ id: "old", code: "WP-01", project_id: "p1" }),
        wp({ id: "new", code: "WP-02", project_id: "p1" }),
        wp({ id: "mid", code: "WP-03", project_id: "p1" }),
      ],
      PROJECTS,
      new Map(),
      {
        lastPhotoByWp: new Map([
          ["old", "2026-07-20T08:00:00.000Z"],
          ["new", "2026-07-29T08:00:00.000Z"],
          ["mid", "2026-07-25T08:00:00.000Z"],
        ]),
        coldBeforeIso: COLD_BEFORE,
      },
    );
    expect(result.map((r) => r.id)).toEqual(["new", "mid", "old"]);
    expect(result[0]?.lastPhotoAt).toBe("2026-07-29T08:00:00.000Z");
  });

  it("sorts every photographed WP above every WP that has no photo", () => {
    const result = buildMyWorkList(
      [
        wp({ id: "never", code: "WP-01", project_id: "p1" }),
        wp({ id: "shot", code: "WP-99", project_id: "p2" }),
      ],
      PROJECTS,
      new Map(),
      {
        lastPhotoByWp: new Map([["shot", "2026-07-20T08:00:00.000Z"]]),
        coldBeforeIso: COLD_BEFORE,
      },
    );
    // WP-99/PRJ-002 would sort LAST alphabetically — recency must beat the alphabet.
    expect(result.map((r) => r.id)).toEqual(["shot", "never"]);
    expect(result[1]?.lastPhotoAt).toBeNull();
  });

  it("falls back to updated_at when neither WP has a photo", () => {
    const result = buildMyWorkList(
      [
        wp({
          id: "stale",
          code: "WP-01",
          project_id: "p1",
          updated_at: "2026-07-01T00:00:00.000Z",
        }),
        wp({
          id: "fresh",
          code: "WP-02",
          project_id: "p1",
          updated_at: "2026-07-28T00:00:00.000Z",
        }),
      ],
      PROJECTS,
      new Map(),
      { lastPhotoByWp: new Map(), coldBeforeIso: COLD_BEFORE },
    );
    expect(result.map((r) => r.id)).toEqual(["fresh", "stale"]);
  });

  it("marks a WP cold when its last photo predates the threshold, or it has none", () => {
    const result = buildMyWorkList(
      [
        wp({ id: "hot", code: "WP-01", project_id: "p1" }),
        wp({ id: "coldish", code: "WP-02", project_id: "p1" }),
        wp({ id: "never", code: "WP-03", project_id: "p1" }),
      ],
      PROJECTS,
      new Map(),
      {
        lastPhotoByWp: new Map([
          ["hot", "2026-07-29T08:00:00.000Z"],
          ["coldish", "2026-07-02T08:00:00.000Z"],
        ]),
        coldBeforeIso: COLD_BEFORE,
      },
    );
    expect(result.find((r) => r.id === "hot")?.isCold).toBe(false);
    expect(result.find((r) => r.id === "coldish")?.isCold).toBe(true);
    expect(result.find((r) => r.id === "never")?.isCold).toBe(true);
  });

  it("keeps the cold rows CONTIGUOUS at the tail — the divider invariant", () => {
    // The labelled rule is rendered at the first cold row. If a hot row could
    // appear below a cold one the rule would be a lie, so this is the property
    // the whole unit rests on: isCold must never go true→false down the list.
    const rows = Array.from({ length: 12 }, (_, i) =>
      wp({
        id: `w${i}`,
        code: `WP-${String(i).padStart(2, "0")}`,
        project_id: i % 2 ? "p1" : "p2",
      }),
    );
    const lastPhotoByWp = new Map(
      rows
        .filter((_, i) => i % 3 !== 0)
        .map((r, i) => [
          r.id,
          `2026-07-${String(((i * 7) % 27) + 1).padStart(2, "0")}T08:00:00.000Z`,
        ]),
    );
    const result = buildMyWorkList(rows, PROJECTS, new Map(), {
      lastPhotoByWp,
      coldBeforeIso: COLD_BEFORE,
    });
    const firstCold = result.findIndex((r) => r.isCold);
    expect(firstCold).toBeGreaterThan(-1);
    expect(result.slice(firstCold).every((r) => r.isCold)).toBe(true);
  });

  it("compares INSTANTS, not the raw timestamp strings", () => {
    // The two sources are encoded differently: PostgREST returns `…+00:00`,
    // `toISOString()` (the cutoff) returns `…Z`, and bytewise "+" < "Z". A photo
    // taken at EXACTLY the cutoff instant is not "before" it, so it must be HOT —
    // but a lexicographic compare reads ".000000+00:00" as less than ".000Z" and
    // marks it cold. This case fails on string comparison and passes on Date.parse.
    const result = buildMyWorkList(
      [wp({ id: "boundary", code: "WP-01", project_id: "p1" })],
      PROJECTS,
      new Map(),
      {
        lastPhotoByWp: new Map([["boundary", "2026-07-15T12:00:00.000000+00:00"]]),
        coldBeforeIso: "2026-07-15T12:00:00.000Z",
      },
    );
    expect(result[0]?.isCold).toBe(false);
  });

  it("orders mixed-encoding timestamps chronologically", () => {
    const result = buildMyWorkList(
      [
        wp({ id: "older", code: "WP-01", project_id: "p1" }),
        wp({ id: "newer", code: "WP-02", project_id: "p1" }),
      ],
      PROJECTS,
      new Map(),
      {
        lastPhotoByWp: new Map([
          // Same instant expressed two ways plus a minute — a naive string sort
          // would put the "+07:00" row first because "+" sorts below every digit.
          ["older", "2026-07-20T19:00:00.000000+07:00"],
          ["newer", "2026-07-20T12:01:00.000000+00:00"],
        ]),
        coldBeforeIso: COLD_BEFORE,
      },
    );
    expect(result.map((r) => r.id)).toEqual(["newer", "older"]);
  });

  it("defaults to the legacy alphabetical order when no movement input is given", () => {
    // The 4th argument is optional so every existing caller keeps its contract.
    const result = buildMyWorkList(
      [
        wp({ id: "b", code: "WP-02", project_id: "p2" }),
        wp({ id: "a", code: "WP-02", project_id: "p1" }),
      ],
      PROJECTS,
    );
    expect(result.map((r) => r.id)).toEqual(["a", "b"]);
    expect(result[0]?.isCold).toBe(false);
  });
});
