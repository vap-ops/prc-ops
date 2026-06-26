// Spec 138 U2/U4 — the desktop KPI hero row. This pure helper packages the spec-105
// procurement summary into the four tile descriptors the row renders, deriving each
// tile's filter href/active. U4: the รอสั่งซื้อ / กำลังจัดส่ง tiles tap-to-filter their
// band; the เกินกำหนด tile keeps its chase toggle; ค้างจ่าย stays static.

import { describe, it, expect } from "vitest";

import { buildWorklistKpis } from "@/lib/purchasing/worklist-kpis";
import type { ProcurementFilter } from "@/lib/purchasing/worklist-filter";

const SUMMARY = { toOrder: 5, inTransit: 8, overdue: 3 };

const EMPTY_FILTER: ProcurementFilter = {
  supplier: null,
  projectId: null,
  overdue: false,
  status: null,
  band: null,
};

describe("buildWorklistKpis", () => {
  it("builds the four tiles in display order with values + captions", () => {
    const tiles = buildWorklistKpis({
      summary: SUMMARY,
      outstanding: "฿118,007",
      filter: EMPTY_FILTER,
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
    const tiles = buildWorklistKpis({ summary: SUMMARY, outstanding: "฿0", filter: EMPTY_FILTER });
    expect(tiles[0]!.tone).toBe("hot"); // รอสั่งซื้อ — the actionable hero
    expect(tiles[1]!.tone).toBe("shipping");
    expect(tiles[3]!.tone).toBe("neutral");
  });

  // U4 — the band tiles tap-to-filter.
  it("the to_order + in_transit tiles link to their band filter (overdue cleared), idle by default", () => {
    const tiles = buildWorklistKpis({ summary: SUMMARY, outstanding: "฿0", filter: EMPTY_FILTER });
    const toOrder = tiles.find((t) => t.key === "to_order")!;
    const inTransit = tiles.find((t) => t.key === "in_transit")!;
    expect(toOrder.href).toBe("/requests?band=to_order");
    expect(toOrder.active).toBe(false);
    expect(inTransit.href).toBe("/requests?band=in_transit");
    expect(inTransit.active).toBe(false);
  });

  it("the active band tile is pressed and toggles its band off (back to ทั้งหมด)", () => {
    const tiles = buildWorklistKpis({
      summary: SUMMARY,
      outstanding: "฿0",
      filter: { ...EMPTY_FILTER, band: "to_order" },
    });
    const toOrder = tiles.find((t) => t.key === "to_order")!;
    expect(toOrder.active).toBe(true);
    expect(toOrder.href).toBe("/requests"); // re-tap clears the band
    // the sibling band tile stays an off→on link
    const inTransit = tiles.find((t) => t.key === "in_transit")!;
    expect(inTransit.active).toBe(false);
    expect(inTransit.href).toBe("/requests?band=in_transit");
  });

  it("band-tile hrefs preserve supplier/project and clear overdue (so they are not active under overdue)", () => {
    const tiles = buildWorklistKpis({
      summary: SUMMARY,
      outstanding: "฿0",
      filter: { supplier: "ACME", projectId: "p1", overdue: true, status: null, band: null },
    });
    const toOrder = tiles.find((t) => t.key === "to_order")!;
    expect(toOrder.href).toBe("/requests?supplier=ACME&project=p1&band=to_order");
    expect(toOrder.active).toBe(false); // overdue is on → no band tile reads active
  });

  it("the overdue tile keeps its existing chase toggle (href + active)", () => {
    const off = buildWorklistKpis({
      summary: SUMMARY,
      outstanding: "฿0",
      filter: EMPTY_FILTER,
    }).find((t) => t.key === "overdue")!;
    expect(off.href).toBe("/requests?overdue=1"); // toggle ON
    expect(off.active).toBe(false);

    const on = buildWorklistKpis({
      summary: SUMMARY,
      outstanding: "฿0",
      filter: { ...EMPTY_FILTER, overdue: true },
    }).find((t) => t.key === "overdue")!;
    expect(on.href).toBe("/requests"); // toggle OFF
    expect(on.active).toBe(true);
  });

  it("the ค้างจ่าย (outstanding) tile stays static — no href, never active", () => {
    const out = buildWorklistKpis({
      summary: SUMMARY,
      outstanding: "฿0",
      filter: EMPTY_FILTER,
    }).find((t) => t.key === "outstanding")!;
    expect(out.href).toBeNull();
    expect(out.active).toBe(false);
  });

  // Spec 208 follow-up (feedback e4c02550): when every PR is delivered, the four
  // active-work tiles are all 0 and the procurement landing looked "broken". The
  // optional ส่งมอบแล้ว tile surfaces the cumulative delivered spend so the money is
  // visible. Appended only when deliveredSpend is supplied (the page always does).
  it("appends a ส่งมอบแล้ว (delivered) tile when deliveredSpend is provided", () => {
    const tiles = buildWorklistKpis({
      summary: SUMMARY,
      outstanding: "฿0",
      deliveredSpend: "฿507,172",
      filter: EMPTY_FILTER,
    });
    expect(tiles.map((t) => t.key)).toEqual([
      "to_order",
      "in_transit",
      "overdue",
      "outstanding",
      "delivered",
    ]);
    const delivered = tiles.find((t) => t.key === "delivered")!;
    expect([delivered.label, delivered.value]).toEqual(["ส่งมอบแล้ว", "฿507,172"]);
    expect(delivered.icon).toBe("delivered");
    expect(delivered.tone).toBe("neutral");
    expect(delivered.href).toBeNull();
    expect(delivered.active).toBe(false);
  });

  it("omits the delivered tile when deliveredSpend is not provided (back-compat)", () => {
    const tiles = buildWorklistKpis({ summary: SUMMARY, outstanding: "฿0", filter: EMPTY_FILTER });
    expect(tiles.some((t) => t.key === "delivered")).toBe(false);
    expect(tiles).toHaveLength(4);
  });

  it("overdue tone is danger when there are overdue items OR the filter is active, else neutral", () => {
    const danger = buildWorklistKpis({
      summary: { toOrder: 0, inTransit: 0, overdue: 2 },
      outstanding: "฿0",
      filter: EMPTY_FILTER,
    }).find((t) => t.key === "overdue")!;
    expect(danger.tone).toBe("danger");

    const activeNoCount = buildWorklistKpis({
      summary: { toOrder: 0, inTransit: 0, overdue: 0 },
      outstanding: "฿0",
      filter: { ...EMPTY_FILTER, overdue: true },
    }).find((t) => t.key === "overdue")!;
    expect(activeNoCount.tone).toBe("danger");

    const calm = buildWorklistKpis({
      summary: { toOrder: 0, inTransit: 0, overdue: 0 },
      outstanding: "฿0",
      filter: EMPTY_FILTER,
    }).find((t) => t.key === "overdue")!;
    expect(calm.tone).toBe("neutral");
  });
});
