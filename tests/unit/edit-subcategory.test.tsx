// Writing failing test first.
//
// Spec 219 U2 — per-row edit / deactivate on the /catalog/subcategories manage
// screen. Code is immutable; name + sort_order are editable; "เอาออก" sets
// is_active=false (reversible soft delete). update_catalog_subcategory carries
// the role gate. Mocked action + router.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpdate, mockRefresh } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/catalog/actions", () => ({ updateCatalogSubcategory: mockUpdate }));

import { EditSubcategory, type Subcategory } from "@/components/features/catalog/edit-subcategory";

const sub: Subcategory = {
  id: "s1",
  category: "steel_fixing",
  code: "02",
  name: "อุปกรณ์ยึด",
  sortOrder: 0,
  isActive: true,
};

beforeEach(() => {
  mockUpdate.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

function open() {
  render(<EditSubcategory subcategory={sub} />);
  fireEvent.click(screen.getByRole("button", { name: /แก้ไข/ }));
}

describe("EditSubcategory (spec 219 U2)", () => {
  it("opens pre-filled with the name (code shown read-only)", () => {
    open();
    expect(screen.getByLabelText("ชื่อหมวดย่อย")).toHaveValue("อุปกรณ์ยึด");
    expect(screen.getByText("02")).toBeInTheDocument();
  });

  it("saves the edited name (is_active stays true) and refreshes", async () => {
    open();
    fireEvent.change(screen.getByLabelText("ชื่อหมวดย่อย"), {
      target: { value: "อุปกรณ์ยึดเหล็ก" },
    });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));

    await waitFor(() =>
      expect(mockUpdate).toHaveBeenCalledWith({
        id: "s1",
        name: "อุปกรณ์ยึดเหล็ก",
        sortOrder: 0,
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
        id: "s1",
        name: "อุปกรณ์ยึด",
        sortOrder: 0,
        isActive: false,
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });
});
