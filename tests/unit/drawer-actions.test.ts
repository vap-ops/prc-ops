import { describe, expect, it } from "vitest";
import { procurementDrawerActions } from "@/lib/purchasing/drawer-actions";

// Spec 114 — which procurement (buyer) actions apply at each status in the review
// drawer. Mirrors the detail page's back-office gating. Pure, TDD-first.

describe("procurementDrawerActions", () => {
  it("approved → record purchase only", () => {
    expect(procurementDrawerActions("approved")).toEqual({
      record: true,
      ship: false,
      invoice: false,
      deliveryPhoto: false,
    });
  });

  it("purchased → ship + invoice (not record, not delivery photo)", () => {
    expect(procurementDrawerActions("purchased")).toEqual({
      record: false,
      ship: true,
      invoice: true,
      deliveryPhoto: false,
    });
  });

  it("on_route → invoice + delivery photo", () => {
    expect(procurementDrawerActions("on_route")).toEqual({
      record: false,
      ship: false,
      invoice: true,
      deliveryPhoto: true,
    });
  });

  it("delivered → invoice + delivery photo", () => {
    expect(procurementDrawerActions("delivered")).toEqual({
      record: false,
      ship: false,
      invoice: true,
      deliveryPhoto: true,
    });
  });

  it("site_purchased → invoice only", () => {
    expect(procurementDrawerActions("site_purchased")).toEqual({
      record: false,
      ship: false,
      invoice: true,
      deliveryPhoto: false,
    });
  });

  it("requested / rejected / cancelled → no buyer actions", () => {
    for (const s of ["requested", "rejected", "cancelled"] as const) {
      expect(procurementDrawerActions(s)).toEqual({
        record: false,
        ship: false,
        invoice: false,
        deliveryPhoto: false,
      });
    }
  });
});
