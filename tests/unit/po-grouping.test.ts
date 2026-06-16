// Spec 134 U2 — group worklist rows by their PO. Pure: within a band's rows
// (already priority-sorted), split rows that belong to a purchase_order (keyed by
// id, first-appearance order) from the loose rows (purchase_order_id null), so the
// in-transit band can collapse a bundled order into one PO card.

import { describe, expect, it } from "vitest";
import { groupByPurchaseOrder } from "@/lib/purchasing/po-grouping";

const row = (id: string, poId: string | null) => ({ id, purchase_order_id: poId });

describe("groupByPurchaseOrder", () => {
  it("returns everything loose when no row has a PO", () => {
    const rows = [row("a", null), row("b", null)];
    const { poGroups, loose } = groupByPurchaseOrder(rows);
    expect(poGroups).toEqual([]);
    expect(loose).toEqual(rows);
  });

  it("collects a single PO's members into one group, in input order", () => {
    const rows = [row("a", "po1"), row("b", "po1")];
    const { poGroups, loose } = groupByPurchaseOrder(rows);
    expect(loose).toEqual([]);
    expect(poGroups).toEqual([{ poId: "po1", items: [row("a", "po1"), row("b", "po1")] }]);
  });

  it("orders PO groups by first appearance and preserves loose rows", () => {
    const rows = [
      row("a", "po2"),
      row("b", null),
      row("c", "po1"),
      row("d", "po2"),
      row("e", null),
    ];
    const { poGroups, loose } = groupByPurchaseOrder(rows);
    expect(poGroups.map((g) => g.poId)).toEqual(["po2", "po1"]);
    expect(poGroups[0]?.items).toEqual([row("a", "po2"), row("d", "po2")]);
    expect(poGroups[1]?.items).toEqual([row("c", "po1")]);
    expect(loose).toEqual([row("b", null), row("e", null)]);
  });

  it("is empty/empty for no rows", () => {
    expect(groupByPurchaseOrder([])).toEqual({ poGroups: [], loose: [] });
  });
});
