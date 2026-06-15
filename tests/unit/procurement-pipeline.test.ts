// Spec 104 — procurement worklist pipeline bands.

import { describe, expect, it } from "vitest";
import {
  PROCUREMENT_BANDS,
  procurementBand,
  groupByProcurementBand,
} from "@/lib/purchasing/procurement-pipeline";

describe("procurementBand", () => {
  it("maps statuses to buyer bands", () => {
    expect(procurementBand("approved")).toBe("to_order");
    expect(procurementBand("purchased")).toBe("in_transit");
    expect(procurementBand("on_route")).toBe("in_transit");
    expect(procurementBand("delivered")).toBe("received");
    expect(procurementBand("site_purchased")).toBe("received");
    expect(procurementBand("requested")).toBe("awaiting_approval");
  });

  it("excludes rejected/cancelled (not the buyer's work)", () => {
    expect(procurementBand("rejected")).toBeNull();
    expect(procurementBand("cancelled")).toBeNull();
  });

  it("to_order is the one hot band", () => {
    expect(PROCUREMENT_BANDS.filter((b) => b.hot).map((b) => b.band)).toEqual(["to_order"]);
  });
});

describe("groupByProcurementBand", () => {
  it("groups in band order, drops empty bands + unbanded rows, preserves input order", () => {
    const rows = [
      { id: "a", status: "delivered" },
      { id: "b", status: "approved" },
      { id: "c", status: "cancelled" }, // excluded
      { id: "d", status: "on_route" },
      { id: "e", status: "approved" },
      { id: "f", status: "requested" },
    ];
    const groups = groupByProcurementBand(rows);
    expect(groups.map((g) => g.meta.band)).toEqual([
      "to_order",
      "in_transit",
      "received",
      "awaiting_approval",
    ]);
    // to_order keeps input order (b before e); cancelled dropped.
    expect(groups[0]?.items.map((r) => r.id)).toEqual(["b", "e"]);
    expect(groups[1]?.items.map((r) => r.id)).toEqual(["d"]);
    expect(groups[2]?.items.map((r) => r.id)).toEqual(["a"]);
    expect(groups[3]?.items.map((r) => r.id)).toEqual(["f"]);
  });

  it("empty input → no groups", () => {
    expect(groupByProcurementBand([])).toEqual([]);
  });
});
