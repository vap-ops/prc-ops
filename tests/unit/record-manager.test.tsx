// Writing failing test first.
//
// Spec 81: the generic RecordManager drives all three contacts screens
// (clients / suppliers / contractors). It is presentational — the entity's
// create/update server actions are injected as onCreate / onUpdate. It renders
// an add card + a per-row edit expander over a field schema.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRefresh } = vi.hoisted(() => ({ mockRefresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));

import {
  RecordManager,
  type RecordActionResult,
  type RecordFieldDef,
  type RecordRow,
} from "@/components/features/record-manager";

type CreateFn = (values: Record<string, string>) => Promise<RecordActionResult>;
type UpdateFn = (id: string, values: Record<string, string>) => Promise<RecordActionResult>;

const FIELDS: RecordFieldDef[] = [
  { key: "name", label: "ชื่อ", type: "text", maxLength: 200 },
  { key: "phone", label: "เบอร์โทร", type: "tel", maxLength: 50 },
  { key: "note", label: "หมายเหตุ", type: "textarea", maxLength: 2000 },
];

const ROWS: RecordRow[] = [
  { id: "c1", values: { name: "บริษัท ก", phone: "02-111", note: "ลูกค้าหลัก" } },
];

beforeEach(() => {
  mockRefresh.mockReset();
});

function setup(overrides: {
  rows?: RecordRow[];
  onCreate?: ReturnType<typeof vi.fn>;
  onUpdate?: ReturnType<typeof vi.fn>;
}) {
  const onCreate = overrides.onCreate ?? vi.fn().mockResolvedValue({ ok: true });
  const onUpdate = overrides.onUpdate ?? vi.fn().mockResolvedValue({ ok: true });
  render(
    <RecordManager
      addLabel="เพิ่มลูกค้า"
      fields={FIELDS}
      rows={overrides.rows ?? ROWS}
      onCreate={onCreate as unknown as CreateFn}
      onUpdate={onUpdate as unknown as UpdateFn}
    />,
  );
  return { onCreate, onUpdate };
}

describe("RecordManager", () => {
  it("shows each row's name", () => {
    setup({});
    expect(screen.getByText("บริษัท ก")).toBeInTheDocument();
  });

  it("renders a textarea for a textarea-typed field", () => {
    setup({ rows: [] });
    const note = screen.getByLabelText("หมายเหตุ");
    expect(note.tagName).toBe("TEXTAREA");
  });

  it("calls onCreate with the entered field values", async () => {
    const { onCreate } = setup({ rows: [] });
    fireEvent.change(screen.getByLabelText("ชื่อ"), { target: { value: "บริษัทใหม่" } });
    fireEvent.change(screen.getByLabelText("เบอร์โทร"), { target: { value: "081-222" } });
    fireEvent.change(screen.getByLabelText("หมายเหตุ"), { target: { value: "ทดลอง" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มลูกค้า" }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(
        expect.objectContaining({ name: "บริษัทใหม่", phone: "081-222", note: "ทดลอง" }),
      ),
    );
  });

  it("calls onUpdate with only the changed field for a row", async () => {
    const { onUpdate } = setup({});
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข" }));
    // [0] = add-form field, [1] = the editing row's field.
    const phones = screen.getAllByLabelText("เบอร์โทร");
    fireEvent.change(phones[1]!, { target: { value: "099-999" } });
    fireEvent.click(screen.getByRole("button", { name: "บันทึก" }));
    await waitFor(() =>
      expect(onUpdate).toHaveBeenCalledWith("c1", expect.objectContaining({ phone: "099-999" })),
    );
    // unchanged fields are not sent
    expect(onUpdate).toHaveBeenCalledWith(
      "c1",
      expect.not.objectContaining({ name: expect.anything() }),
    );
  });

  it("renders a <select> for a select-typed field and reports its value (spec 86)", async () => {
    const onCreate = vi.fn().mockResolvedValue({ ok: true });
    render(
      <RecordManager
        addLabel="เพิ่ม"
        fields={[
          { key: "name", label: "ชื่อ", type: "text", maxLength: 200 },
          {
            key: "status",
            label: "สถานะ",
            type: "select",
            options: [
              { value: "active", label: "ใช้งาน" },
              { value: "blacklisted", label: "บัญชีดำ" },
            ],
          },
        ]}
        rows={[]}
        onCreate={onCreate as unknown as CreateFn}
        onUpdate={vi.fn() as unknown as UpdateFn}
      />,
    );
    const sel = screen.getByLabelText("สถานะ");
    expect(sel.tagName).toBe("SELECT");
    fireEvent.change(screen.getByLabelText("ชื่อ"), { target: { value: "x" } });
    fireEvent.change(sel, { target: { value: "blacklisted" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่ม" }));
    await waitFor(() =>
      expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ status: "blacklisted" })),
    );
  });

  it("renders the error when onCreate fails", async () => {
    setup({
      rows: [],
      onCreate: vi.fn().mockResolvedValue({ ok: false, error: "เพิ่มไม่สำเร็จ" }),
    });
    fireEvent.change(screen.getByLabelText("ชื่อ"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มลูกค้า" }));
    expect(await screen.findByText("เพิ่มไม่สำเร็จ")).toBeInTheDocument();
  });
});
