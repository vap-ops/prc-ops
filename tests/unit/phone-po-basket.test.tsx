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
    category_match: null,
    wp_name: null,
    project_id: null,
    project_name: null,
    requested_by: null,
    requester_name: null,
    notes: null,
    decision_comment: null,
    received_by: null,
    delivery_note: null,
    doc_count: 0,
    doc_coverage: null,
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

// Feedback #19206 — the basket bundles approved rows into ONE purchase order and
// pools every project, so it is the phone half of the same "two sites read as one
// merged list" defect fixed on the desktop grid (procurement-grid-project-label).
describe("PhonePoBasket — per-row project label (feedback #19206)", () => {
  it("names each row's own project", () => {
    render(
      <PhonePoBasket
        records={[
          rec({ id: R1, item_description: "เหล็กเส้น", project_name: "TFM นายาว เพชรบูรณ์" }),
          rec({ id: R2, item_description: "สีรองพื้น", project_name: "TFM กกกระทอน เพชรบูรณ์" }),
        ]}
        suppliers={SUPPLIERS}
      />,
    );

    const steel = screen.getByText("เหล็กเส้น").closest("li");
    expect(steel).not.toBeNull();
    expect(steel!.textContent).toContain("TFM นายาว เพชรบูรณ์");
    expect(steel!.textContent).not.toContain("TFM กกกระทอน");

    const paint = screen.getByText("สีรองพื้น").closest("li");
    expect(paint).not.toBeNull();
    expect(paint!.textContent).toContain("TFM กกกระทอน เพชรบูรณ์");
    expect(paint!.textContent).not.toContain("TFM นายาว");
  });

  it("does not double the separator on a row with no PR number and no WP code", () => {
    // The quantity tail opens with its own " · ", so a project label that always
    // appended one produced "TFM … ·  · 1 ชิ้น" for this shape. The fixture is
    // deliberately the sparse row, not the typical one.
    render(
      <PhonePoBasket
        records={[
          rec({
            id: R1,
            item_description: "เหล็กเส้น",
            project_name: "TFM นายาว เพชรบูรณ์",
            pr_number: null,
            wp_code: null,
          }),
        ]}
        suppliers={SUPPLIERS}
      />,
    );
    const line = screen.getByText("เหล็กเส้น").closest("li")!.textContent!;
    expect(line).toContain("TFM นายาว เพชรบูรณ์");
    expect(line.replace(/\s+/g, " ")).not.toContain("· ·");
  });

  it("keeps the line lean when the page names no project", () => {
    render(
      <PhonePoBasket
        records={[rec({ id: R1, item_description: "เหล็กเส้น" })]}
        suppliers={SUPPLIERS}
      />,
    );
    const only = screen.getByText("เหล็กเส้น").closest("li");
    expect(only!.textContent).not.toContain("TFM");
  });
});

// Operator, 2026-08-08, over a phone basket row: "what other info should be
// available?" Every candidate was measured against the live 31 approved rows first;
// only three both VARY and are already on the record — งาน name, material category,
// and the off-category flag. All three are shown by the desktop grid and by nothing
// here, so this is parity, not new information.
//
// ⛔ Measured and rejected (do not re-add without re-measuring): priority (30 of 31
// critical), needed_by/overdue (25 filled, all one date, all overdue), price
// (amount 0 of 31 — written at PO time), supplier (0 of 31), age (all one day).
describe("PhonePoBasket — parity with the desktop grid row", () => {
  it("names the work, not just its code", () => {
    render(
      <PhonePoBasket
        records={[
          rec({
            id: R1,
            item_description: "เหล็กเส้น",
            wp_code: "P-02-02",
            wp_name: "งานทำสโตร์ชั่วคราว",
          }),
        ]}
        suppliers={SUPPLIERS}
      />,
    );
    const line = screen.getByText("เหล็กเส้น").closest("li")!.textContent!;
    expect(line).toContain("P-02-02");
    expect(line).toContain("งานทำสโตร์ชั่วคราว");
  });

  it("shows the material category — the axis the buyer shops along", () => {
    render(
      <PhonePoBasket
        records={[
          rec({ id: R1, item_description: "เหล็กเส้น", category_name: "เหล็กโครงสร้าง" }),
          rec({ id: R2, item_description: "สายไฟ", category_name: "ไฟฟ้า" }),
        ]}
        suppliers={SUPPLIERS}
      />,
    );
    expect(screen.getByText("เหล็กเส้น").closest("li")!.textContent).toContain("เหล็กโครงสร้าง");
    const wire = screen.getByText("สายไฟ").closest("li")!.textContent!;
    expect(wire).toContain("ไฟฟ้า");
    expect(wire).not.toContain("เหล็กโครงสร้าง");
  });

  it("repeats the off-category flag — amber only, exactly like the grid", () => {
    render(
      <PhonePoBasket
        records={[
          rec({ id: R1, item_description: "เหล็กเส้น", category_match: "mismatch" }),
          rec({ id: R2, item_description: "สายไฟ", category_match: "match" }),
        ]}
        suppliers={SUPPLIERS}
      />,
    );
    expect(screen.getByText("เหล็กเส้น").closest("li")!.textContent).toContain("นอกหมวดงาน");
    // A "match" verdict stays quiet — a flag on every row is not a flag.
    expect(screen.getByText("สายไฟ").closest("li")!.textContent).not.toContain("นอกหมวดงาน");
  });

  it("stays quiet on every one of the three when the record carries none of them", () => {
    render(
      <PhonePoBasket
        records={[rec({ id: R1, item_description: "เหล็กเส้น", wp_code: "P-02-02" })]}
        suppliers={SUPPLIERS}
      />,
    );
    const line = screen.getByText("เหล็กเส้น").closest("li")!.textContent!.replace(/\s+/g, " ");
    expect(line).not.toContain("นอกหมวดงาน");
    expect(line).not.toContain("· ·");
  });
});
