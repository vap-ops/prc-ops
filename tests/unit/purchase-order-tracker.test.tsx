// Spec 134 U6 — the PO progress stepper (สั่งซื้อ → จัดส่ง → รับของ). Parallels the
// per-ticket PurchaseRequestTracker. Guard: each stage node carries its intuitive
// SSOT glyph (FileText / Truck / PackageCheck) so the truck is visible at the
// จัดส่ง step, matching the status pills — not a bare dot.

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PurchaseOrderTracker } from "@/components/features/purchasing/purchase-order-tracker";

function steps() {
  return screen.getAllByRole("listitem");
}

describe("PurchaseOrderTracker (spec 134 U6)", () => {
  it("renders the three stages in order", () => {
    render(<PurchaseOrderTracker status="ordered" />);
    expect(steps().map((li) => li.getAttribute("data-stage"))).toEqual([
      "ordered",
      "in_transit",
      "received",
    ]);
  });

  it("shows the intuitive stage glyph at each node (truck at จัดส่ง, even upcoming)", () => {
    const { container } = render(<PurchaseOrderTracker status="ordered" />);
    expect(container.querySelector('[data-stage="ordered"] .lucide-file-text')).toBeInTheDocument();
    expect(container.querySelector('[data-stage="in_transit"] .lucide-truck')).toBeInTheDocument();
    expect(
      container.querySelector('[data-stage="received"] .lucide-package-check'),
    ).toBeInTheDocument();
  });
});
