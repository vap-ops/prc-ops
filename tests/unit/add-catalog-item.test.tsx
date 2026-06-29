// Spec 175 U2 / 221 U3c — the "add item" form on /catalog. Back-office fills the
// managed category (by category_id) / name / unit and the item is created.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate, mockRefresh } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/catalog/actions", () => ({ createCatalogItem: mockCreate }));

import { AddCatalogItem } from "@/components/features/catalog/add-catalog-item";

const CATS = [
  { id: "cat-elec", code: "06", name: "ไฟฟ้า" },
  { id: "cat-steel", code: "01", name: "เหล็ก / อุปกรณ์ยึด" },
];

beforeEach(() => {
  mockCreate.mockReset().mockResolvedValue({ ok: true });
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

describe("AddCatalogItem (spec 175 U2 / 221 U3c)", () => {
  it("disables submit until category, name and unit are set", () => {
    open();
    const submit = screen.getByRole("button", { name: "เพิ่มรายการ" });
    expect(submit).toBeDisabled();
    fillRequired();
    expect(submit).toBeEnabled();
  });

  it("creates the item with the entered values (categoryId) and refreshes", async () => {
    open();
    fillRequired();
    fireEvent.change(screen.getByLabelText(/รหัสสินค้า/), { target: { value: "010120" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        categoryId: "cat-elec",
        baseItem: "สายไฟใหม่",
        specAttrs: "",
        unit: "ม้วน",
        note: "",
        productCode: "010120",
        subcategoryId: "",
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("shows only the chosen category's subcategories and submits the picked one", async () => {
    const SUBS = [
      { id: "se1", categoryId: "cat-elec", code: "01", name: "สายไฟ" },
      { id: "ss1", categoryId: "cat-steel", code: "01", name: "วัสดุโครงสร้าง" },
    ];
    render(<AddCatalogItem categories={CATS} subcategories={SUBS} />);
    fireEvent.click(screen.getByRole("button", { name: /เพิ่มวัสดุ/ }));
    fireEvent.change(screen.getByLabelText("หมวดหมู่"), { target: { value: "cat-elec" } });

    const subSelect = screen.getByLabelText("หมวดย่อย");
    expect(subSelect).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /สายไฟ/ })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /วัสดุโครงสร้าง/ })).toBeNull();

    fireEvent.change(screen.getByLabelText("ชื่อวัสดุ"), { target: { value: "สายไฟใหม่" } });
    fireEvent.change(screen.getByLabelText("หน่วยนับ"), { target: { value: "ม้วน" } });
    fireEvent.change(subSelect, { target: { value: "se1" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith(expect.objectContaining({ subcategoryId: "se1" })),
    );
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
