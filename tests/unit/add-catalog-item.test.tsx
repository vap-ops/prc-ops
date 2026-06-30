// Spec 175 U2 / 221 U3c / 239 U2 — the "add item" form on /catalog. Back-office
// fills the required set (หมวดหมู่ / ชื่อ / หน่วยนับ); everything else lives behind
// progressive-disclosure reveals. The save button is always live and NAMES a blank
// required field. An item can be created in extra categories, and a category can be
// created in-flow.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate, mockCreateCategory, mockRefresh } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockCreateCategory: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/catalog/actions", () => ({
  createCatalogItem: mockCreate,
  createCatalogCategory: mockCreateCategory,
}));

import { AddCatalogItem } from "@/components/features/catalog/add-catalog-item";

const CATS = [
  { id: "cat-elec", code: "06", name: "ไฟฟ้า" },
  { id: "cat-steel", code: "01", name: "เหล็กโครงสร้าง" },
];

beforeEach(() => {
  mockCreate.mockReset().mockResolvedValue({ ok: true });
  mockCreateCategory.mockReset().mockResolvedValue({ ok: true, id: "cat-new" });
  mockRefresh.mockReset();
});

function open() {
  render(<AddCatalogItem categories={CATS} />);
  fireEvent.click(screen.getByRole("button", { name: /เพิ่มวัสดุ/ }));
}

function fillRequired() {
  fireEvent.change(screen.getByLabelText("หมวดหมู่"), { target: { value: "cat-elec" } });
  fireEvent.change(screen.getByLabelText("ชื่อวัสดุ"), { target: { value: "สายไฟใหม่" } });
  fireEvent.change(screen.getByLabelText("หน่วยนับ"), { target: { value: "ม้วน" } });
}

describe("AddCatalogItem (spec 175 / 221 / 239 U2)", () => {
  it("keeps the save button live and names the missing field instead of greying out", async () => {
    open();
    const submit = screen.getByRole("button", { name: "เพิ่มรายการ" });
    expect(submit).toBeEnabled();
    // Click with nothing filled → it names the first missing field and does not submit.
    fireEvent.click(submit);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("เลือกหมวดหมู่"));
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("creates the item with the entered values (categoryId, empty secondaries) and refreshes", async () => {
    open();
    fillRequired();
    // The product code lives behind the "เพิ่มรายละเอียด" reveal.
    fireEvent.click(screen.getByRole("button", { name: /เพิ่มรายละเอียด/ }));
    // Spec 221 U4 — the code is composed: cat-elec code "06" + the 4-digit tail.
    fireEvent.change(screen.getByLabelText(/รหัสสินค้า/), { target: { value: "0120" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        categoryId: "cat-elec",
        baseItem: "สายไฟใหม่",
        specAttrs: "",
        unit: "ม้วน",
        note: "",
        productCode: "060120",
        subcategoryId: "",
        // Spec 224 — the facet defaults (off-the-shelf material, firm-supplied).
        kind: "material",
        fulfillmentMode: "off_shelf",
        ownerSupplied: false,
        // Spec 239 U2 — no extra categories chosen.
        secondaryCategoryIds: [],
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("submits chosen secondary memberships from the multi-category control", async () => {
    open();
    fillRequired();
    fireEvent.click(screen.getByRole("button", { name: /เพิ่มรายละเอียด/ }));
    // The other category (not the primary cat-elec) is offered as a secondary.
    fireEvent.click(screen.getByLabelText("เหล็กโครงสร้าง"));
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({ secondaryCategoryIds: ["cat-steel"] }),
      ),
    );
  });

  it("creates a category in-flow and selects it", async () => {
    open();
    fireEvent.change(screen.getByLabelText("หมวดหมู่"), { target: { value: "__add_category__" } });
    fireEvent.change(screen.getByLabelText("รหัสหมวดหมู่ใหม่"), { target: { value: "15" } });
    fireEvent.change(screen.getByLabelText("ชื่อหมวดหมู่ใหม่"), { target: { value: "งานใหม่" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มหมวดหมู่" }));

    await waitFor(() =>
      expect(mockCreateCategory).toHaveBeenCalledWith({
        code: "15",
        name: "งานใหม่",
        sortOrder: 0,
      }),
    );
    // The new category becomes the selected primary.
    await waitFor(() => expect(screen.getByLabelText("หมวดหมู่")).toHaveValue("cat-new"));
  });

  it("reveals a free-text unit field when หน่วยนับ is 'อื่น ๆ' and submits it", async () => {
    open();
    fireEvent.change(screen.getByLabelText("หมวดหมู่"), { target: { value: "cat-elec" } });
    fireEvent.change(screen.getByLabelText("ชื่อวัสดุ"), { target: { value: "ของแปลก" } });
    fireEvent.change(screen.getByLabelText("หน่วยนับ"), { target: { value: "__other__" } });
    fireEvent.change(screen.getByLabelText("ระบุหน่วยนับ"), { target: { value: "เข่ง" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ unit: "เข่ง" })),
    );
  });

  it("shows the action error inline and does not refresh", async () => {
    mockCreate.mockResolvedValue({ ok: false, error: "รายการนี้มีอยู่แล้ว (ชื่อ + สเปกซ้ำ)" });
    open();
    fillRequired();
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("รายการนี้มีอยู่แล้ว"));
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
