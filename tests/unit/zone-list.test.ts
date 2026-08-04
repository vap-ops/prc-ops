// Spec 392 U2a — the zone list is the ACCESSIBLE path to everything the canvas
// does. A canvas is opaque to a screen reader and to a keyboard, so every zone
// must be reachable, countable and editable from this list alone. That makes
// its ordering and its counts product behaviour, not presentation detail.

import { describe, expect, it } from "vitest";
import { buildZoneList, type ZoneRowInput } from "@/lib/zones/zone-list";

const zone = (over: Partial<ZoneRowInput> & { id: string }): ZoneRowInput => ({
  code: "A",
  name: "โซน",
  shape: "rect",
  sortOrder: 0,
  parentZoneId: null,
  ...over,
});

describe("buildZoneList", () => {
  it("orders by sort_order, then by code as the tie-break", () => {
    const rows = buildZoneList(
      [
        zone({ id: "3", code: "C", sortOrder: 1 }),
        zone({ id: "1", code: "B", sortOrder: 0 }),
        zone({ id: "2", code: "A", sortOrder: 0 }),
      ],
      {},
    );
    expect(rows.map((r) => r.id)).toEqual(["2", "1", "3"]);
  });

  it("carries the work-package count for each zone", () => {
    const rows = buildZoneList([zone({ id: "1", code: "A" }), zone({ id: "2", code: "B" })], {
      "1": 31,
      "2": 9,
    });
    expect(rows.map((r) => r.workPackageCount)).toEqual([31, 9]);
  });

  it("reports zero for a zone nothing points at — an empty zone is not a missing zone", () => {
    const rows = buildZoneList([zone({ id: "1" })], {});
    expect(rows[0]?.workPackageCount).toBe(0);
  });

  it("totals the work packages across zones", () => {
    const rows = buildZoneList([zone({ id: "1", code: "A" }), zone({ id: "2", code: "B" })], {
      "1": 4,
      "2": 6,
    });
    expect(rows.reduce((sum, r) => sum + r.workPackageCount, 0)).toBe(10);
  });

  it("keeps a child directly after its parent, so the flat list still reads as the tree", () => {
    const rows = buildZoneList(
      [
        zone({ id: "p1", code: "A", sortOrder: 0 }),
        zone({ id: "p2", code: "B", sortOrder: 1 }),
        zone({ id: "c1", code: "A1", sortOrder: 0, parentZoneId: "p1" }),
      ],
      {},
    );
    expect(rows.map((r) => r.id)).toEqual(["p1", "c1", "p2"]);
  });

  it("marks depth so the list can indent without re-deriving the tree", () => {
    const rows = buildZoneList(
      [zone({ id: "p1", code: "A" }), zone({ id: "c1", code: "A1", parentZoneId: "p1" })],
      {},
    );
    expect(rows.map((r) => r.depth)).toEqual([0, 1]);
  });

  it("still renders a zone whose parent is missing, at the top level", () => {
    // `parent_zone_id` is `on delete set null` in the DB, but a parent can also
    // be invisible to THIS reader through RLS. Dropping the row would hide a
    // zone that exists; showing it flat is the honest degradation.
    const rows = buildZoneList([zone({ id: "orphan", code: "X", parentZoneId: "gone" })], {});
    expect(rows.map((r) => r.id)).toEqual(["orphan"]);
    expect(rows[0]?.depth).toBe(0);
  });

  it("sorts an orphan AMONG the top-level zones, not after them", () => {
    // Mutation-found: the previous orphan test could not see this. Dropping the
    // `!byId.has(parent)` clause still produced the right rows, because the
    // cycle-survivor sweep picks orphans up — but it appends them, so a zone
    // whose parent is merely RLS-invisible would sink below every other zone.
    const rows = buildZoneList(
      [
        zone({ id: "root", code: "B", sortOrder: 1 }),
        zone({ id: "orphan", code: "A", sortOrder: 0, parentZoneId: "gone" }),
      ],
      {},
    );
    expect(rows.map((r) => r.id)).toEqual(["orphan", "root"]);
  });

  it("does not loop on a parent cycle — U1 leaves that state reachable", () => {
    // The migration blocks a self-parent but NOT a two-node cycle (recorded as
    // an open question in the tracker). A reader that recursed would hang the
    // page, so the builder must terminate whatever the data says.
    const rows = buildZoneList(
      [
        zone({ id: "a", code: "A", parentZoneId: "b" }),
        zone({ id: "b", code: "B", parentZoneId: "a" }),
      ],
      {},
    );
    expect(rows).toHaveLength(2);
  });

  it("returns nothing for no zones — the empty state is the caller's job", () => {
    expect(buildZoneList([], {})).toEqual([]);
  });
});
