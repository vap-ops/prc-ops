// Writing failing test first.
//
// Spec 327 U5 — the ทรัพยากร material-coverage core (pure). Per WP (+ a
// project bucket for null-WP lines): the plan's items split into ในคลัง /
// กำลังมา / ยังไม่สั่งซื้อ, with the ยังไม่สั่งซื้อ items NAMED (§0.2 — a gap
// names what's missing, not a percentage). ITEM-presence counting, not qty
// arithmetic across items (units differ per item — the §0.5 approximation the
// UI labels): an item is ในคลัง when project stock covers its planned qty
// (same canonical unit per catalog_item_id — safe), else กำลังมา when an
// active in_transit PR carries that item, else ยังไม่สั่งซื้อ.

import { describe, expect, it } from "vitest";

import {
  buildMaterialCoverage,
  type CoveragePlanLine,
  type CoveragePrRow,
} from "@/lib/purchasing/wp-material-coverage";

function line(overrides: Partial<CoveragePlanLine>): CoveragePlanLine {
  return {
    workPackageId: "wp1",
    catalogItemId: "cement",
    qty: 10,
    baseItem: "ปูนถุง",
    specAttrs: "40kg",
    unit: "ถุง",
    ...overrides,
  };
}

function prRow(overrides: Partial<CoveragePrRow>): CoveragePrRow {
  return { status: "purchased", catalogItemId: "cement", ...overrides };
}

describe("buildMaterialCoverage", () => {
  it("counts an item ในคลัง when project stock covers its planned qty", () => {
    const out = buildMaterialCoverage([line({})], [{ catalogItemId: "cement", qtyOnHand: 10 }], []);
    const wp1 = out.byWp.get("wp1");
    expect(wp1).toMatchObject({ plannedItems: 1, inStock: 1, incoming: 0, notOrdered: 0 });
  });

  it("under-stocked item with an in_transit PR counts กำลังมา (item presence, no qty math)", () => {
    const out = buildMaterialCoverage(
      [line({})],
      [{ catalogItemId: "cement", qtyOnHand: 3 }],
      [prRow({ status: "on_route" })],
    );
    expect(out.byWp.get("wp1")).toMatchObject({ inStock: 0, incoming: 1, notOrdered: 0 });
  });

  it("to_order / awaiting_approval PRs do NOT make an item กำลังมา — it stays ยังไม่สั่งซื้อ, named", () => {
    const out = buildMaterialCoverage(
      [line({})],
      [],
      [prRow({ status: "requested" }), prRow({ status: "approved" })],
    );
    const wp1 = out.byWp.get("wp1");
    expect(wp1).toMatchObject({ inStock: 0, incoming: 0, notOrdered: 1 });
    expect(wp1?.notOrderedItems).toEqual([{ baseItem: "ปูนถุง", specAttrs: "40kg", unit: "ถุง" }]);
  });

  it("done/closed PRs never count as incoming", () => {
    const out = buildMaterialCoverage(
      [line({})],
      [],
      [prRow({ status: "delivered" }), prRow({ status: "cancelled" })],
    );
    expect(out.byWp.get("wp1")).toMatchObject({ incoming: 0, notOrdered: 1 });
  });

  it("sums multi-line qty per item before the stock compare", () => {
    const out = buildMaterialCoverage(
      [line({ qty: 6 }), line({ qty: 6 })],
      [{ catalogItemId: "cement", qtyOnHand: 10 }], // 10 < 12 → not covered
      [],
    );
    expect(out.byWp.get("wp1")).toMatchObject({ plannedItems: 1, inStock: 0, notOrdered: 1 });
  });

  it("routes null-WP lines to the project bucket (§0.1)", () => {
    const out = buildMaterialCoverage(
      [
        line({
          workPackageId: null,
          catalogItemId: "sand",
          baseItem: "ทราย",
          specAttrs: null,
          unit: "คิว",
        }),
      ],
      [],
      [],
    );
    expect(out.projectBucket).toMatchObject({ plannedItems: 1, notOrdered: 1 });
    expect(out.projectBucket.notOrderedItems[0]?.baseItem).toBe("ทราย");
  });

  it("null-catalog PRs never match an item (legacy free-text rows — the labeled approximation)", () => {
    const out = buildMaterialCoverage(
      [line({})],
      [],
      [prRow({ catalogItemId: null, status: "on_route" })],
    );
    expect(out.byWp.get("wp1")).toMatchObject({ incoming: 0, notOrdered: 1 });
  });
});
