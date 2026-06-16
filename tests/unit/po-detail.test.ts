// Spec 134 U1 — PO detail view-model. buildPoDetailView composes the spec-115
// pure helpers (derivePurchaseOrderStatus + purchaseOrderTotal) and adds the one
// piece of logic the page needs that neither helper covers alone: the PO money
// total must EXCLUDE rejected/cancelled lines (a refused/withdrawn line is not PO
// spend), matching the status roll-up's own §5 exclusion.

import { describe, expect, it } from "vitest";
import { buildPoDetailView } from "@/lib/purchasing/po-detail";

describe("buildPoDetailView", () => {
  it("derives the PO status from the member statuses", () => {
    expect(
      buildPoDetailView([
        { status: "purchased", amount: 100 },
        { status: "delivered", amount: 200 },
      ]).status,
    ).toBe("partially_received");

    expect(
      buildPoDetailView([
        { status: "delivered", amount: 100 },
        { status: "delivered", amount: 200 },
      ]).status,
    ).toBe("received");

    expect(buildPoDetailView([{ status: "purchased", amount: 100 }]).status).toBe("ordered");
  });

  it("totals the active line amounts", () => {
    expect(
      buildPoDetailView([
        { status: "purchased", amount: 100 },
        { status: "on_route", amount: 250 },
      ]).total,
    ).toBe(350);
  });

  it("ignores null amounts in the total (an unpriced line)", () => {
    expect(
      buildPoDetailView([
        { status: "purchased", amount: 100 },
        { status: "purchased", amount: null },
      ]).total,
    ).toBe(100);
  });

  it("excludes rejected/cancelled lines from BOTH the total and the active count", () => {
    const view = buildPoDetailView([
      { status: "delivered", amount: 100 },
      { status: "rejected", amount: 999 },
      { status: "cancelled", amount: 999 },
    ]);
    // Only the delivered line is active → received, ฿100, one active line.
    expect(view.status).toBe("received");
    expect(view.total).toBe(100);
    expect(view.activeLineCount).toBe(1);
  });

  it("is open with zero total for an empty / all-excluded PO", () => {
    expect(buildPoDetailView([])).toEqual({ status: "open", total: 0, activeLineCount: 0 });
    expect(
      buildPoDetailView([
        { status: "rejected", amount: 50 },
        { status: "cancelled", amount: 50 },
      ]),
    ).toEqual({ status: "open", total: 0, activeLineCount: 0 });
  });
});
