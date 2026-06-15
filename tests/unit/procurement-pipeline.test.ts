// Spec 104 — procurement worklist pipeline bands.

import { describe, expect, it } from "vitest";
import {
  PROCUREMENT_BANDS,
  procurementBand,
  groupByProcurementBand,
  procurementSummary,
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

describe("procurementSummary", () => {
  const TODAY = "2026-06-15";

  it("counts to-order + in-transit and flags overdue in-transit ETAs", () => {
    const s = procurementSummary(
      [
        { status: "approved", eta: null },
        { status: "approved", eta: null },
        { status: "purchased", eta: "2026-06-10" }, // overdue
        { status: "on_route", eta: "2026-06-20" }, // future, not overdue
        { status: "on_route", eta: null }, // in transit, no eta
        { status: "delivered", eta: "2026-06-01" }, // received — not counted
        { status: "requested", eta: null }, // awaiting approval — not counted
        { status: "cancelled", eta: "2026-06-01" }, // excluded
      ],
      TODAY,
    );
    expect(s).toEqual({ toOrder: 2, inTransit: 3, overdue: 1 });
  });

  it("an ETA equal to today is not overdue", () => {
    expect(procurementSummary([{ status: "on_route", eta: TODAY }], TODAY).overdue).toBe(0);
  });

  it("empty → zeros", () => {
    expect(procurementSummary([], TODAY)).toEqual({ toOrder: 0, inTransit: 0, overdue: 0 });
  });
});
