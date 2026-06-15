// Spec 107 — per-supplier spend aggregation.

import { describe, expect, it } from "vitest";
import { aggregateSupplierSpend } from "@/lib/purchasing/supplier-spend";

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
