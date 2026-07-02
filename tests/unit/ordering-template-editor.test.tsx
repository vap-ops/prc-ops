// Spec 245 U4 — the stripped-down template editor for /settings/ordering-templates
// /[templateId]: item + qty + note rows only. NO WP column / multi-WP fan-out
// (templates have no project or WPs, D5) and NO lifecycle actions (always
// editable — no submit/approve/reject/convert, D2). Saves through the
// template-aware BULK action (add_supply_plan_lines under the hood — never the
// singular add_supply_plan_line, the U1 reviewer trap); removes saved rows via
// removeTemplateLine. Mocked actions + router.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockBulkAdd, mockRemove, mockRefresh } = vi.hoisted(() => ({
  mockBulkAdd: vi.fn(),
  mockRemove: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/settings/ordering-templates/actions", () => ({
  bulkAddTemplateLines: mockBulkAdd,
  removeTemplateLine: mockRemove,
}));

import {
  OrderingTemplateEditor,
  type TemplateEditorLine,
} from "@/components/features/supply-plan/ordering-template-editor";

const catalogItems = [
  {
    id: "ci1",
    categoryId: "cat-elec",
    categoryName: "งานไฟฟ้า",
    baseItem: "สายไฟ NYY",
    specAttrs: "3x6",
    unit: "ม้วน",
    thumbnailUrl: null,
  },
];
const categories = [
  { id: "cat-elec", name: "งานไฟฟ้า" },
  { id: "cat-steel", name: "เหล็กเสริม" },
];

const elecLine: TemplateEditorLine = {
  id: "l1",
  categoryId: "cat-elec",
  baseItem: "สายไฟ NYY",
  specAttrs: "3x6",
  unit: "ม้วน",
  qty: 10,
};
const steelLine: TemplateEditorLine = {
  id: "l2",
  categoryId: "cat-steel",
  baseItem: "เหล็กเส้น",
  specAttrs: null,
  unit: "เส้น",
  qty: 5,
};

function pickFirstMaterial() {
  fireEvent.click(screen.getByRole("button", { name: "เลือกวัสดุจากแคตตาล็อก" }));
  fireEvent.click(screen.getByRole("button", { name: /สายไฟ NYY/ }));
}

beforeEach(() => {
  mockBulkAdd.mockReset().mockResolvedValue({ ok: true, count: 1 });
  mockRemove.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

function renderEditor(lines: TemplateEditorLine[] = []) {
  render(
    <OrderingTemplateEditor
      templateId="tpl1"
      lines={lines}
      catalogItems={catalogItems}
      categories={categories}
    />,
  );
}

describe("OrderingTemplateEditor (spec 245 U4)", () => {
  it("shows no WP column, no multi-WP affordance, and no lifecycle actions (D2/D5)", () => {
    renderEditor([elecLine]);
    // No WP anywhere: no per-row งาน select, no ＋หลายงาน fan-out.
    expect(screen.queryByLabelText("งาน")).toBeNull();
    expect(screen.queryByRole("button", { name: /หลายงาน/ })).toBeNull();
    // No lifecycle: templates are always editable — never submitted/approved.
    expect(screen.queryByRole("button", { name: "ส่งอนุมัติ" })).toBeNull();
    expect(screen.queryByRole("button", { name: "อนุมัติ" })).toBeNull();
    expect(screen.queryByRole("button", { name: "ตีกลับ" })).toBeNull();
    expect(screen.queryByRole("button", { name: /สร้างคำขอซื้อ/ })).toBeNull();
    // The editable grid is always present.
    expect(screen.getByRole("button", { name: /เพิ่มแถว/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /บันทึก/ })).toBeInTheDocument();
  });

  it("groups saved template lines by category with the qty and unit", () => {
    renderEditor([steelLine, elecLine]);
    const headings = screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual(["งานไฟฟ้า", "เหล็กเสริม"]);
    expect(screen.getByText("เหล็กเส้น")).toBeInTheDocument();
    expect(screen.getByText(/10\s*ม้วน/)).toBeInTheDocument();
  });

  it("disables save until a row has an item and a positive qty", () => {
    renderEditor();
    const save = screen.getByRole("button", { name: /บันทึก/ });
    expect(save).toBeDisabled();
    pickFirstMaterial();
    expect(save).toBeDisabled();
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "3" } });
    expect(save).toBeEnabled();
  });

  it("bulk-saves filled rows via bulkAddTemplateLines (no workPackageId in the payload)", async () => {
    renderEditor();
    pickFirstMaterial();
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "10" } });
    fireEvent.change(screen.getByLabelText("หมายเหตุ"), { target: { value: "โซนหลัง" } });
    fireEvent.click(screen.getByRole("button", { name: /บันทึก/ }));

    await waitFor(() =>
      expect(mockBulkAdd).toHaveBeenCalledWith({
        templateId: "tpl1",
        lines: [{ catalogItemId: "ci1", qty: 10, note: "โซนหลัง" }],
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("surfaces a failed save as an inline error", async () => {
    mockBulkAdd.mockResolvedValue({ ok: false, error: "ไม่มีสิทธิ์" });
    renderEditor();
    pickFirstMaterial();
    fireEvent.change(screen.getByLabelText("จำนวน"), { target: { value: "2" } });
    fireEvent.click(screen.getByRole("button", { name: /บันทึก/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ไม่มีสิทธิ์");
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("removes a saved template line via removeTemplateLine", async () => {
    renderEditor([elecLine, steelLine]);
    const removeButtons = screen.getAllByRole("button", { name: "ลบ" });
    expect(removeButtons).toHaveLength(2);
    fireEvent.click(removeButtons[1]!);
    await waitFor(() =>
      expect(mockRemove).toHaveBeenCalledWith({ templateId: "tpl1", lineId: "l2" }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("adds another draft row for multi-row entry", () => {
    renderEditor();
    expect(screen.getAllByRole("button", { name: "เลือกวัสดุจากแคตตาล็อก" })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /เพิ่มแถว/ }));
    expect(screen.getAllByRole("button", { name: "เลือกวัสดุจากแคตตาล็อก" })).toHaveLength(2);
  });
});
