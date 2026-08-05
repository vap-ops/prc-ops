// Spec 392 U3a — narrowing the project work-list to one zone.
//
// The list is a two-level roster (spec 270): งาน groups head sections and งานย่อย
// leaves live inside them. Only leaves carry a zone, so a naive `filter` on
// zone_id deletes every group row and the งาน lens collapses to nothing. The
// rule is therefore asymmetric: leaves are filtered, groups SURVIVE exactly as
// long as one of their children does.

import { describe, expect, it } from "vitest";
import { filterByZone, UNZONED, type ZoneFilterable } from "@/lib/zones/zone-filter";

const wp = (over: Partial<ZoneFilterable> & { id: string }): ZoneFilterable => ({
  isGroup: false,
  parentId: null,
  zoneId: null,
  ...over,
});

describe("filterByZone", () => {
  const ROSTER = [
    wp({ id: "g1", isGroup: true }),
    wp({ id: "a", parentId: "g1", zoneId: "z1" }),
    wp({ id: "b", parentId: "g1", zoneId: "z2" }),
    wp({ id: "g2", isGroup: true }),
    wp({ id: "c", parentId: "g2", zoneId: "z2" }),
    wp({ id: "loose", zoneId: null }),
  ];

  it("returns the roster untouched when no zone is selected", () => {
    expect(filterByZone(ROSTER, null)).toEqual(ROSTER);
  });

  it("keeps the leaves of the chosen zone", () => {
    expect(
      filterByZone(ROSTER, "z2")
        .filter((w) => !w.isGroup)
        .map((w) => w.id),
    ).toEqual(["b", "c"]);
  });

  it("keeps a งาน group only while one of its children survives", () => {
    // z1 lives under g1 alone, so g2 has nothing left to head.
    expect(
      filterByZone(ROSTER, "z1")
        .filter((w) => w.isGroup)
        .map((w) => w.id),
    ).toEqual(["g1"]);
  });

  it("preserves roster order so the lenses keep their own sorting contract", () => {
    expect(filterByZone(ROSTER, "z2").map((w) => w.id)).toEqual(["g1", "b", "g2", "c"]);
  });

  it("selects the unzoned leaves — the bucket the fill rate is about", () => {
    expect(filterByZone(ROSTER, UNZONED).map((w) => w.id)).toEqual(["loose"]);
  });

  it("returns an empty roster rather than the full one when a zone holds nothing", () => {
    // The caller must be able to tell "no งาน in this zone" from "no filter", or
    // it renders the whole project under a chip claiming one zone.
    expect(filterByZone(ROSTER, "z-empty")).toEqual([]);
  });
});
