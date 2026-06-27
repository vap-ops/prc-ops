// Spec 47 — slim clickable request card. Load-bearing rules: the whole
// card is one link to /requests/{id}; it shows the padded PR number, item
// description, and Thai status label; and it contains NO form or button —
// slimness is the contract (every action lives on the detail page now).

import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { PurchaseRequestCard } from "@/components/features/purchasing/purchase-request-card";

const BASE_REQUEST = {
  id: "7f1f2a3b-4c5d-6e7f-8a9b-0c1d2e3f4a5b",
  pr_number: 7,
  item_description: "ปูนซีเมนต์",
  quantity: 10,
  unit: "ถุง",
  status: "requested" as const,
  priority: "normal" as const,
  requested_at: "2026-06-01T08:00:00Z",
  needed_by: null,
  decided_at: null,
  purchased_at: null,
  shipped_at: null,
  delivered_at: null,
  eta: null,
};

describe("PurchaseRequestCard (spec 47)", () => {
  it("renders the whole card as a link to the request detail page", () => {
    render(
      <PurchaseRequestCard
        request={BASE_REQUEST}
        workPackage={{ code: "WP-001", name: "งานเทพื้น" }}
        requesterName="สมชาย"
        isMine={false}
      />,
    );
    const link = screen.getByRole("link");
    expect(link).toHaveAttribute("href", `/requests/${BASE_REQUEST.id}`);
  });

  it("shows PR number, item, quantity, and Thai status label", () => {
    render(
      <PurchaseRequestCard
        request={BASE_REQUEST}
        workPackage={{ code: "WP-001", name: "งานเทพื้น" }}
        requesterName="สมชาย"
        isMine={false}
      />,
    );
    expect(screen.getByText("PR-0007")).toBeInTheDocument();
    expect(screen.getByText(/ปูนซีเมนต์/)).toBeInTheDocument();
    expect(screen.getByText(/10 ถุง/)).toBeInTheDocument();
    expect(screen.getByText("ส่งคำขอแล้ว")).toBeInTheDocument();
  });

  it("shows the ของฉัน badge only on the viewer's own request", () => {
    const { rerender } = render(
      <PurchaseRequestCard
        request={BASE_REQUEST}
        workPackage={null}
        requesterName="สมชาย"
        isMine={true}
      />,
    );
    expect(screen.getByText("ของฉัน")).toBeInTheDocument();
    rerender(
      <PurchaseRequestCard
        request={BASE_REQUEST}
        workPackage={null}
        requesterName="สมชาย"
        isMine={false}
      />,
    );
    expect(screen.queryByText("ของฉัน")).not.toBeInTheDocument();
  });

  it("renders no form or button — actions live on the detail page", () => {
    const { container } = render(
      <PurchaseRequestCard
        request={{ ...BASE_REQUEST, status: "approved", priority: "urgent" }}
        workPackage={{ code: "WP-001", name: "งานเทพื้น" }}
        requesterName="สมชาย"
        isMine={true}
      />,
    );
    expect(container.querySelector("form")).toBeNull();
    expect(container.querySelector("button")).toBeNull();
  });

  // Spec 211 U5 — PO membership must be visible in every band, not only the
  // in_transit PO group. A request that belongs to an order shows a PO chip; a
  // loose request shows none.
  it("shows a PO chip when the request belongs to a purchase order", () => {
    const { rerender } = render(
      <PurchaseRequestCard
        request={BASE_REQUEST}
        workPackage={null}
        requesterName="สมชาย"
        isMine={false}
        poNumber={12}
      />,
    );
    expect(screen.getByText("PO-0012")).toBeInTheDocument();
    rerender(
      <PurchaseRequestCard
        request={BASE_REQUEST}
        workPackage={null}
        requesterName="สมชาย"
        isMine={false}
        poNumber={null}
      />,
    );
    expect(screen.queryByText(/PO-/)).toBeNull();
  });
});
