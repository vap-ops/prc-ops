// Spec 367 §13 — the bulk add door on /equipment.
//
// The two-step contract is the whole safety story: `จำนวน` means two different
// things by tracking, so the operator must SEE each line's effect in words
// before anything is written, and the commit stays unreachable until a dry run
// comes back clean. These pin that the second step cannot be reached early and
// that a reviewed file is the one that gets committed.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockBulk, mockRefresh } = vi.hoisted(() => ({
  mockBulk: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/equipment/actions", () => ({ bulkAddEquipmentFromCatalog: mockBulk }));

import { BulkAddEquipmentSheet } from "@/components/features/equipment/bulk-add-equipment-sheet";

const TRIGGER = "เพิ่มหลายเครื่อง";
const PASTE = "ทะเบียน\tจำนวน\nสว่านไฟฟ้า\t2";

function open() {
  fireEvent.click(screen.getByRole("button", { name: TRIGGER }));
}
function paste(text = PASTE) {
  fireEvent.change(screen.getByLabelText("ตารางที่วาง"), { target: { value: text } });
}

beforeEach(() => {
  mockBulk.mockReset();
  mockRefresh.mockReset();
});

describe("BulkAddEquipmentSheet", () => {
  it("keeps the commit unreachable until a dry run comes back clean", async () => {
    render(<BulkAddEquipmentSheet />);
    open();
    paste();

    expect(screen.getByRole("button", { name: "เพิ่มทั้งหมด" })).toBeDisabled();

    mockBulk.mockResolvedValue({
      ok: true,
      created: 2,
      errors: [],
      preview: ["สร้าง 2 เครื่อง (สว่านไฟฟ้า No.1–No.2) · รับเข้าคลัง"],
      rateWarnings: 0,
      locationWarnings: 0,
    });
    fireEvent.click(screen.getByRole("button", { name: "ตรวจสอบ" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "เพิ่มทั้งหมด" })).not.toBeDisabled(),
    );
    expect(mockBulk).toHaveBeenCalledWith(PASTE, { dryRun: true });
  });

  it("shows every line's effect in words — the only place จำนวน is disambiguated", async () => {
    render(<BulkAddEquipmentSheet />);
    open();
    paste();
    mockBulk.mockResolvedValue({
      ok: true,
      created: 3,
      errors: [],
      preview: [
        "สร้าง 2 เครื่อง (สว่านไฟฟ้า No.1–No.2) · รับเข้าคลัง",
        "1 แถว จำนวน 200 · หน้างาน: TFM นายาว",
      ],
      rateWarnings: 0,
      locationWarnings: 0,
    });
    fireEvent.click(screen.getByRole("button", { name: "ตรวจสอบ" }));

    await waitFor(() => expect(screen.getByText(/1 แถว จำนวน 200/)).toBeInTheDocument());
    expect(screen.getByText(/สร้าง 2 เครื่อง/)).toBeInTheDocument();
  });

  it("re-locks the commit when the paste is edited after a clean preview", async () => {
    render(<BulkAddEquipmentSheet />);
    open();
    paste();
    mockBulk.mockResolvedValue({
      ok: true,
      created: 2,
      errors: [],
      preview: ["สร้าง 2 เครื่อง (สว่านไฟฟ้า No.1–No.2) · รับเข้าคลัง"],
      rateWarnings: 0,
      locationWarnings: 0,
    });
    fireEvent.click(screen.getByRole("button", { name: "ตรวจสอบ" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "เพิ่มทั้งหมด" })).not.toBeDisabled(),
    );

    // Reviewed-file ≠ committed-file must be impossible.
    paste("ทะเบียน\tจำนวน\nสว่านไฟฟ้า\t99");
    expect(screen.getByRole("button", { name: "เพิ่มทั้งหมด" })).toBeDisabled();
  });

  it("lists every bad row rather than the first", async () => {
    render(<BulkAddEquipmentSheet />);
    open();
    paste();
    mockBulk.mockResolvedValue({
      ok: false,
      created: 0,
      errors: ['แถว 1: ไม่พบ "สว่านลม" ในทะเบียนเครื่องมือ', "แถว 2: จำนวนต้องเป็นจำนวนเต็ม"],
      rateWarnings: 0,
      locationWarnings: 0,
    });
    fireEvent.click(screen.getByRole("button", { name: "ตรวจสอบ" }));

    await waitFor(() => expect(screen.getByText(/สว่านลม/)).toBeInTheDocument());
    expect(screen.getByText(/จำนวนต้องเป็นจำนวนเต็ม/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "เพิ่มทั้งหมด" })).toBeDisabled();
  });

  it("names what landed and where it stopped when the commit fails part-way", async () => {
    render(<BulkAddEquipmentSheet />);
    open();
    paste();
    mockBulk.mockResolvedValueOnce({
      ok: true,
      created: 3,
      errors: [],
      preview: ["สร้าง 3 เครื่อง (สว่านไฟฟ้า No.1–No.3) · รับเข้าคลัง"],
      rateWarnings: 0,
      locationWarnings: 0,
    });
    fireEvent.click(screen.getByRole("button", { name: "ตรวจสอบ" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "เพิ่มทั้งหมด" })).not.toBeDisabled(),
    );

    mockBulk.mockResolvedValueOnce({
      ok: false,
      created: 1,
      errors: ['บันทึก "สว่านไฟฟ้า No.2" ไม่สำเร็จ — เพิ่มไปแล้ว 1 เครื่อง'],
      stoppedAt: "สว่านไฟฟ้า",
      rateWarnings: 0,
      locationWarnings: 0,
    });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มทั้งหมด" }));

    // The count is the truth — no rollback is possible, so it must not be hidden.
    await waitFor(() => expect(screen.getByText(/เพิ่มไปแล้ว 1 เครื่อง/)).toBeInTheDocument());
  });

  it("states the saved-with-a-gap follow-ups instead of closing quietly", async () => {
    render(<BulkAddEquipmentSheet />);
    open();
    paste();
    mockBulk.mockResolvedValueOnce({
      ok: true,
      created: 2,
      errors: [],
      preview: ["สร้าง 2 เครื่อง (สว่านไฟฟ้า No.1–No.2) · รับเข้าคลัง"],
      rateWarnings: 0,
      locationWarnings: 0,
    });
    fireEvent.click(screen.getByRole("button", { name: "ตรวจสอบ" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "เพิ่มทั้งหมด" })).not.toBeDisabled(),
    );

    mockBulk.mockResolvedValueOnce({
      ok: true,
      created: 2,
      errors: [],
      rateWarnings: 1,
      locationWarnings: 2,
    });
    fireEvent.click(screen.getByRole("button", { name: "เพิ่มทั้งหมด" }));

    await waitFor(() => expect(screen.getByText(/เพิ่มสำเร็จ 2 เครื่อง/)).toBeInTheDocument());
    expect(screen.getByText(/ค่าเช่า/)).toBeInTheDocument();
    expect(screen.getByText(/ที่อยู่/)).toBeInTheDocument();
    expect(mockRefresh).toHaveBeenCalled();
  });
});
