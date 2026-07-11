import { describe, it, expect } from "vitest";
import { selectStoreIncoming } from "@/lib/store/incoming";

const TODAY = "2026-07-12";
// Minimal raw purchase_requests rows (only the fields the selector reads).
const raw = (
  id: string,
  status: string,
  eta: string | null,
  base: string | null = "ปูน",
  qty = 10,
) =>
  ({
    id,
    item_description: "รายการอิสระ",
    quantity: qty,
    unit: "ถุง",
    eta,
    status,
    supplier: "ร้านวัสดุ",
    catalog_items: base == null ? null : { base_item: base, spec_attrs: null },
  }) as never;

describe("selectStoreIncoming", () => {
  it("today lens = due-or-overdue + no-ETA, mapped to view rows", () => {
    const rows = selectStoreIncoming(
      [
        raw("a", "on_route", "2026-07-11"), // overdue -> in
        raw("b", "purchased", "2026-07-30"), // future -> out
        raw("c", "purchased", null), // unknown -> in
      ],
      "today",
      TODAY,
    );
    expect(rows.map((r) => r.id)).toEqual(["a", "c"]);
    expect(rows[0]).toMatchObject({
      id: "a",
      baseItem: "ปูน",
      qty: 10,
      unit: "ถุง",
      overdue: true,
    });
    expect(rows.find((r) => r.id === "c")?.overdue).toBe(false);
  });

  it("onroute lens keeps only on_route", () => {
    const rows = selectStoreIncoming(
      [raw("a", "on_route", "2026-07-30"), raw("b", "purchased", "2026-07-11")],
      "onroute",
      TODAY,
    );
    expect(rows.map((r) => r.id)).toEqual(["a"]);
  });

  it("falls back to item_description when the PR has no catalog item", () => {
    const rows = selectStoreIncoming([raw("x", "on_route", "2026-07-11", null)], "today", TODAY);
    expect(rows[0]?.baseItem).toBe("รายการอิสระ");
  });

  it("sorts due-first, unknown-ETA last", () => {
    const rows = selectStoreIncoming(
      [
        raw("late", "on_route", "2026-07-20"),
        raw("noeta", "purchased", null),
        raw("soon", "on_route", "2026-07-13"),
      ],
      "all",
      TODAY,
    );
    expect(rows.map((r) => r.id)).toEqual(["soon", "late", "noeta"]);
  });
});
