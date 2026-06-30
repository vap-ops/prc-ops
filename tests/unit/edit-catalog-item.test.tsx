// Writing failing test first.
//
// Spec 175 U3 / 239 U2 — per-row edit / deactivate on /catalog. The form opens
// pre-filled; populated detail fields (spec, product code, secondary memberships)
// auto-reveal so an edit never hides data. Mocked actions + router (the
// update_catalog_item / set_catalog_item_active RPCs carry the gates).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogItem } from "@/components/features/catalog/catalog-list";

const { mockUpdate, mockSetActive, mockCreateCategory, mockRefresh } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockSetActive: vi.fn(),
  mockCreateCategory: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/catalog/actions", () => ({
  updateCatalogItem: mockUpdate,
  setCatalogItemActive: mockSetActive,
  createCatalogCategory: mockCreateCategory,
}));

import { EditCatalogItem } from "@/components/features/catalog/edit-catalog-item";

// Spec 221 U4 — the category's 2-digit code is the product-code prefix; this
// item's code "010120" is category "01" + the "0120" sequence tail.
const CATS = [
  { id: "cat-steel", code: "01", name: "เหล็กโครงสร้าง" },
  { id: "cat-roof", code: "04", name: "หลังคา / ครอบ" },
];

const item: CatalogItem = {
  id: "c1",
  categoryId: "cat-steel",
  baseItem: "สายไฟเดิม",
  specAttrs: "2x4",
  unit: "ม้วน",
  productCode: "010120",
  note: "",
  kind: "material",
  fulfillmentMode: "off_shelf",
  ownerSupplied: false,
};

beforeEach(() => {
  mockUpdate.mockReset().mockResolvedValue({ ok: true });
  mockSetActive.mockReset().mockResolvedValue({ ok: true });
  mockCreateCategory.mockReset().mockResolvedValue({ ok: true, id: "cat-new" });
  mockRefresh.mockReset();
});

function open(it: CatalogItem = item) {
  render(<EditCatalogItem item={it} categories={CATS} />);
  fireEvent.click(screen.getByRole("button", { name: /แก้ไข/ }));
}

describe("EditCatalogItem (spec 175 U3 / 239 U2)", () => {
  it("opens pre-filled and auto-reveals the populated product code", () => {
    open();
    expect(screen.getByLabelText("ชื่อวัสดุ")).toHaveValue("สายไฟเดิม");
    expect(screen.getByLabelText("หน่วยนับ")).toHaveValue("ม้วน");
    // Spec 221 U4 — only the sequence tail is editable; the prefix is derived.
    // It is visible because the populated-code item auto-opens เพิ่มรายละเอียด.
    expect(screen.getByLabelText(/รหัสสินค้า/)).toHaveValue("0120");
  });

  it("saves the edited values (incl. empty secondaries) and refreshes", async () => {
    open();
    fireEvent.change(screen.getByLabelText("ชื่อวัสดุ"), { target: { value: "สายไฟใหม่" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({
        id: "c1",
        categoryId: "cat-steel",
        baseItem: "สายไฟใหม่",
        specAttrs: "2x4",
        unit: "ม้วน",
        note: "",
        // Spec 221 U4 — recomposed from category "01" + the unchanged tail "0120".
        productCode: "010120",
        // Spec 219 — optional subcategory; this item has none (parked).
        subcategoryId: "",
        // Spec 224 — the facets carried through unchanged from the item.
        kind: "material",
        fulfillmentMode: "off_shelf",
        ownerSupplied: false,
        // Spec 239 U2 — no secondary memberships.
        secondaryCategoryIds: [],
        // Spec 239 U2-fields — neither field set on this item.
        searchTerms: "",
        leadTimeDays: "",
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("pre-fills the multi-category control from the item's secondary memberships", async () => {
    open({ ...item, secondaryCategoryIds: ["cat-roof"] });
    // Auto-revealed; the secondary category checkbox is checked.
    expect(screen.getByLabelText("หลังคา / ครอบ")).toBeChecked();
    // Drop it, save → the payload carries the now-empty secondary set.
    fireEvent.click(screen.getByLabelText("หลังคา / ครอบ"));
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({ secondaryCategoryIds: [] }),
      ),
    );
  });

  it("deactivates (soft delete) and refreshes", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /เอาออก/ }));

    await waitFor(() => expect(mockSetActive).toHaveBeenCalledWith({ id: "c1", active: false }));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("shows the action error inline and does not refresh", async () => {
    mockUpdate.mockResolvedValue({ ok: false, error: "รายการนี้มีอยู่แล้ว (ชื่อ + สเปกซ้ำ)" });
    open();
    fireEvent.change(screen.getByLabelText("ชื่อวัสดุ"), { target: { value: "ชนกับของเดิม" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("รายการนี้มีอยู่แล้ว"));
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
