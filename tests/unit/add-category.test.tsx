// Writing failing test first.
//
// Spec 221 U3 — "add main category" on the /catalog taxonomy manage screen.
// Back-office sets a 2-digit code + name; create_catalog_category (spec 221 U1)
// carries the role gate + code uniqueness. Mocked action + router.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreate, mockRefresh } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/catalog/actions", () => ({ createCatalogCategory: mockCreate }));

import { AddCategory } from "@/components/features/catalog/add-category";

beforeEach(() => {
  mockCreate.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

function open() {
  render(<AddCategory />);
  fireEvent.click(screen.getByRole("button", { name: "เพิ่มหมวดหลัก" }));
}

function fill() {
  fireEvent.change(screen.getByLabelText(/รหัสหมวดหลัก/), { target: { value: "90" } });
  fireEvent.change(screen.getByLabelText("ชื่อหมวดหลัก"), { target: { value: "หมวดใหม่" } });
}

describe("AddCategory (spec 221 U3)", () => {
  it("disables submit until a 2-digit code and name are set", () => {
    open();
    const submit = screen.getByRole("button", { name: "บันทึก" });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/รหัสหมวดหลัก/), { target: { value: "9" } });
    fireEvent.change(screen.getByLabelText("ชื่อหมวดหลัก"), { target: { value: "x" } });
    expect(submit).toBeDisabled();
    fireEvent.change(screen.getByLabelText(/รหัสหมวดหลัก/), { target: { value: "90" } });
    expect(submit).toBeEnabled();
  });

  it("creates the category with the entered values and refreshes", async () => {
    open();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(mockCreate).toHaveBeenCalledWith({ code: "90", name: "หมวดใหม่", sortOrder: 0 }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("shows the action error inline and does not refresh", async () => {
    mockCreate.mockResolvedValue({ ok: false, error: "รหัสหมวดหลักนี้ถูกใช้แล้ว" });
    open();
    fill();
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("รหัสหมวดหลักนี้ถูกใช้แล้ว"),
    );
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
