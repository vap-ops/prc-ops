// Spec 368 U4 — the store section's split: อยู่ในคลัง vs ยืมไปที่งาน.
// Out = open usage log (anti-join input is precomputed) joined to WP + holder;
// in-store = everything else AT the project, bulk always here with qty.
// Oldest loan first — the obligation lens (368 §6.1).

import { describe, expect, it } from "vitest";
import { splitStoreEquipment } from "@/lib/equipment/store-split";

const ITEMS = [
  {
    id: "i1",
    name: "สว่าน Hilti",
    categoryName: "เครื่องมือเจาะ",
    assetTag: "EQ-01",
    status: "on_site" as const,
    condition: null,
    tracking: "unit" as const,
    quantity: null,
  },
  {
    id: "i2",
    name: "เครื่องตัด",
    categoryName: "ตัด",
    assetTag: null,
    status: "in_use" as const,
    condition: "good" as const,
    tracking: "unit" as const,
    quantity: null,
  },
  {
    id: "i3",
    name: "นั่งร้าน",
    categoryName: "นั่งร้าน",
    assetTag: null,
    status: "on_site" as const,
    condition: null,
    tracking: "bulk" as const,
    quantity: 11,
  },
];

const OPEN_LOANS = [
  {
    logId: "L2",
    itemId: "i2",
    wpId: "wp-9",
    wpCode: "W05-03",
    wpName: "งานผนัง",
    checkedOutOn: "2026-07-25",
    holderName: "สมชาย",
  },
];

describe("spec 368 U4 — splitStoreEquipment", () => {
  it("an item with an open loan moves to ยืมไปที่งาน with WP + days; the rest stay in-store", () => {
    const s = splitStoreEquipment({ items: ITEMS, openLoans: OPEN_LOANS, today: "2026-07-28" });
    expect(s.out.map((r) => r.itemId)).toEqual(["i2"]);
    expect(s.out[0]).toMatchObject({ wpCode: "W05-03", days: 3, holderName: "สมชาย", logId: "L2" });
    expect(s.inStore.map((r) => r.id)).toEqual(["i1", "i3"]);
    expect(s.counts).toEqual({ inStore: 2, out: 1 });
  });

  it("bulk NEVER appears in the out group even if a rogue log names it (D5 belt)", () => {
    const s = splitStoreEquipment({
      items: ITEMS,
      openLoans: [...OPEN_LOANS, { ...OPEN_LOANS[0]!, logId: "LX", itemId: "i3" }],
      today: "2026-07-28",
    });
    expect(s.out.map((r) => r.itemId)).toEqual(["i2"]);
    expect(s.inStore.map((r) => r.id)).toContain("i3");
  });

  it("out sorts oldest loan first", () => {
    const s = splitStoreEquipment({
      items: ITEMS,
      openLoans: [
        { ...OPEN_LOANS[0]!, logId: "LA", itemId: "i1", checkedOutOn: "2026-07-26" },
        OPEN_LOANS[0]!,
      ],
      today: "2026-07-28",
    });
    expect(s.out.map((r) => r.logId)).toEqual(["L2", "LA"]);
  });

  it("a loan for an item NOT in the store list still shows in out (mis-shelved tool must not vanish)", () => {
    const s = splitStoreEquipment({
      items: ITEMS.slice(0, 1),
      openLoans: OPEN_LOANS,
      today: "2026-07-28",
    });
    expect(s.out.map((r) => r.itemId)).toEqual(["i2"]);
    expect(s.out[0]!.itemName).toBe("i2");
  });
});
