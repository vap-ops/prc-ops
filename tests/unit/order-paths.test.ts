// Writing failing test first.
//
// Spec 135 U5 — single source of purchase-order-surface URLs. The PO detail and the
// new per-delivery detail page get builders so the scattered inline
// `/requests/orders/${poId}` template literals (and the new delivery path) route
// through one file (mirrors project-paths). Content-named per spec 82 — no role prefix.

import { describe, expect, it } from "vitest";

import { deliveryDetailHref, poDetailHref } from "@/lib/nav/order-paths";

describe("order-paths builders", () => {
  it("poDetailHref points at the content-named PO detail page", () => {
    expect(poDetailHref("po1")).toBe("/requests/orders/po1");
  });

  it("deliveryDetailHref nests the delivery detail under its PO", () => {
    expect(deliveryDetailHref("po1", "d9")).toBe("/requests/orders/po1/deliveries/d9");
  });

  it("never emits a role-named /sa or /pm prefix", () => {
    expect(poDetailHref("x")).not.toMatch(/\/(sa|pm)\//);
    expect(deliveryDetailHref("x", "y")).not.toMatch(/\/(sa|pm)\//);
  });
});
