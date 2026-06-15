// Spec 115 / ADR 0044 — purchase-order pure helpers.
//   derivePurchaseOrderStatus(memberStatuses) → open|ordered|partially_received|received
//     (rejected/cancelled members EXCLUDED from the roll-up, §5).
//   purchaseOrderTotal(lineAmounts) → sum of the non-null amounts (the PO total
//     is computed, never stored — §3).

import { describe, expect, it } from "vitest";
import { derivePurchaseOrderStatus, purchaseOrderTotal } from "@/lib/purchasing/purchase-order";

describe("derivePurchaseOrderStatus", () => {
  it("returns 'open' when no member is purchased yet", () => {
    expect(derivePurchaseOrderStatus(["approved", "approved"])).toBe("open");
    expect(derivePurchaseOrderStatus(["requested", "approved"])).toBe("open");
  });

  it("returns 'ordered' when all members are purchased and none delivered", () => {
    expect(derivePurchaseOrderStatus(["purchased", "purchased"])).toBe("ordered");
  });

  it("treats on_route (shipped, not yet delivered) as still ordered", () => {
    expect(derivePurchaseOrderStatus(["purchased", "on_route"])).toBe("ordered");
    expect(derivePurchaseOrderStatus(["on_route"])).toBe("ordered");
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
