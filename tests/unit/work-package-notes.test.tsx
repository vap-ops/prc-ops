// Writing failing test first.
//
// Spec 71: the WorkPackageNotes client component — a textarea + save in
// the ข้อมูลงาน zone of the WP detail page. Seeds from the current note,
// relays the raw value to setWorkPackageNotes (the server validates/trims),
// refreshes on success, surfaces the Thai error on failure.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockSetNotes, mockRefresh } = vi.hoisted(() => ({
  mockSetNotes: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/projects/[projectId]/work-packages/[workPackageId]/notes-actions", () => ({
  setWorkPackageNotes: mockSetNotes,
}));

import { WorkPackageNotes } from "@/components/features/work-package-notes";

describe("WorkPackageNotes", () => {
  beforeEach(() => {
    mockSetNotes.mockReset();
    mockRefresh.mockReset();
  });

  it("seeds the textarea with the current note", () => {
    render(<WorkPackageNotes projectId="p" workPackageId="w" notes="ผนังร้าว" />);
    expect(screen.getByRole("textbox")).toHaveValue("ผนังร้าว");
  });

  it("save is disabled until the note is edited (not dirty)", () => {
    render(<WorkPackageNotes projectId="p" workPackageId="w" notes="เดิม" />);
    expect(screen.getByRole("button", { name: /บันทึก/ })).toBeDisabled();
  });

  it("relays the raw edited value and refreshes on success", async () => {
    mockSetNotes.mockResolvedValue({ ok: true });
    render(<WorkPackageNotes projectId="p" workPackageId="w" notes={null} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "  เพิ่มเหล็กเส้น  " } });
    fireEvent.click(screen.getByRole("button", { name: /บันทึก/ }));
    await waitFor(() =>
      expect(mockSetNotes).toHaveBeenCalledWith({
        projectId: "p",
        workPackageId: "w",
        notes: "  เพิ่มเหล็กเส้น  ",
      }),
    );
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("surfaces the error and does not refresh on failure", async () => {
    mockSetNotes.mockResolvedValue({ ok: false, error: "บันทึกหมายเหตุไม่สำเร็จ" });
    render(<WorkPackageNotes projectId="p" workPackageId="w" notes={null} />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: /บันทึก/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("บันทึกหมายเหตุไม่สำเร็จ");
    expect(mockRefresh).not.toHaveBeenCalled();
  });
});
