// Writing failing test first.
//
// Spec 175 U2 — the "add item" form on /catalog. Back-office fills category /
// name / spec / unit / stockable and the item is created. Mocked action + router
// (the create_catalog_item RPC carries the role gate + identity uniqueness).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate, mockRefresh } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/catalog/actions", () => ({ createCatalogItem: mockCreate }));

import { AddCatalogItem } from "@/components/features/catalog/add-catalog-item";

beforeEach(() => {
  mockCreate.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

function open() {
  render(<AddCatalogItem />);
  fireEvent.click(screen.getByRole("button", { name: /เพิ่มวัสดุ/ }));
}

function fillRequired() {
  fireEvent.change(screen.getByLabelText("หมวดหมู่"), { target: { value: "electrical" } });
  fireEvent.change(screen.getByLabelText("ชื่อวัสดุ"), { target: { value: "สายไฟใหม่" } });
  fireEvent.change(screen.getByLabelText("หน่วยนับ"), { target: { value: "ม้วน" } });
}

describe("AddCatalogItem (spec 175 U2)", () => {
  it("disables submit until category, name and unit are set", () => {
    open();
    const submit = screen.getByRole("button", { name: "เพิ่มรายการ" });
    expect(submit).toBeDisabled();
    fillRequired();
    expect(submit).toBeEnabled();
  });

  it("creates the item with the entered values and refreshes", async () => {
    open();
    fillRequired();
    // Spec 214 — an optional 6-digit product code flows through.
    fireEvent.change(screen.getByLabelText(/รหัสสินค้า/), { target: { value: "010120" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มรายการ" }));

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        category: "electrical",
        baseItem: "สายไฟใหม่",
        specAttrs: "",
        unit: "ม้วน",
        note: "",
        productCode: "010120",
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("reveals a free-text unit field when หน่วยนับ is 'อื่น ๆ' and submits it", async () => {
    open();
    fireEvent.change(screen.getByLabelText("หมวดหมู่"), { target: { value: "electrical" } });
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
