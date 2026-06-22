// Spec 180 — the PR item is catalog-only + searchable. The free-text item box
// is gone: the requester searches the catalog (spec 175 master) and picks a
// result, which links catalog_item_id (spec 179) and derives the description +
// unit. An item that isn't in the catalog must be registered first at
// ตั้งค่า → แคตตาล็อก (no inline add) — a no-match search points there.

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", async () => await import("../helpers/router-refresh"));

vi.mock("@/app/requests/actions", () => ({
  createPurchaseRequest: vi.fn(async () => ({ ok: true, id: "x" })),
  decidePurchaseRequest: vi.fn(async () => ({ ok: true })),
}));

import { createPurchaseRequest } from "@/app/requests/actions";
import {
  PurchaseRequestForm,
  type PurchaseRequestCatalogItem,
} from "@/components/features/purchasing/purchase-request-form";

const WP = { id: "00000000-0000-0000-0000-000000000001", code: "WP01", name: "งานปักฝัง" };
const PROJECT = "00000000-0000-0000-0000-000000000002";
const USER = "00000000-0000-0000-0000-0000000000aa";

const STEEL = "11111111-1111-1111-1111-111111111111";
const PAINT = "22222222-2222-2222-2222-222222222222";

const CATALOG: PurchaseRequestCatalogItem[] = [
  {
    id: STEEL,
    category: "steel_fixing",
    baseItem: "เหล็กข้ออ้อย",
    specAttrs: "12 มิล",
    unit: "ท่อน",
  },
  { id: PAINT, category: "paint", baseItem: "สีเคลือบกึ่งเงา", specAttrs: null, unit: "แกลลอน" },
];

function renderForm() {
  render(
    <PurchaseRequestForm
      workPackage={WP}
      projectId={PROJECT}
      userId={USER}
      catalogItems={CATALOG}
    />,
  );
}

describe("PurchaseRequestForm catalog-only search (spec 180)", () => {
  it("has no free-text item input — the catalog search replaces it", () => {
    renderForm();
    expect(screen.queryByLabelText("รายการวัสดุ")).not.toBeInTheDocument();
    expect(screen.getByLabelText("ค้นหาวัสดุจากแคตตาล็อก")).toBeInTheDocument();
  });

  it("filters the catalog as the requester types", async () => {
    const user = userEvent.setup();
    renderForm();
    const search = screen.getByLabelText("ค้นหาวัสดุจากแคตตาล็อก");

    await user.type(search, "เหล็ก");
    expect(screen.getByRole("button", { name: /เหล็กข้ออ้อย/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /สีเคลือบ/ })).not.toBeInTheDocument();
  });

  it("selecting a result shows the chosen item and lets it be changed", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("ค้นหาวัสดุจากแคตตาล็อก"), "เหล็ก");
    await user.click(screen.getByRole("button", { name: /เหล็กข้ออ้อย/ }));

    // The chosen item is shown read-only (no free-text edit) with the unit.
    expect(screen.getByText(/เหล็กข้ออ้อย 12 มิล/)).toBeInTheDocument();
    // The search box is replaced by a เปลี่ยน (change) affordance.
    expect(screen.getByRole("button", { name: "เปลี่ยน" })).toBeInTheDocument();
    expect(screen.queryByLabelText("ค้นหาวัสดุจากแคตตาล็อก")).not.toBeInTheDocument();
  });

  it("keeps submit disabled until a catalog item is chosen", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("จำนวน"), "10");
    await user.selectOptions(screen.getByLabelText("เหตุผลที่ต้องสั่งซื้อ"), "unplanned_miss");

    const submit = screen.getByRole("button", { name: "ส่งคำขอซื้อ" });
    expect(submit).toBeDisabled();

    await user.type(screen.getByLabelText("ค้นหาวัสดุจากแคตตาล็อก"), "สี");
    await user.click(screen.getByRole("button", { name: /สีเคลือบ/ }));
    expect(submit).toBeEnabled();
  });

  it("submits the linked catalog item with its derived description + unit", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("ค้นหาวัสดุจากแคตตาล็อก"), "เหล็ก");
    await user.click(screen.getByRole("button", { name: /เหล็กข้ออ้อย/ }));
    await user.type(screen.getByLabelText("จำนวน"), "20");
    await user.selectOptions(screen.getByLabelText("เหตุผลที่ต้องสั่งซื้อ"), "unplanned_miss");
    await user.click(screen.getByRole("button", { name: "ส่งคำขอซื้อ" }));

    expect(vi.mocked(createPurchaseRequest)).toHaveBeenCalledWith(
      expect.objectContaining({
        catalogItemId: STEEL,
        itemDescription: "เหล็กข้ออ้อย 12 มิล",
        unit: "ท่อน",
        quantity: 20,
      }),
    );
  });

  it("points a no-match search at ตั้งค่า → แคตตาล็อก (register first, no inline add)", async () => {
    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText("ค้นหาวัสดุจากแคตตาล็อก"), "ไม่มีของนี้แน่นอน");
    expect(screen.getByText(/เพิ่มวัสดุ/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /แคตตาล็อก/ });
    expect(link).toHaveAttribute("href", "/catalog");
  });
});
