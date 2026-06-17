// Spec 138 U2 — the desktop KPI hero row. This pure helper packages the spec-105
// procurement summary into the four tile descriptors the row renders, deriving the
// เกินกำหนด tile's chase-toggle state.

import { describe, it, expect } from "vitest";

import { buildWorklistKpis } from "@/lib/purchasing/worklist-kpis";

const SUMMARY = { toOrder: 5, inTransit: 8, overdue: 3 };

describe("buildWorklistKpis", () => {
  it("builds the four tiles in display order with values + captions", () => {
    const tiles = buildWorklistKpis({
      summary: SUMMARY,
      outstanding: "฿118,007",
      overdueHref: "/requests?overdue=1",
      overdueActive: false,
    });
    expect(tiles.map((t) => t.key)).toEqual(["to_order", "in_transit", "overdue", "outstanding"]);
    expect(tiles.map((t) => [t.label, t.value])).toEqual([
      ["รอสั่งซื้อ", "5"],
      ["กำลังจัดส่ง", "8"],
      ["เกินกำหนด", "3"],
      ["ค้างจ่าย", "฿118,007"],
    ]);
    expect(tiles.map((t) => t.icon)).toEqual(["waiting", "shipping", "overdue", "outstanding"]);
  });

  it("tones the static tiles hot / shipping / neutral", () => {
    const tiles = buildWorklistKpis({
      summary: SUMMARY,
      outstanding: "฿0",
      overdueHref: "/x",
      overdueActive: false,
    });
    expect(tiles[0]!.tone).toBe("hot"); // รอสั่งซื้อ — the actionable hero
    expect(tiles[1]!.tone).toBe("shipping");
    expect(tiles[3]!.tone).toBe("neutral");
  });

  it("the overdue tile carries the chase href + active; others have neither", () => {
    const tiles = buildWorklistKpis({
      summary: SUMMARY,
      outstanding: "฿0",
      overdueHref: "/requests?overdue=1",
      overdueActive: true,
    });
    const overdue = tiles.find((t) => t.key === "overdue")!;
    expect(overdue.href).toBe("/requests?overdue=1");
    expect(overdue.active).toBe(true);
    for (const t of tiles.filter((x) => x.key !== "overdue")) {
      expect(t.href).toBeNull();
      expect(t.active).toBe(false);
    }
  });

  it("overdue tone is danger when there are overdue items OR the filter is active, else neutral", () => {
    const danger = buildWorklistKpis({
      summary: { toOrder: 0, inTransit: 0, overdue: 2 },
      outstanding: "฿0",
      overdueHref: "/x",
      overdueActive: false,
    }).find((t) => t.key === "overdue")!;
    expect(danger.tone).toBe("danger");

    const activeNoCount = buildWorklistKpis({
      summary: { toOrder: 0, inTransit: 0, overdue: 0 },
      outstanding: "฿0",
      overdueHref: "/x",
      overdueActive: true,
    }).find((t) => t.key === "overdue")!;
    expect(activeNoCount.tone).toBe("danger");

    const calm = buildWorklistKpis({
      summary: { toOrder: 0, inTransit: 0, overdue: 0 },
      outstanding: "฿0",
      overdueHref: "/x",
      overdueActive: false,
    }).find((t) => t.key === "overdue")!;
    expect(calm.tone).toBe("neutral");
  });
});
