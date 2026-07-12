// Writing failing test first.
//
// Spec 301 U1 — the purchasing surfaces render the WP code through the spec-277
// letter-code SSOT (<WpCategoryCode>): a categorised WP shows `E-12`-style
// (category letter swapped for "WP"), an uncategorised WP degrades to the plain
// mono code. Covers the /requests card, the procurement grid row, and the
// phone PO basket card + its checkout-sheet line (the basket derives the sheet
// lines, so one flow proves both).

import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", async () => await import("../helpers/router-refresh"));
vi.mock("@/app/requests/actions", () => ({
  createPurchaseOrder: vi.fn(),
  createSupplier: vi.fn(),
}));

import { PurchaseRequestCard } from "@/components/features/purchasing/purchase-request-card";
import {
  ProcurementGrid,
  type ProcurementGridRecord,
} from "@/components/features/purchasing/procurement-grid";
import { PhonePoBasket } from "@/components/features/purchasing/phone-po-basket";
import { PurchaseRequestForm } from "@/components/features/purchasing/purchase-request-form";
import { groupByProcurementBand } from "@/lib/purchasing/procurement-pipeline";

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

function gridRow(
  over: Partial<ProcurementGridRecord> & Pick<ProcurementGridRecord, "id" | "status">,
): ProcurementGridRecord {
  return {
    pr_number: 1,
    item_description: "ปูนซีเมนต์",
    priority: "normal",
    quantity: 1,
    unit: "ถุง",
    supplier: null,
    amount: null,
    eta: null,
    needed_by: null,
    requested_at: "2026-06-01T00:00:00Z",
    decided_at: null,
    purchased_at: null,
    shipped_at: null,
    delivered_at: null,
    work_package_id: "wp",
    wp_code: null,
    wp_name: null,
    wp_category_code: null,
    project_id: null,
    requested_by: null,
    requester_name: null,
    notes: null,
    decision_comment: null,
    received_by: null,
    delivery_note: null,
    doc_count: 0,
    purchase_order_id: null,
    po_number: null,
    category_id: null,
    category_name: null,
    category_match: null,
    ...over,
  } satisfies ProcurementGridRecord;
}

describe("spec 301 U1 — WP letter-code on purchasing surfaces", () => {
  it("request card: categorised WP renders the letter-code, not the raw code", () => {
    render(
      <PurchaseRequestCard
        request={BASE_REQUEST}
        workPackage={{ code: "WP-001", name: "งานไฟฟ้า", categoryCode: "W05" }}
        requesterName="สมชาย"
        isMine={false}
      />,
    );
    expect(screen.getByText("E-001")).toBeInTheDocument();
    expect(screen.queryByText("WP-001")).not.toBeInTheDocument();
  });

  it("request card: shows the project name when provided (spec 301f)", () => {
    render(
      <PurchaseRequestCard
        request={BASE_REQUEST}
        workPackage={{ code: "WP-001", name: "งานไฟฟ้า", categoryCode: "W05" }}
        requesterName="สมชาย"
        isMine={false}
        projectName="โครงการอัลฟ่า"
      />,
    );
    expect(screen.getByText(/โครงการอัลฟ่า/)).toBeInTheDocument();
  });

  it("request card: no project line when projectName absent (site roles stay lean)", () => {
    render(
      <PurchaseRequestCard
        request={BASE_REQUEST}
        workPackage={{ code: "WP-001", name: "งานไฟฟ้า", categoryCode: "W05" }}
        requesterName="สมชาย"
        isMine={false}
      />,
    );
    expect(screen.queryByText(/โครงการอัลฟ่า/)).not.toBeInTheDocument();
  });

  it("request card: uncategorised WP degrades to the plain mono code", () => {
    render(
      <PurchaseRequestCard
        request={BASE_REQUEST}
        workPackage={{ code: "WP-001", name: "งานเทพื้น", categoryCode: null }}
        requesterName="สมชาย"
        isMine={false}
      />,
    );
    expect(screen.getByText("WP-001")).toBeInTheDocument();
  });

  it("procurement grid row: renders the letter-code for a categorised WP", () => {
    const rows = [
      gridRow({
        id: "a",
        status: "approved",
        wp_code: "WP-12",
        wp_name: "งานไฟฟ้าชั้น 2",
        wp_category_code: "W05",
      }),
    ];
    render(<ProcurementGrid groups={groupByProcurementBand(rows)} today="2026-06-15" />);
    expect(screen.getByText("E-12")).toBeInTheDocument();
    expect(screen.queryByText("WP-12")).not.toBeInTheDocument();
  });

  it("grid row flags an off-category PR with นอกหมวดงาน (amber only — spec 301 U2)", () => {
    const rows = [
      gridRow({
        id: "a",
        status: "approved",
        wp_code: "WP-12",
        wp_category_code: "W05",
        category_match: "mismatch",
      }),
      gridRow({
        id: "b",
        status: "approved",
        item_description: "ปูนถูกหมวด",
        category_match: "match",
      }),
    ];
    render(<ProcurementGrid groups={groupByProcurementBand(rows)} today="2026-06-15" />);
    // amber flag on the mismatching row; the grid stays quiet about matches.
    expect(screen.getByText("นอกหมวดงาน")).toBeInTheDocument();
    expect(screen.queryByText("ตรงกับงาน")).not.toBeInTheDocument();
  });

  it("raise-PR form chip renders the letter-code for the pinned WP", () => {
    render(
      <PurchaseRequestForm
        workPackage={{ id: "w1", code: "WP-208", name: "งานประปา", categoryCode: "W04" }}
        projectId="p1"
        userId="u1"
        catalogItems={[]}
        categories={[]}
      />,
    );
    expect(screen.getByText("W-208")).toBeInTheDocument();
    expect(screen.queryByText("WP-208")).not.toBeInTheDocument();
  });

  it("phone PO basket card + checkout sheet line render the letter-code", () => {
    const rows = [
      gridRow({
        id: "aaaaaaaa-1111-4111-8111-111111111111",
        status: "approved",
        pr_number: 9,
        wp_code: "WP-33",
        wp_category_code: "W02",
      }),
    ];
    render(
      <PhonePoBasket
        records={rows}
        suppliers={[{ id: "11111111-1111-4111-8111-111111111111", name: "ร้าน A", phone: null }]}
      />,
    );
    // Basket card (S = W02 letter).
    expect(screen.getByText(/S-33/)).toBeInTheDocument();
    // Add to basket → open the checkout sheet → the sheet line letter-codes too.
    fireEvent.click(screen.getByRole("button", { name: /เพิ่มเข้าใบสั่งซื้อ/ }));
    fireEvent.click(screen.getByRole("button", { name: /ใบสั่งซื้อ · 1 รายการ/ }));
    expect(screen.getAllByText(/S-33/).length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByText(/WP-33/)).not.toBeInTheDocument();
  });
});
