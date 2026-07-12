import { describe, it, expect } from "vitest";
import { selectStoreIncoming, selectIncomingDeliveries } from "@/lib/store/incoming";

const TODAY = "2026-07-12";
// Minimal raw purchase_requests rows (only the fields the selector reads).
const raw = (
  id: string,
  status: string,
  eta: string | null,
  base: string | null = "ปูน",
  qty = 10,
  deliveryId: string | null = null,
) =>
  ({
    id,
    item_description: "รายการอิสระ",
    quantity: qty,
    unit: "ถุง",
    eta,
    status,
    supplier: "ร้านวัสดุ",
    delivery_id: deliveryId,
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

// Spec 305 — operator: "a delivery may naturally include many PR items"; the
// ของเข้า surface shows one card per delivery (งวดส่ง), items inside.
describe("selectIncomingDeliveries", () => {
  it("groups PR lines sharing a delivery_id into one delivery", () => {
    const groups = selectIncomingDeliveries(
      [
        raw("a", "on_route", "2026-07-11", "ปูน", 10, "d1"),
        raw("b", "on_route", "2026-07-11", "ทราย", 5, "d1"),
        raw("c", "on_route", "2026-07-11", "อิฐ", 200, "d2"),
      ],
      "all",
      TODAY,
    );
    expect(groups.length).toBe(2);
    const d1 = groups.find((g) => g.deliveryId === "d1")!;
    expect(d1.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(d1.supplier).toBe("ร้านวัสดุ");
  });

  it("a null delivery_id row forms its own singleton group", () => {
    const groups = selectIncomingDeliveries(
      [
        raw("a", "purchased", "2026-07-13", "ปูน", 10, null),
        raw("b", "purchased", "2026-07-13", "ทราย", 5, null),
      ],
      "all",
      TODAY,
    );
    expect(groups.length).toBe(2);
    expect(groups.every((g) => g.deliveryId === null && g.items.length === 1)).toBe(true);
  });

  it("lens filters items BEFORE grouping (a delivery with no surviving items disappears)", () => {
    const groups = selectIncomingDeliveries(
      [
        raw("a", "on_route", "2026-07-30", "ปูน", 10, "d1"), // future
        raw("b", "purchased", "2026-07-11", "ทราย", 5, "d2"), // overdue
      ],
      "today",
      TODAY,
    );
    expect(groups.map((g) => g.deliveryId)).toEqual(["d2"]);
  });

  it("derives group eta (earliest), overdue (any), status (on_route if any shipped)", () => {
    const groups = selectIncomingDeliveries(
      [
        raw("a", "purchased", "2026-07-20", "ปูน", 10, "d1"),
        raw("b", "on_route", "2026-07-11", "ทราย", 5, "d1"),
      ],
      "all",
      TODAY,
    );
    expect(groups[0]).toMatchObject({
      deliveryId: "d1",
      eta: "2026-07-11",
      overdue: true,
      status: "on_route",
    });
  });

  it("orders deliveries due-first, unknown-ETA last; equal ETAs keep item order", () => {
    const groups = selectIncomingDeliveries(
      [
        raw("late", "on_route", "2026-07-20", "ปูน", 10, "dLate"),
        raw("noeta", "purchased", null, "ทราย", 5, "dNone"),
        raw("soon", "on_route", "2026-07-13", "อิฐ", 1, "dSoon"),
        raw("soon2", "on_route", "2026-07-13", "เหล็ก", 2, "dSoon2"),
      ],
      "all",
      TODAY,
    );
    expect(groups.map((g) => g.deliveryId)).toEqual(["dSoon", "dSoon2", "dLate", "dNone"]);
  });

  it("an all-purchased delivery stays purchased; null-delivery keys are pr-scoped", () => {
    const groups = selectIncomingDeliveries(
      [
        raw("a", "purchased", "2026-07-13", "ปูน", 10, "d1"),
        raw("b", "purchased", "2026-07-13", "ทราย", 5, "d1"),
        raw("solo", "purchased", "2026-07-14", "อิฐ", 1, null),
      ],
      "all",
      TODAY,
    );
    expect(groups.find((g) => g.deliveryId === "d1")?.status).toBe("purchased");
    expect(groups.find((g) => g.deliveryId === null)?.key).toBe("pr:solo");
  });

  it("supplier falls back to the first member that names one", () => {
    const noSupplier = {
      ...(raw("x", "on_route", "2026-07-13", "ปูน", 10, "d1") as Record<string, unknown>),
      supplier: null,
    } as never;
    const groups = selectIncomingDeliveries(
      [noSupplier, raw("y", "on_route", "2026-07-13", "ทราย", 5, "d1")],
      "all",
      TODAY,
    );
    expect(groups[0]?.supplier).toBe("ร้านวัสดุ");
  });
});
