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

  // Back-nav sweep 2026-07-11: on the WP detail page the card threads ?from so
  // the request detail's back chip returns to the WP, not the /requests
  // worklist. The worklist call site omits the prop (fallback correct there).
  it("threads ?from into the link when backFrom is set", () => {
    const backFrom = "/projects/proj-1/work-packages/wp-9";
    render(
      <PurchaseRequestCard
        request={BASE_REQUEST}
        workPackage={{ code: "WP-001", name: "งานเทพื้น" }}
        requesterName="สมชาย"
        isMine={false}
        backFrom={backFrom}
      />,
    );
    expect(screen.getByRole("link")).toHaveAttribute(
      "href",
      `/requests/${BASE_REQUEST.id}?from=${encodeURIComponent(backFrom)}`,
    );
  });

  // Feedback 30a1a520 — the text status pill crushed the item name and
  // duplicated the tracker below. Status is now an icon-only badge (colored
  // trio + glyph, Thai label kept for screen readers via aria-label); the
  // label must NOT render as visible text on the card.
  it("shows PR number, item, quantity, and an icon-only status badge", () => {
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
    expect(screen.getByLabelText("ส่งคำขอแล้ว")).toBeInTheDocument();
    expect(screen.queryByText("ส่งคำขอแล้ว")).not.toBeInTheDocument();
  });

  // ด่วนมาก stays a loud TEXT pill — urgency must read at a glance; only the
  // status (already carried by the tracker) went icon-only.
  it("keeps the urgent priority as a text pill", () => {
    render(
      <PurchaseRequestCard
        request={{ ...BASE_REQUEST, status: "approved", priority: "critical" }}
        workPackage={null}
        requesterName="สมชาย"
        isMine={false}
      />,
    );
    expect(screen.getByText("ด่วนมาก")).toBeInTheDocument();
    expect(screen.getByLabelText("อนุมัติแล้ว")).toBeInTheDocument();
    expect(screen.queryByText("อนุมัติแล้ว")).not.toBeInTheDocument();
  });

  // The freed width goes to the item name: it wraps instead of truncating
  // (design doctrine: Thai must not be clipped mid-word).
  it("lets the item name wrap rather than truncate", () => {
    render(
      <PurchaseRequestCard
        request={BASE_REQUEST}
        workPackage={null}
        requesterName="สมชาย"
        isMine={false}
      />,
    );
    const name = screen.getByText(/ปูนซีเมนต์/);
    expect(name.className).not.toMatch(/truncate/);
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

  // Spec 285 U3 — de-commingle: a site_purchased row is an EXPENSE, not a pending
  // request. It must carry a distinct "ค่าใช้จ่าย" badge so it never reads as a
  // request in the shared คำขอซื้อ list; other statuses show no such badge.
  it("badges a site_purchased row as ค่าใช้จ่าย, and only that status", () => {
    const { rerender } = render(
      <PurchaseRequestCard
        request={{ ...BASE_REQUEST, status: "site_purchased" }}
        workPackage={null}
        requesterName="สมชาย"
        isMine={false}
      />,
    );
    expect(screen.getByText("ค่าใช้จ่าย")).toBeInTheDocument();
    rerender(
      <PurchaseRequestCard
        request={{ ...BASE_REQUEST, status: "requested" }}
        workPackage={null}
        requesterName="สมชาย"
        isMine={false}
      />,
    );
    expect(screen.queryByText("ค่าใช้จ่าย")).not.toBeInTheDocument();
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
