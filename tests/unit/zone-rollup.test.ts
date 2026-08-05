// Spec 392 U3a — the zone × หมวดงาน rollup is the surface that answers the
// operator's stated requirement ("track work per zone"), so its arithmetic is
// product behaviour, not presentation.
//
// Two properties carry the whole grid and neither is obvious from the render:
//
//  1. Only LEAF work packages count. A งาน (is_group) row is a grouping entity —
//     the DB rejects all work on it — so counting it would add its children a
//     second time and inflate every cell it touches.
//  2. The remainder is REPORTED, never dropped. `work_packages.zone_id` is
//     nullable and 1,307 live rows carry no zone, so a grid of only the zoned
//     work reads as "the project is fully mapped" when almost none of it is.
//     That is the same class as a percentage over a silently-narrowed
//     denominator, and it is exactly the fill rate spec 392 §8 accepts on.

import { describe, expect, it } from "vitest";
import { buildZoneRollup, type RollupWorkPackage } from "@/lib/zones/zone-rollup";
import type { ZoneRowInput } from "@/lib/zones/zone-list";

const zone = (over: Partial<ZoneRowInput> & { id: string }): ZoneRowInput => ({
  code: "Z",
  name: "โซน",
  shape: "rect",
  sortOrder: 0,
  parentZoneId: null,
  ...over,
});

const wp = (over: Partial<RollupWorkPackage>): RollupWorkPackage => ({
  zoneId: null,
  categoryId: null,
  status: "not_started",
  isGroup: false,
  ...over,
});

const CATS = [
  { id: "c1", code: "W01", name: "งานโครงสร้าง", sortOrder: 0 },
  { id: "c2", code: "W05", name: "งานพื้น", sortOrder: 1 },
];

describe("buildZoneRollup", () => {
  it("counts each zone's leaf work packages into its work-category column", () => {
    const result = buildZoneRollup({
      zones: [zone({ id: "z1", code: "A" }), zone({ id: "z2", code: "B", sortOrder: 1 })],
      categories: CATS,
      workPackages: [
        wp({ zoneId: "z1", categoryId: "c1" }),
        wp({ zoneId: "z1", categoryId: "c1" }),
        wp({ zoneId: "z1", categoryId: "c2" }),
        wp({ zoneId: "z2", categoryId: "c2" }),
      ],
    });
    expect(result.columns.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(result.rows.map((r) => ({ id: r.zoneId, cells: r.cells }))).toEqual([
      { id: "z1", cells: [2, 1] },
      { id: "z2", cells: [0, 1] },
    ]);
  });

  it("excludes งาน group rows — they would double-count their own children", () => {
    const result = buildZoneRollup({
      zones: [zone({ id: "z1", code: "A" })],
      categories: CATS,
      workPackages: [
        wp({ zoneId: "z1", categoryId: "c1", isGroup: true }),
        wp({ zoneId: "z1", categoryId: "c1" }),
      ],
    });
    expect(result.rows[0]?.total).toBe(1);
    expect(result.rows[0]?.cells).toEqual([1]);
  });

  it("derives the per-zone percentage from complete leaves over that zone's total", () => {
    const result = buildZoneRollup({
      zones: [zone({ id: "z1", code: "A" })],
      categories: CATS,
      workPackages: [
        wp({ zoneId: "z1", categoryId: "c1", status: "complete" }),
        wp({ zoneId: "z1", categoryId: "c1", status: "complete" }),
        wp({ zoneId: "z1", categoryId: "c1", status: "in_progress" }),
        wp({ zoneId: "z1", categoryId: "c2", status: "not_started" }),
      ],
    });
    expect(result.rows[0]).toMatchObject({ complete: 2, total: 4, percent: 50 });
  });

  it("reports zero percent for an empty zone rather than dividing by zero", () => {
    const result = buildZoneRollup({
      zones: [zone({ id: "z1", code: "A" })],
      categories: CATS,
      workPackages: [],
    });
    expect(result.rows[0]).toMatchObject({ total: 0, complete: 0, percent: 0 });
  });

  it("reports the unzoned remainder as its own row — the grid must not read as complete coverage", () => {
    const result = buildZoneRollup({
      zones: [zone({ id: "z1", code: "A" })],
      categories: CATS,
      workPackages: [
        wp({ zoneId: "z1", categoryId: "c1" }),
        wp({ zoneId: null, categoryId: "c1" }),
        wp({ zoneId: null, categoryId: "c2", status: "complete" }),
      ],
    });
    expect(result.unzoned).toMatchObject({ total: 2, complete: 1, cells: [1, 1] });
  });

  it("has no unzoned row when every leaf carries a zone", () => {
    const result = buildZoneRollup({
      zones: [zone({ id: "z1", code: "A" })],
      categories: CATS,
      workPackages: [wp({ zoneId: "z1", categoryId: "c1" })],
    });
    expect(result.unzoned).toBeNull();
  });

  it("drops a category column no counted work package uses — a phone cannot scroll 20 empty columns", () => {
    const result = buildZoneRollup({
      zones: [zone({ id: "z1", code: "A" })],
      categories: CATS,
      workPackages: [wp({ zoneId: "z1", categoryId: "c2" })],
    });
    expect(result.columns.map((c) => c.id)).toEqual(["c2"]);
  });

  it("gives uncategorised work its own trailing column instead of losing it", () => {
    const result = buildZoneRollup({
      zones: [zone({ id: "z1", code: "A" })],
      categories: CATS,
      workPackages: [
        wp({ zoneId: "z1", categoryId: "c1" }),
        wp({ zoneId: "z1", categoryId: null }),
        // A category id the project list no longer carries resolves to the same
        // bucket: the WP is real and its count must survive the lookup miss.
        wp({ zoneId: "z1", categoryId: "gone" }),
      ],
    });
    expect(result.columns.map((c) => c.id)).toEqual(["c1", null]);
    expect(result.rows[0]?.cells).toEqual([1, 2]);
  });

  it("orders and indents zones exactly as the zone list does — one ordering, two surfaces", () => {
    const result = buildZoneRollup({
      zones: [
        zone({ id: "child", code: "A1", sortOrder: 5, parentZoneId: "parent" }),
        zone({ id: "parent", code: "A", sortOrder: 1 }),
        zone({ id: "other", code: "B", sortOrder: 2 }),
      ],
      categories: CATS,
      workPackages: [],
    });
    expect(result.rows.map((r) => [r.zoneId, r.depth])).toEqual([
      ["parent", 0],
      ["child", 1],
      ["other", 0],
    ]);
  });

  it("returns no rows and no columns when the project has no zones", () => {
    const result = buildZoneRollup({
      zones: [],
      categories: CATS,
      workPackages: [wp({ zoneId: null, categoryId: "c1" })],
    });
    expect(result.rows).toEqual([]);
    expect(result.columns).toEqual([]);
    expect(result.unzoned).toBeNull();
  });
});
