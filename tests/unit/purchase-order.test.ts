// Spec 115 / ADR 0044 — purchase-order pure helpers.
//   derivePurchaseOrderStatus(memberStatuses) → open|ordered|partially_received|received
//     (rejected/cancelled members EXCLUDED from the roll-up, §5).
//   purchaseOrderTotal(lineAmounts) → sum of the non-null amounts (the PO total
//     is computed, never stored — §3).

import { describe, expect, it } from "vitest";
import {
  canVoidPurchaseOrder,
  derivePurchaseOrderStatus,
  purchaseOrderGrandTotal,
  purchaseOrderStageStates,
  purchaseOrderTotal,
} from "@/lib/purchasing/purchase-order";

describe("derivePurchaseOrderStatus", () => {
  it("returns 'open' when no member is purchased yet", () => {
    expect(derivePurchaseOrderStatus(["approved", "approved"])).toBe("open");
    expect(derivePurchaseOrderStatus(["requested", "approved"])).toBe("open");
  });

  it("returns 'ordered' when all members are purchased and none delivered", () => {
    expect(derivePurchaseOrderStatus(["purchased", "purchased"])).toBe("ordered");
  });

  it("returns 'in_transit' once a member is shipped (on_route) but none delivered yet", () => {
    // Spec 134 U6 / ADR 0044 roll-up amendment: surface the delivering stage so the
    // PO no longer jumps ordered → received with the shipment invisible.
    expect(derivePurchaseOrderStatus(["purchased", "on_route"])).toBe("in_transit");
    expect(derivePurchaseOrderStatus(["on_route"])).toBe("in_transit");
    expect(derivePurchaseOrderStatus(["on_route", "on_route"])).toBe("in_transit");
  });

  it("stays 'ordered' only while every active member is purchased (none shipped)", () => {
    expect(derivePurchaseOrderStatus(["purchased", "purchased"])).toBe("ordered");
  });

  it("returns 'partially_received' when some but not all members are delivered", () => {
    expect(derivePurchaseOrderStatus(["purchased", "delivered"])).toBe("partially_received");
    expect(derivePurchaseOrderStatus(["on_route", "delivered"])).toBe("partially_received");
  });

  it("returns 'received' when every member is delivered", () => {
    expect(derivePurchaseOrderStatus(["delivered", "delivered"])).toBe("received");
    expect(derivePurchaseOrderStatus(["delivered"])).toBe("received");
  });

  it("excludes rejected and cancelled members from the roll-up (§5)", () => {
    // The only active member is delivered → received.
    expect(derivePurchaseOrderStatus(["delivered", "rejected"])).toBe("received");
    expect(derivePurchaseOrderStatus(["delivered", "cancelled"])).toBe("received");
    // Active members all purchased → ordered (the cancelled one is ignored).
    expect(derivePurchaseOrderStatus(["purchased", "cancelled"])).toBe("ordered");
    // Some active delivered, some not → partially_received.
    expect(derivePurchaseOrderStatus(["purchased", "delivered", "rejected"])).toBe(
      "partially_received",
    );
  });

  it("returns 'open' for an empty roll-up (no members, or all excluded)", () => {
    expect(derivePurchaseOrderStatus([])).toBe("open");
    expect(derivePurchaseOrderStatus(["rejected", "cancelled"])).toBe("open");
  });
});

describe("canVoidPurchaseOrder", () => {
  // Spec 259: void_purchase_order's client-side mirror of the RPC's own
  // guard — revertible only while EVERY member is still exactly 'purchased'
  // (nothing shipped/delivered). Keeps the button from appearing for an
  // order the RPC would refuse anyway.
  it("is true when every member is purchased", () => {
    expect(canVoidPurchaseOrder(["purchased"])).toBe(true);
    expect(canVoidPurchaseOrder(["purchased", "purchased"])).toBe(true);
  });

  it("is false once any member has shipped or delivered", () => {
    expect(canVoidPurchaseOrder(["purchased", "on_route"])).toBe(false);
    expect(canVoidPurchaseOrder(["purchased", "delivered"])).toBe(false);
    expect(canVoidPurchaseOrder(["delivered"])).toBe(false);
  });

  it("is false for a rejected/cancelled member too (not a clean all-purchased order)", () => {
    expect(canVoidPurchaseOrder(["purchased", "cancelled"])).toBe(false);
    expect(canVoidPurchaseOrder(["purchased", "rejected"])).toBe(false);
  });

  it("is false with no members (nothing to void)", () => {
    expect(canVoidPurchaseOrder([])).toBe(false);
  });
});

describe("purchaseOrderTotal", () => {
  it("sums the line amounts", () => {
    expect(purchaseOrderTotal([100, 200, 50])).toBe(350);
  });

  it("ignores null amounts (a line may be unpriced)", () => {
    expect(purchaseOrderTotal([100, null, 200])).toBe(300);
  });

  it("returns 0 for an empty list or an all-null list", () => {
    expect(purchaseOrderTotal([])).toBe(0);
    expect(purchaseOrderTotal([null, null])).toBe(0);
  });
});

describe("purchaseOrderGrandTotal", () => {
  // Spec 260 — the charges-aware total: line sum + transport + other − discount.
  // Charge `amount` is ALWAYS positive (a discount subtracts by TYPE, never by
  // sign), so the helper — not the data — decides the direction.
  it("equals the pure line sum when there are no charges", () => {
    expect(purchaseOrderGrandTotal([100, 200], [])).toBe(300);
    expect(purchaseOrderGrandTotal([100, null, 200], [])).toBe(300);
  });

  it("adds transport and other charges", () => {
    expect(
      purchaseOrderGrandTotal(
        [100, 200],
        [
          { charge_type: "transport", amount: 50 },
          { charge_type: "other", amount: 25 },
        ],
      ),
    ).toBe(375);
  });

  it("subtracts a discount (stored positive, subtracted by type)", () => {
    expect(purchaseOrderGrandTotal([100, 200], [{ charge_type: "discount", amount: 40 }])).toBe(
      260,
    );
  });

  it("nets a mix of transport, other, and discount", () => {
    expect(
      purchaseOrderGrandTotal(
        [300, 100],
        [
          { charge_type: "transport", amount: 107 },
          { charge_type: "other", amount: 20 },
          { charge_type: "discount", amount: 53.5 },
        ],
      ),
    ).toBe(473.5);
  });

  it("lets a discount push the total negative (a data-entry error shown as-is, not floored)", () => {
    expect(purchaseOrderGrandTotal([100], [{ charge_type: "discount", amount: 250 }])).toBe(-150);
  });

  it("sums multiple charges of the same type", () => {
    expect(
      purchaseOrderGrandTotal(
        [100],
        [
          { charge_type: "transport", amount: 10 },
          { charge_type: "transport", amount: 15 },
          { charge_type: "discount", amount: 5 },
        ],
      ),
    ).toBe(120);
  });
});

describe("purchaseOrderStageStates", () => {
  const states = (status: Parameters<typeof purchaseOrderStageStates>[0]) =>
    purchaseOrderStageStates(status).map((s) => s.state);

  it("walks สั่งซื้อ → จัดส่ง → รับของ as the status advances", () => {
    // ordered: placed, awaiting shipment → จัดส่ง is the current step.
    expect(states("ordered")).toEqual(["done", "current", "pending"]);
    // in_transit: shipped → จัดส่ง done, รับของ current.
    expect(states("in_transit")).toEqual(["done", "done", "current"]);
    // received: all done.
    expect(states("received")).toEqual(["done", "done", "done"]);
  });

  it("marks the รับของ step partial for partially_received", () => {
    const steps = purchaseOrderStageStates("partially_received");
    expect(steps.map((s) => s.state)).toEqual(["done", "done", "current"]);
    expect(steps[2]?.partial).toBe(true);
  });

  it("shows the first step current for an open PO", () => {
    expect(states("open")).toEqual(["current", "pending", "pending"]);
  });

  it("covers exactly the three PO stages in order", () => {
    expect(purchaseOrderStageStates("ordered").map((s) => s.stage)).toEqual([
      "ordered",
      "in_transit",
      "received",
    ]);
  });
});
