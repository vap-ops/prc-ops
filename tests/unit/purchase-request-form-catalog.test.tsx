// Spec 180 (pro-max UX) — the PR item is catalog-only and picked through a
// bottom-sheet: a trigger opens a sheet with a search box, category filter
// chips, and thumbnail result rows. Picking links catalog_item_id (spec 179)
// and derives the description + unit. An item not in the catalog is registered
// first at ตั้งค่า → แคตตาล็อก (no inline add) — a no-match search points there.

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

// Spec 221 cleanup — managed categories (id + name), user-created via the
// catalog_categories table (NOT the vestigial item_category enum).
const CAT_STEEL = "cat-steel";
const CAT_PAINT = "cat-paint";
const CATEGORIES = [
  { id: CAT_STEEL, name: "เหล็กเสริม" },
  { id: CAT_PAINT, name: "งานสี" },
];

const CATALOG: PurchaseRequestCatalogItem[] = [
  {
    id: STEEL,
    categoryId: CAT_STEEL,
    categoryName: "เหล็กเสริม",
    baseItem: "เหล็กข้ออ้อย",
    specAttrs: "12 มิล",
    unit: "ท่อน",
    thumbnailUrl: null,
  },
  {
    id: PAINT,
    categoryId: CAT_PAINT,
    categoryName: "งานสี",
    baseItem: "สีเคลือบกึ่งเงา",
    specAttrs: null,
    unit: "แกลลอน",
    thumbnailUrl: null,
  },
];

function renderForm() {
  render(
    <PurchaseRequestForm
      workPackage={WP}
      projectId={PROJECT}
      userId={USER}
      catalogItems={CATALOG}
      categories={CATEGORIES}
    />,
  );
}

const TRIGGER = "เลือกวัสดุจากแคตตาล็อก";

async function openAndSearch(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(screen.getByRole("button", { name: TRIGGER }));
  await user.type(screen.getByLabelText("ค้นหาวัสดุ"), text);
}

describe("PurchaseRequestForm catalog picker — pro-max (spec 180)", () => {
  it("has no free-text item input — a trigger opens the picker", () => {
    renderForm();
    expect(screen.queryByLabelText("รายการวัสดุ")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: TRIGGER })).toBeInTheDocument();
    // The search lives in the sheet — not present until the trigger is tapped.
    expect(screen.queryByLabelText("ค้นหาวัสดุ")).not.toBeInTheDocument();
  });

  it("opens the sheet and filters as the requester types", async () => {
    const user = userEvent.setup();
    renderForm();
    await openAndSearch(user, "เหล็ก");
    expect(screen.getByRole("button", { name: /เหล็กข้ออ้อย/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /สีเคลือบ/ })).not.toBeInTheDocument();
  });

  it("filters by a managed category chip (group by category_id, not the enum)", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: TRIGGER }));
    // ทั้งหมด shows both; picking the งานสี (managed) category drops the steel item.
    await user.click(screen.getByRole("radio", { name: "งานสี" }));
    expect(screen.getByRole("button", { name: /สีเคลือบ/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /เหล็กข้ออ้อย/ })).not.toBeInTheDocument();
  });

  it("selecting a result closes the sheet and shows the chosen item", async () => {
    const user = userEvent.setup();
    renderForm();
    await openAndSearch(user, "เหล็ก");
    await user.click(screen.getByRole("button", { name: /เหล็กข้ออ้อย/ }));

    expect(screen.getByText(/เหล็กข้ออ้อย 12 มิล/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เปลี่ยน" })).toBeInTheDocument();
    // Sheet closed: the search is gone.
    expect(screen.queryByLabelText("ค้นหาวัสดุ")).not.toBeInTheDocument();
  });

  it("keeps submit disabled until a catalog item is chosen", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("จำนวน"), "10");
    await user.selectOptions(screen.getByLabelText("เหตุผลที่ต้องสั่งซื้อ"), "unplanned_miss");

    const submit = screen.getByRole("button", { name: "ส่งคำขอซื้อ" });
    expect(submit).toBeDisabled();

    await openAndSearch(user, "สี");
    await user.click(screen.getByRole("button", { name: /สีเคลือบ/ }));
    expect(submit).toBeEnabled();
  });

  it("submits the linked catalog item with its derived description + unit", async () => {
    const user = userEvent.setup();
    renderForm();
    await openAndSearch(user, "เหล็ก");
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
    await openAndSearch(user, "ไม่มีของนี้แน่นอน");
    expect(screen.getByText(/เพิ่มวัสดุ/)).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /แคตตาล็อก/ });
    expect(link).toHaveAttribute("href", "/catalog");
  });
});
