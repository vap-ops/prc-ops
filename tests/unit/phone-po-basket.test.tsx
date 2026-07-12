// Spec 118 — the phone add-to-PO basket: add approved tickets, a basket bar
// reveals with the count, tapping it opens the checkout sheet, lines can be
// dropped from inside the sheet.

import { describe, expect, it, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("next/navigation", async () => await import("../helpers/router-refresh"));
const { createPurchaseOrderMock, createSupplierMock } = vi.hoisted(() => ({
  createPurchaseOrderMock: vi.fn(),
  createSupplierMock: vi.fn(),
}));
vi.mock("@/app/requests/actions", () => ({
  createPurchaseOrder: createPurchaseOrderMock,
  createSupplier: createSupplierMock,
}));

import { PhonePoBasket } from "@/components/features/purchasing/phone-po-basket";
import type { ProcurementGridRecord } from "@/components/features/purchasing/procurement-grid";

const R1 = "aaaaaaaa-1111-4111-8111-111111111111";
const R2 = "bbbbbbbb-2222-4222-8222-222222222222";
const SUPPLIERS = [{ id: "11111111-1111-4111-8111-111111111111", name: "ร้าน A", phone: null }];

function rec(over: Partial<ProcurementGridRecord>): ProcurementGridRecord {
  return {
    id: "x",
    purchase_order_id: null,
    po_number: null,
    pr_number: 1,
    item_description: "item",
    status: "approved",
    priority: "normal",
    quantity: 1,
    unit: "ชิ้น",
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
    wp_category_code: null,
    wp_name: null,
    project_id: null,
    requested_by: null,
    requester_name: null,
    notes: null,
    decision_comment: null,
    received_by: null,
    delivery_note: null,
    doc_count: 0,
    category_id: null,
    category_name: null,
    ...over,
  };
}

const RECORDS = [
  rec({
    id: R1,
    pr_number: 10,
    item_description: "ปูน",
    quantity: 5,
    unit: "ถุง",
    wp_code: "WP52",
  }),
  rec({ id: R2, pr_number: 11, item_description: "ทราย", quantity: 2, unit: "คิว" }),
];

function setup() {
  return render(<PhonePoBasket records={RECORDS} suppliers={SUPPLIERS} />);
}

describe("PhonePoBasket", () => {
  beforeEach(() => {
    createPurchaseOrderMock.mockReset();
    createSupplierMock.mockReset();
  });

  it("renders an add button per ticket and no basket bar until something is added", () => {
    setup();
    expect(screen.getAllByRole("button", { name: /เพิ่มเข้าใบสั่งซื้อ/ })).toHaveLength(2);
    expect(screen.queryByRole("button", { name: /ดำเนินการ/ })).toBeNull();
  });

  it("reveals the basket bar with a running count as tickets are added", () => {
    setup();
    const adds = screen.getAllByRole("button", { name: /เพิ่มเข้าใบสั่งซื้อ/ });
    fireEvent.click(adds[0]!);
    expect(screen.getByRole("button", { name: /ใบสั่งซื้อ · 1 รายการ/ })).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /เพิ่มเข้าใบสั่งซื้อ/ })[0]!);
    expect(screen.getByRole("button", { name: /ใบสั่งซื้อ · 2 รายการ/ })).toBeInTheDocument();
  });

  it("opens the checkout sheet from the basket bar", () => {
    setup();
    screen
      .getAllByRole("button", { name: /เพิ่มเข้าใบสั่งซื้อ/ })
      .forEach((b) => fireEvent.click(b));
    fireEvent.click(screen.getByRole("button", { name: /ดำเนินการ/ }));
    // the sheet's supplier select is unique to the checkout sheet
    expect(screen.getByLabelText("ผู้ขาย")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /สร้างใบสั่งซื้อ \(2\)/ })).toBeInTheDocument();
  });

  it("drops a line from inside the sheet", async () => {
    setup();
    screen
      .getAllByRole("button", { name: /เพิ่มเข้าใบสั่งซื้อ/ })
      .forEach((b) => fireEvent.click(b));
    fireEvent.click(screen.getByRole("button", { name: /ดำเนินการ/ }));
    const removes = screen.getAllByLabelText(/ออกจากใบสั่งซื้อ/);
    expect(removes).toHaveLength(2);
    fireEvent.click(removes[0]!);
    await waitFor(() => expect(screen.getAllByLabelText(/ออกจากใบสั่งซื้อ/)).toHaveLength(1));
  });
});
