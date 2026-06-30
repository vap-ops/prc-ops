// Writing failing test first.
//
// Spec 221 U3 — per-row edit / deactivate of a MAIN category on the /catalog
// taxonomy manage screen. Unlike a subcategory, the main category code IS
// editable (recode) — items key on category_id, not the code. "เอาออก" sets
// is_active=false. update_catalog_category carries the gate. Mocked action + router.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpdate, mockRefresh } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/catalog/actions", () => ({ updateCatalogCategory: mockUpdate }));

import { EditCategory, type Category } from "@/components/features/catalog/edit-category";

const cat: Category = {
  id: "c1",
  code: "01",
  name: "เหล็ก / อุปกรณ์ยึด",
  sortOrder: 1,
  isActive: true,
};

beforeEach(() => {
  mockUpdate.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

function open() {
  render(<EditCategory category={cat} />);
  fireEvent.click(screen.getByRole("button", { name: /แก้ไข/ }));
}

describe("EditCategory (spec 221 U3)", () => {
  it("opens pre-filled with the code + name (code is editable)", () => {
    open();
    expect(screen.getByLabelText(/รหัสหมวดหลัก/)).toHaveValue("01");
    expect(screen.getByLabelText("ชื่อหมวดหลัก")).toHaveValue("เหล็ก / อุปกรณ์ยึด");
  });

  it("saves the edited code + name and refreshes", async () => {
    open();
    fireEvent.change(screen.getByLabelText(/รหัสหมวดหลัก/), { target: { value: "05" } });
    fireEvent.change(screen.getByLabelText("ชื่อหมวดหลัก"), { target: { value: "เหล็ก" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({
        id: "c1",
        code: "05",
        name: "เหล็ก",
        sortOrder: 1,
        isActive: true,
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("deactivates (is_active=false) and refreshes", async () => {
    open();
    fireEvent.click(screen.getByRole("button", { name: /เอาออก/ }));
    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({
        id: "c1",
        code: "01",
        name: "เหล็ก / อุปกรณ์ยึด",
        sortOrder: 1,
        isActive: false,
      }),
    );
  });
});
