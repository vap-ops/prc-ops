// Writing failing test first.
//
// Spec 219 U2 — "add subcategory" on the /catalog/subcategories manage screen.
// Back-office picks a main category, a 2-digit code and a name; the
// create_catalog_subcategory RPC carries the role gate + (category, code)
// uniqueness. Mocked action + router.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate, mockRefresh } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/catalog/actions", () => ({ createCatalogSubcategory: mockCreate }));

import { AddSubcategory } from "@/components/features/catalog/add-subcategory";

beforeEach(() => {
  mockCreate.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

function open() {
  render(<AddSubcategory />);
  fireEvent.click(screen.getByRole("button", { name: "เพิ่มหมวดย่อย" }));
}

function fill() {
  fireEvent.change(screen.getByLabelText("หมวดหมู่หลัก"), { target: { value: "steel_fixing" } });
  fireEvent.change(screen.getByLabelText(/รหัสหมวดย่อย/), { target: { value: "02" } });
  fireEvent.change(screen.getByLabelText("ชื่อหมวดย่อย"), { target: { value: "อุปกรณ์ยึด" } });
}

describe("AddSubcategory (spec 219 U2)", () => {
  it("disables submit until category, a 2-digit code and a name are set", () => {
    open();
    const submit = screen.getByRole("button", { name: "บันทึก" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText("หมวดหมู่หลัก"), { target: { value: "steel_fixing" } });
    fireEvent.change(screen.getByLabelText(/รหัสหมวดย่อย/), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("ชื่อหมวดย่อย"), { target: { value: "x" } });
    // a 1-digit code is not yet valid
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/รหัสหมวดย่อย/), { target: { value: "02" } });
    expect(submit).toBeEnabled();
  });

  it("creates the subcategory with the entered values and refreshes", async () => {
    open();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));

    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({
        category: "steel_fixing",
        code: "02",
        name: "อุปกรณ์ยึด",
        sortOrder: 0,
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("shows the action error inline and does not refresh", async () => {
    mockCreate.mockResolvedValue({ ok: false, error: "รหัสหมวดย่อยนี้ถูกใช้แล้ว" });
    open();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("รหัสหมวดย่อยนี้ถูกใช้แล้ว"),
    );
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
