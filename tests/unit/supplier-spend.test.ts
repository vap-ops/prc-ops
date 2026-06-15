// Spec 107 — per-supplier spend aggregation.

import { describe, expect, it } from "vitest";
import { aggregateSupplierSpend, buildSupplierSpendBadges } from "@/lib/purchasing/supplier-spend";

describe("aggregateSupplierSpend", () => {
  it("sums committed spend and counts open (in-transit) POs per supplier", () => {
    const m = aggregateSupplierSpend([
      { supplier_id: "s1", amount: 1000, status: "purchased" }, // open + spend
      { supplier_id: "s1", amount: 500, status: "delivered" }, // received, spend only
      { supplier_id: "s1", amount: null, status: "on_route" }, // open, no amount
      { supplier_id: "s2", amount: 2000, status: "on_route" }, // open + spend
      { supplier_id: "s1", amount: 999, status: "approved" }, // not committed → ignored
      { supplier_id: null, amount: 50, status: "site_purchased" }, // no supplier → ignored
    ]);
    expect(m.get("s1")).toEqual({ spend: 1500, open: 2 });
    expect(m.get("s2")).toEqual({ spend: 2000, open: 1 });
  });

  it("ignores rejected/cancelled/requested and supplier-less rows", () => {
    const m = aggregateSupplierSpend([
      { supplier_id: "s1", amount: 100, status: "rejected" },
      { supplier_id: "s1", amount: 100, status: "requested" },
    ]);
    expect(m.size).toBe(0);
  });

  it("empty → empty map", () => {
    expect(aggregateSupplierSpend([]).size).toBe(0);
  });
});

// Bugfix (spec 109 lesson recurring): the procurement vendors page is a Server
// Component passing the badge to the CLIENT ContactsTabs. A function prop throws
// across the RSC boundary, so the badge must be a SERIALIZABLE map. This helper
// builds it; ContactsTabs makes the rowBadge closure client-side.
describe("buildSupplierSpendBadges", () => {
  it("maps stats to a serializable id→badge record (spend + open count)", () => {
    const badges = buildSupplierSpendBadges(
      new Map([
        ["s1", { spend: 1500, open: 2 }],
        ["s2", { spend: 2000, open: 0 }],
      ]),
    );
    expect(badges.s1).toEqual({ label: "฿1,500 · 2 ค้างส่ง", tone: "neutral" });
    expect(badges.s2).toEqual({ label: "฿2,000", tone: "neutral" });
  });

  it("skips suppliers with no spend and no open POs (no chip)", () => {
    const badges = buildSupplierSpendBadges(new Map([["s3", { spend: 0, open: 0 }]]));
    expect(badges.s3).toBeUndefined();
    expect(Object.keys(badges)).toHaveLength(0);
  });

  it("shows an open-only supplier (zero spend, open count)", () => {
    const badges = buildSupplierSpendBadges(new Map([["s4", { spend: 0, open: 1 }]]));
    expect(badges.s4).toEqual({ label: "฿0 · 1 ค้างส่ง", tone: "neutral" });
  });

  it("rounds and thousands-separates the baht amount", () => {
    const badges = buildSupplierSpendBadges(new Map([["s5", { spend: 1234567.8, open: 0 }]]));
    expect(badges.s5?.label).toBe("฿1,234,568");
  });

  it("returns a plain serializable object (no function values)", () => {
    const badges = buildSupplierSpendBadges(new Map([["s1", { spend: 10, open: 0 }]]));
    expect(JSON.parse(JSON.stringify(badges))).toEqual(badges);
  });

  it("empty stats → empty record", () => {
    expect(buildSupplierSpendBadges(new Map())).toEqual({});
  });
});
