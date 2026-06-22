// Writing failing test first.
//
// Spec 175 U3 — per-row edit / deactivate on /catalog. Back-office opens an
// item, changes fields and saves, or removes it (soft delete). Mocked actions +
// router (the update_catalog_item / set_catalog_item_active RPCs carry the gates).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CatalogItem } from "@/components/features/catalog/catalog-list";

const { mockUpdate, mockSetActive, mockRefresh } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockSetActive: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/catalog/actions", () => ({
  updateCatalogItem: mockUpdate,
  setCatalogItemActive: mockSetActive,
}));

import { EditCatalogItem } from "@/components/features/catalog/edit-catalog-item";

const item: CatalogItem = {
  id: "c1",
  category: "electrical",
  baseItem: "สายไฟเดิม",
  specAttrs: "2x4",
  unit: "ม้วน",
  stockable: true,
  note: "",
};

beforeEach(() => {
  mockUpdate.mockReset().mockResolvedValue({ ok: true });
  mockSetActive.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

function open() {
  render(<EditCatalogItem item={item} />);
  fireEvent.click(screen.getByRole("button", { name: /แก้ไข/ }));
}

describe("EditCatalogItem (spec 175 U3)", () => {
  it("opens pre-filled with the item's values", () => {
    open();
    expect(screen.getByLabelText("ชื่อวัสดุ")).toHaveValue("สายไฟเดิม");
    expect(screen.getByLabelText("หน่วยนับ")).toHaveValue("ม้วน");
  });

  it("saves the edited values and refreshes", async () => {
    open();
    fireEvent.change(screen.getByLabelText("ชื่อวัสดุ"), { target: { value: "สายไฟใหม่" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({
        id: "c1",
        category: "electrical",
        baseItem: "สายไฟใหม่",
        specAttrs: "2x4",
        unit: "ม้วน",
        stockable: true,
        note: "",
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
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
