// Spec 76 (app-feel slice 1): the display-name form's success confirmation
// moved from an inline "บันทึกแล้ว" span to a toast; the field-bound
// validation error stays inline.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockUpdate, mockRefresh, mockToast } = vi.hoisted(() => ({
  mockUpdate: vi.fn(),
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
vi.mock("@/app/coming-soon/actions", () => ({ updateDisplayName: mockUpdate }));
vi.mock("@/lib/ui/use-toast", () => ({ useToast: () => mockToast }));

import { DisplayNameForm } from "@/components/features/common/display-name-form";

describe("DisplayNameForm", () => {
  beforeEach(() => {
    mockUpdate.mockReset();
    mockRefresh.mockReset();
    mockToast.success.mockReset();
  });

  it("toasts success on save (no inline saved span)", async () => {
    mockUpdate.mockResolvedValue({ ok: true, value: "ชื่อใหม่" });
    render(<DisplayNameForm initialName="เดิม" />);
    fireEvent.change(screen.getByLabelText("ชื่อที่แสดง"), { target: { value: "ชื่อใหม่" } });
    fireEvent.click(screen.getByRole("button", { name: /บันทึก/ }));
    await waitFor(() => expect(mockUpdate).toHaveBeenCalledWith("ชื่อใหม่"));
    await waitFor(() => expect(mockToast.success).toHaveBeenCalledWith("บันทึกแล้ว"));
    expect(screen.queryByText("บันทึกแล้ว")).not.toBeInTheDocument();
  });

  it("keeps a server error inline (role=alert), no toast", async () => {
    mockUpdate.mockResolvedValue({ ok: false, error: "ชื่อซ้ำ" });
    render(<DisplayNameForm initialName="เดิม" />);
    fireEvent.change(screen.getByLabelText("ชื่อที่แสดง"), { target: { value: "ชื่อใหม่" } });
    fireEvent.click(screen.getByRole("button", { name: /บันทึก/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("ชื่อซ้ำ");
    expect(mockToast.success).not.toHaveBeenCalled();
  });
});
