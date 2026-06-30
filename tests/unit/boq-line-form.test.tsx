// Writing failing test first.
//
// Spec 237 (ADR 0066 / S10-U2) — the add/edit BOQ line form. It reuses the S1
// catalog_units picker (with the free-text escape), the S7 ScopedCatalogItemPicker
// (unscoped → full catalog), and an optional work-category <select>. Submitting
// calls the supplied action with the typed payload. The actions are mocked.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

import { BoqLineForm } from "@/components/features/boq/boq-line-form";
import type { PurchaseRequestCatalogItem } from "@/components/features/purchasing/purchase-request-form";

const TEMPLATE = "11111111-1111-4111-8111-111111111111";

const items: PurchaseRequestCatalogItem[] = [
  {
    id: "s1",
    categoryId: "cat-steel",
    categoryName: "เหล็กเสริม",
    baseItem: "เหล็กข้ออ้อย",
    specAttrs: "12 มิล",
    unit: "ท่อน",
    thumbnailUrl: null,
    productCode: "010120",
  },
];
const categories = [{ id: "cat-steel", name: "เหล็กเสริม" }];
const units = [
  { code: "ตารางเมตร", displayName: "ตารางเมตร" },
  { code: "ชิ้น", displayName: "ชิ้น" },
];
const workCategories = [
  { id: "wc-1", code: "W01", name: "งานโครงสร้าง", isActive: true },
  { id: "wc-2", code: "W02", name: "งานสถาปัตย์", isActive: true },
];

function renderAdd(action: ReturnType<typeof vi.fn>) {
  render(
    <BoqLineForm
      boqTemplateId={TEMPLATE}
      items={items}
      categories={categories}
      units={units}
      workCategories={workCategories}
      onSubmit={action as never}
    />,
  );
}

beforeEach(() => {
  mockRefresh.mockReset();
});

describe("BoqLineForm (spec 237)", () => {
  it("renders the unit picker, item picker, and work-category select", () => {
    renderAdd(vi.fn());
    // S1 unit picker (the select offers the threaded units + the free-text escape).
    expect(screen.getByLabelText("หน่วยนับ")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "ตารางเมตร" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "อื่น ๆ (ระบุเอง)" })).toBeInTheDocument();
    // S7 ScopedCatalogItemPicker trigger.
    expect(screen.getByRole("button", { name: /เลือกวัสดุจากแคตตาล็อก/ })).toBeInTheDocument();
    // The work-category select (optional).
    const wcSelect = screen.getByLabelText("หมวดงาน");
    expect(wcSelect).toBeInTheDocument();
    expect(screen.getByRole("option", { name: /งานโครงสร้าง/ })).toBeInTheDocument();
  });

  it("submits a free-text line with the typed payload", async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    renderAdd(action);

    fireEvent.change(screen.getByLabelText("รายละเอียด"), {
      target: { value: "งานเทพื้น" },
    });
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("หน่วยนับ"), { target: { value: "ตารางเมตร" } });
    fireEvent.change(screen.getByLabelText(/ค่าวัสดุ/), { target: { value: "250" } });
    fireEvent.change(screen.getByLabelText(/ค่าแรง/), { target: { value: "120" } });

    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));

    await waitFor(() =>
      expect(action).toHaveBeenCalledWith(
        expect.objectContaining({
          boqTemplateId: TEMPLATE,
          description: "งานเทพื้น",
          qty: 10,
          unit: "ตารางเมตร",
          catalogItemId: "",
          workCategoryId: "",
          materialRate: 250,
          laborRate: 120,
          variationType: "standard",
          exclusivityGroup: "",
        }),
      ),
    );
  });

  it("passes the chosen work-category id in the payload", async () => {
    const action = vi.fn().mockResolvedValue({ ok: true });
    renderAdd(action);

    fireEvent.change(screen.getByLabelText("รายละเอียด"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("หน่วยนับ"), { target: { value: "ชิ้น" } });
    fireEvent.change(screen.getByLabelText("หมวดงาน"), { target: { value: "wc-1" } });

    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));

    await waitFor(() =>
      expect(action).toHaveBeenCalledWith(expect.objectContaining({ workCategoryId: "wc-1" })),
    );
  });

  it("reveals the free-text unit input via the escape hatch", () => {
    renderAdd(vi.fn());
    fireEvent.change(screen.getByLabelText("หน่วยนับ"), { target: { value: "__other__" } });
    expect(screen.getByLabelText("ระบุหน่วยนับ")).toBeInTheDocument();
  });

  it("shows the action error inline and does not refresh", async () => {
    const action = vi.fn().mockResolvedValue({ ok: false, error: "ไม่มีสิทธิ์ทำรายการนี้" });
    renderAdd(action);
    fireEvent.change(screen.getByLabelText("รายละเอียด"), { target: { value: "x" } });
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "1" } });
    fireEvent.change(screen.getByLabelText("หน่วยนับ"), { target: { value: "ชิ้น" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("ไม่มีสิทธิ์ทำรายการนี้"),
    );
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
