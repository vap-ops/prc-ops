// Spec 361 U6 — rename an equipment category (หมวดอุปกรณ์).
//
// The list has been add-only since spec 141: `createEquipmentCategory` had no
// sibling, so a typo'd หมวด was permanent. The DB was already ahead — an
// `equipment_categories update by back office` policy admits the same five
// roles, and `authenticated` holds a column-scoped UPDATE grant on exactly
// (name, parent_id) — so this is a UI-only unit, no migration.
//
// Deactivate is NOT part of it: the table has no is_active column, so retiring
// a category still needs schema (spec 361 U6's other half, queued behind the
// schema lane).

import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  renameEquipmentCategory: vi.fn(async () => ({ ok: true as const })),
}));

vi.mock("@/app/equipment/actions", () => actions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));

import { EditCategoryRow } from "@/components/features/equipment/edit-category-row";

const CATEGORY = { id: "11111111-1111-4111-8111-111111111111", name: "รถขุด" };

beforeEach(() => {
  actions.renameEquipmentCategory.mockClear();
  actions.renameEquipmentCategory.mockResolvedValue({ ok: true });
});

describe("EditCategoryRow", () => {
  it("shows the category name and how many items sit in it", () => {
    render(<EditCategoryRow category={CATEGORY} itemCount={4} />);
    expect(screen.getByText("รถขุด")).toBeInTheDocument();
    expect(screen.getByText(/4 รายการ/)).toBeInTheDocument();
  });

  it("renames through the action, sending the trimmed name with the id", async () => {
    render(<EditCategoryRow category={CATEGORY} itemCount={0} />);
    fireEvent.click(screen.getByRole("button", { name: /เปลี่ยนชื่อ รถขุด/ }));
    fireEvent.change(screen.getByLabelText(/ชื่อหมวดหมู่/), {
      target: { value: "  รถขุดตีนตะขาบ  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(actions.renameEquipmentCategory).toHaveBeenCalledTimes(1));
    expect(actions.renameEquipmentCategory).toHaveBeenCalledWith({
      id: CATEGORY.id,
      name: "รถขุดตีนตะขาบ",
    });
  });

  it("refuses to submit an unchanged or blank name — no pointless write", async () => {
    render(<EditCategoryRow category={CATEGORY} itemCount={0} />);
    fireEvent.click(screen.getByRole("button", { name: /เปลี่ยนชื่อ รถขุด/ }));
    expect(screen.getByRole("button", { name: "บันทึก" })).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/ชื่อหมวดหมู่/), { target: { value: "   " } });
    expect(screen.getByRole("button", { name: "บันทึก" })).toBeDisabled();
    expect(actions.renameEquipmentCategory).not.toHaveBeenCalled();
  });

  it("keeps the editor open and shows the reason when the write is refused", async () => {
    actions.renameEquipmentCategory.mockResolvedValueOnce({
      ok: false,
      error: "ไม่มีสิทธิ์แก้ไขหมวดหมู่",
    } as never);
    render(<EditCategoryRow category={CATEGORY} itemCount={0} />);
    fireEvent.click(screen.getByRole("button", { name: /เปลี่ยนชื่อ รถขุด/ }));
    fireEvent.change(screen.getByLabelText(/ชื่อหมวดหมู่/), { target: { value: "รถขุดใหม่" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() => expect(screen.getByText("ไม่มีสิทธิ์แก้ไขหมวดหมู่")).toBeInTheDocument());
    expect(screen.getByLabelText(/ชื่อหมวดหมู่/)).toBeInTheDocument();
  });
});
