// Writing failing test first.
//
// Spec 72: NotesField is the shared presentational notes textarea — the
// generalization of WorkPackageNotes. It owns the textarea/dirty/save/error
// UI and router.refresh; the write is an injected onSave callback so each
// entity binds its own server action in a thin client wrapper.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRefresh, mockToast } = vi.hoisted(() => ({
  mockRefresh: vi.fn(),
  mockToast: {
    success: vi.fn(),
    error: vi.fn(),
    toast: vi.fn(),
    dismiss: vi.fn(),
    fromResult: vi.fn(),
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
// Spec 76: success feedback moved to a toast.
vi.mock("@/lib/ui/use-toast", () => ({ useToast: () => mockToast }));

import { NotesField } from "@/components/features/common/notes-field";

describe("NotesField", () => {
  beforeEach(() => {
    mockRefresh.mockReset();
    mockToast.success.mockReset();
  });

  it("seeds the textarea with the current note", () => {
    render(<NotesField notes="ของเดิม" onSave={vi.fn()} fieldId="x" />);
    expect(screen.getByRole("textbox")).toHaveValue("ของเดิม");
  });

  it("save is disabled until the note is edited (not dirty)", () => {
    render(<NotesField notes="เดิม" onSave={vi.fn()} fieldId="x" />);
    expect(screen.getByRole("button", { name: /บันทึก/ })).toBeDisabled();
  });

  it("calls onSave with the raw edited value and refreshes on success", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: true });
    render(<NotesField notes={null} onSave={onSave} fieldId="x" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  ข้อความใหม่  " } });
    fireEvent.click(screen.getByRole("button", { name: /บันทึก/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith("  ข้อความใหม่  "));
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    // Spec 76: a success toast fires (the inline "บันทึกแล้ว" span is gone).
    expect(mockToast.success).toHaveBeenCalledWith("บันทึกแล้ว");
  });

  it("surfaces the error and does not refresh on failure", async () => {
    const onSave = vi.fn().mockResolvedValue({ ok: false, error: "บันทึกไม่สำเร็จ" });
    render(<NotesField notes={null} onSave={onSave} fieldId="x" />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "y" } });
    fireEvent.click(screen.getByRole("button", { name: /บันทึก/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("บันทึกไม่สำเร็จ");
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("renders a custom label when provided", () => {
    render(<NotesField notes={null} onSave={vi.fn()} fieldId="x" label="โน้ตพิเศษ" />);
    expect(screen.getByText("โน้ตพิเศษ")).toBeInTheDocument();
  });
});
