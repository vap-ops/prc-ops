import { describe, it, expect } from "vitest";
import {
  selectStoreIncoming,
  selectIncomingDeliveries,
  selectIncomingArrivals,
} from "@/lib/store/incoming";

const TODAY = "2026-07-12";
// Minimal raw purchase_requests rows (only the fields the selector reads).
const raw = (
  id: string,
  status: string,
  eta: string | null,
  base: string | null = "ปูน",
  qty = 10,
  deliveryId: string | null = null,
  supplier: string | null = "ร้านวัสดุ",
) =>
  ({
    id,
    item_description: "รายการอิสระ",
    quantity: qty,
    unit: "ถุง",
    eta,
    status,
    supplier,
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

// Spec 307 — one-line quick POs made 1 card/PR; the arrival grain is (ETA day ×
// supplier) under day headers so the SA can count packages/day. Composed with
// spec 308: items stay sub-grouped by delivery so each keeps a receive link.
describe("selectIncomingArrivals", () => {
  it("groups by day, then supplier — merging same-supplier-same-day deliveries into one arrival", () => {
    const days = selectIncomingArrivals(
      [
        // Three one-line POs (distinct deliveries), same supplier + day → ONE arrival.
        raw("a", "on_route", "2026-07-13", "ปูน", 10, "d1"),
        raw("b", "on_route", "2026-07-13", "ทราย", 5, "d2"),
        raw("c", "purchased", "2026-07-13", "อิฐ", 200, "d3"),
        // Different supplier, same day → its own arrival.
        raw("x", "purchased", "2026-07-13", "เหล็ก", 12, "d4", "ร้านเหล็กไทย"),
        // Same supplier, next day → different day group.
        raw("y", "purchased", "2026-07-14", "ปูน", 4, "d5"),
      ],
      "all",
      TODAY,
    );
    expect(days.map((d) => d.day)).toEqual(["2026-07-13", "2026-07-14"]);
    const day13 = days[0]!;
    expect(day13.arrivals.length).toBe(2);
    const a0 = day13.arrivals[0]!;
    expect(a0).toMatchObject({ supplier: "ร้านวัสดุ", status: "on_route", itemCount: 3 });
    expect(day13.arrivals[1]).toMatchObject({ supplier: "ร้านเหล็กไทย", status: "purchased" });
    expect(days[1]!.arrivals[0]!.itemCount).toBe(1);
  });

  it("rolls an arrival to on_route when a later line shipped (purchased-first order)", () => {
    const days = selectIncomingArrivals(
      [
        raw("first", "purchased", "2026-07-13", "ปูน", 10, "d1"),
        raw("second", "on_route", "2026-07-13", "ทราย", 5, "d2"),
      ],
      "all",
      TODAY,
    );
    expect(days[0]!.arrivals[0]!.status).toBe("on_route");
  });

  it("sub-groups an arrival's items by delivery (spec 308 receive unit)", () => {
    const days = selectIncomingArrivals(
      [
        raw("a", "on_route", "2026-07-13", "ปูน", 10, "d1"),
        raw("b", "on_route", "2026-07-13", "ทราย", 5, "d1"),
        raw("c", "purchased", "2026-07-13", "อิฐ", 200, "d2"),
      ],
      "all",
      TODAY,
    );
    const arrival = days[0]!.arrivals[0]!;
    expect(arrival.deliveries.map((d) => d.deliveryId)).toEqual(["d1", "d2"]);
    expect(arrival.deliveries[0]!.items.map((i) => i.id)).toEqual(["a", "b"]);
    expect(arrival.deliveries[1]!.items.map((i) => i.id)).toEqual(["c"]);
  });

  it("delivery-less items collect in a null sub-group (no receive link, links to /requests)", () => {
    const days = selectIncomingArrivals(
      [
        raw("a", "purchased", "2026-07-13", "ปูน", 10, null),
        raw("b", "purchased", "2026-07-13", "ทราย", 5, null),
      ],
      "all",
      TODAY,
    );
    const arrival = days[0]!.arrivals[0]!;
    expect(arrival.deliveries.length).toBe(1);
    expect(arrival.deliveries[0]!.deliveryId).toBeNull();
    expect(arrival.deliveries[0]!.items.length).toBe(2);
  });

  it("unknown-ETA items form the LAST day group (day null), split by supplier", () => {
    const days = selectIncomingArrivals(
      [
        raw("later", "purchased", "2026-07-20", "ปูน", 10, null),
        raw("mystery", "purchased", null, "ทราย", 5, null),
        raw("mystery2", "purchased", null, "อิฐ", 7, null, null),
      ],
      "all",
      TODAY,
    );
    expect(days.map((d) => d.day)).toEqual(["2026-07-20", null]);
    expect(days[1]!.arrivals.map((a) => a.supplier)).toEqual(["ร้านวัสดุ", null]);
  });

  it("marks today and overdue at day + arrival level", () => {
    const days = selectIncomingArrivals(
      [
        raw("late", "on_route", "2026-07-11", "ปูน", 10, null),
        raw("now", "on_route", "2026-07-12", "ทราย", 5, null),
      ],
      "today",
      TODAY,
    );
    expect(days.map((d) => d.day)).toEqual(["2026-07-11", "2026-07-12"]);
    expect(days[0]).toMatchObject({ isToday: false, overdue: true });
    expect(days[0]!.arrivals[0]?.overdue).toBe(true);
    expect(days[1]).toMatchObject({ isToday: true, overdue: false });
    expect(days[1]!.arrivals[0]?.overdue).toBe(false);
  });

  it("lens filters items BEFORE grouping (spec 300 U1 semantics unchanged)", () => {
    const days = selectIncomingArrivals(
      [
        raw("a", "on_route", "2026-07-30", "ปูน", 10, null), // future → out under today
        raw("b", "purchased", "2026-07-11", "ทราย", 5, null), // overdue → in
        raw("c", "purchased", null, "อิฐ", 7, null), // unknown → in
      ],
      "today",
      TODAY,
    );
    expect(days.map((d) => d.day)).toEqual(["2026-07-11", null]);
  });

  it("a supplier literally named 'none' does not merge into the null-supplier arrival", () => {
    const days = selectIncomingArrivals(
      [
        raw("a", "purchased", "2026-07-13", "ปูน", 10, null, "none"),
        raw("b", "purchased", "2026-07-13", "ทราย", 5, null, null),
      ],
      "all",
      TODAY,
    );
    expect(days[0]!.arrivals.length).toBe(2);
  });

  it("arrival keys are unique across null suppliers and days", () => {
    const days = selectIncomingArrivals(
      [
        raw("a", "purchased", "2026-07-13", "ปูน", 10, null, null),
        raw("b", "purchased", null, "ทราย", 5, null, null),
      ],
      "all",
      TODAY,
    );
    const keys = days.flatMap((d) => d.arrivals.map((a) => a.key));
    expect(new Set(keys).size).toBe(keys.length);
  });
});
