// Spec 213 U1 — the per-material movement-log assembly. Pure function: five
// mapped movement source arrays (for one project+item) → a newest-first typed
// log with signed on-hand deltas and a running balance. No I/O.

import { describe, expect, it } from "vitest";
import { buildMaterialLog, type MaterialLogSources } from "@/lib/store/material-log";

// A worked life for one item: receive 50 → issue 10 to a WP → count finds 38
// (−2 shrinkage) → return 4 from the WP → undo the issue (+10). Ascending
// running balance: 50 → 40 → 38 → 42 → 52.
const sources: MaterialLogSources = {
  receipts: [
    {
      id: "r1",
      at: "2026-06-20T08:00:00Z",
      createdAt: "2026-06-20T08:00:00Z",
      qty: 50,
      unitCost: 30,
      totalCost: 1500,
      actorId: "u-store",
      note: null,
      supplierName: "ร้านวัสดุดี",
    },
  ],
  issues: [
    {
      id: "i1",
      at: "2026-06-21T08:00:00Z",
      createdAt: "2026-06-21T08:00:00Z",
      qty: 10,
      unitCost: 30,
      totalCost: 300,
      actorId: "u-sa",
      note: null,
      workPackage: { code: "WP-03", name: "ฐานราก" },
    },
  ],
  counts: [
    {
      id: "c1",
      at: "2026-06-22T08:00:00Z",
      createdAt: "2026-06-22T08:00:00Z",
      countedQty: 38,
      systemQty: 40,
      variance: -2,
      varianceValue: -60,
      actorId: "u-sa",
      note: null,
    },
  ],
  returns: [
    {
      id: "rt1",
      at: "2026-06-23T08:00:00Z",
      createdAt: "2026-06-23T08:00:00Z",
      qty: 4,
      totalCost: 120,
      actorId: "u-sa",
      note: null,
      workPackage: { code: "WP-03", name: "ฐานราก" },
    },
  ],
  reversals: [
    {
      id: "rv1",
      at: "2026-06-24T08:00:00Z",
      createdAt: "2026-06-24T08:00:00Z",
      qty: 10,
      valueDelta: 300,
      reverses: "issue",
      actorId: "u-pm",
      note: "บันทึกเบิกผิด",
    },
  ],
};

const empty: MaterialLogSources = {
  receipts: [],
  issues: [],
  counts: [],
  returns: [],
  reversals: [],
};

describe("buildMaterialLog (spec 213 U1)", () => {
  it("returns entries newest-first across all five movement types", () => {
    const log = buildMaterialLog(sources);
    expect(log).toHaveLength(5);
    expect(log.map((e) => e.id)).toEqual(["rv1", "rt1", "c1", "i1", "r1"]);
    expect(log.map((e) => e.kind)).toEqual(["reversal", "return", "count", "issue", "receipt"]);
  });

  it("signs the on-hand delta per kind (receipt/return + ; issue − ; count = variance; reversal flips)", () => {
    const byId = Object.fromEntries(buildMaterialLog(sources).map((e) => [e.id, e]));
    expect(byId.r1!.qtyDelta).toBe(50); // receipt +
    expect(byId.i1!.qtyDelta).toBe(-10); // issue −
    expect(byId.c1!.qtyDelta).toBe(-2); // count = variance (counted − system)
    expect(byId.rt1!.qtyDelta).toBe(4); // return +
    expect(byId.rv1!.qtyDelta).toBe(10); // reversal OF an issue adds qty back +
  });

  it("flips a receipt reversal negative", () => {
    const log = buildMaterialLog({
      ...empty,
      receipts: sources.receipts,
      reversals: [{ ...sources.reversals[0]!, id: "rv2", reverses: "receipt" }],
    });
    expect(log.find((e) => e.id === "rv2")!.qtyDelta).toBe(-10);
  });

  it("runs a balance that lands on current on-hand (52) and is correct per row", () => {
    const log = buildMaterialLog(sources);
    // newest row carries the latest running balance = current on-hand
    expect(log[0]!.balanceAfter).toBe(52);
    const byId = Object.fromEntries(log.map((e) => [e.id, e]));
    expect(byId.r1!.balanceAfter).toBe(50);
    expect(byId.i1!.balanceAfter).toBe(40);
    expect(byId.c1!.balanceAfter).toBe(38);
    expect(byId.rt1!.balanceAfter).toBe(42);
    expect(byId.rv1!.balanceAfter).toBe(52);
  });

  it("carries the cost-side figure per kind (and the WP for issue/return)", () => {
    const byId = Object.fromEntries(buildMaterialLog(sources).map((e) => [e.id, e]));
    expect(byId.r1!.cost).toBe(1500);
    expect(byId.i1!.cost).toBe(300);
    expect(byId.c1!.cost).toBe(-60);
    expect(byId.rt1!.cost).toBe(120);
    expect(byId.i1!.workPackage).toEqual({ code: "WP-03", name: "ฐานราก" });
    expect(byId.rt1!.workPackage).toEqual({ code: "WP-03", name: "ฐานราก" });
    expect(byId.r1!.workPackage).toBeNull();
  });

  it("breaks ties on equal timestamps by createdAt then id (stable)", () => {
    const log = buildMaterialLog({
      ...empty,
      receipts: [
        {
          ...sources.receipts[0]!,
          id: "rA",
          at: "2026-06-20T08:00:00Z",
          createdAt: "2026-06-20T08:00:02Z",
        },
        {
          ...sources.receipts[0]!,
          id: "rB",
          at: "2026-06-20T08:00:00Z",
          createdAt: "2026-06-20T08:00:01Z",
        },
      ],
    });
    // newest-first: later createdAt (rA) comes before earlier (rB)
    expect(log.map((e) => e.id)).toEqual(["rA", "rB"]);
  });

  it("returns an empty log for an item with no movements", () => {
    expect(buildMaterialLog(empty)).toEqual([]);
  });
});
