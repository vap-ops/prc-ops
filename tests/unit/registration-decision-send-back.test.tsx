// Writing failing test first.
//
// Spec 322 — the approver gains a THIRD, non-terminal action on a pending
// registration: "ส่งกลับให้แก้ไข" (send back for edit). It sits alongside the
// existing approve / deny (operator: send-back is the primary non-approve action,
// deny is KEPT for genuine spam/fake). Tapping it reveals a REQUIRED note textarea
// (what to fix), mirroring the reject confirm-step; confirming relays
// sendBackStaffRegistration({ registrationId, note }). A blank note is refused
// client-side (no call). The row stays pending — the RPC keeps the status and
// attaches the note to reject_reason (reused as the reviewer note).

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockApprove, mockReject, mockSendBack, mockRefresh } = vi.hoisted(() => ({
  mockApprove: vi.fn(),
  mockReject: vi.fn(),
  mockSendBack: vi.fn(),
  mockRefresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/app/registrations/actions", () => ({
  approveStaffRegistration: mockApprove,
  rejectStaffRegistration: mockReject,
  sendBackStaffRegistration: mockSendBack,
}));
vi.mock("@/lib/ui/use-toast", () => ({
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
    toast: vi.fn(),
    dismiss: vi.fn(),
    fromResult: vi.fn(),
  }),
}));

import { RegistrationDecision } from "@/components/features/registrations/registration-decision";

beforeEach(() => {
  mockApprove.mockReset().mockResolvedValue({ ok: true });
  mockReject.mockReset().mockResolvedValue({ ok: true });
  mockSendBack.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

describe("RegistrationDecision — ส่งกลับให้แก้ไข (send back for edit)", () => {
  it("offers a send-back button beside approve and deny", () => {
    render(<RegistrationDecision registrationId="reg-1" />);
    expect(screen.getByRole("button", { name: "อนุมัติ" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ส่งกลับให้แก้ไข" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "ปฏิเสธ" })).toBeInTheDocument();
  });

  it("reveals a required note field when send-back is tapped, then relays the note", async () => {
    render(<RegistrationDecision registrationId="reg-1" />);
    fireEvent.click(screen.getByRole("button", { name: "ส่งกลับให้แก้ไข" }));
    const note = screen.getByLabelText("สิ่งที่ต้องแก้ไข");
    fireEvent.change(note, { target: { value: "เอกสารไม่ครบ" } });
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันส่งกลับ" }));
    await waitFor(() =>
      expect(mockSendBack).toHaveBeenCalledWith({ registrationId: "reg-1", note: "เอกสารไม่ครบ" }),
    );
    expect(mockReject).not.toHaveBeenCalled();
    expect(mockApprove).not.toHaveBeenCalled();
  });

  it("refuses a blank note (no server call, shows an error)", async () => {
    render(<RegistrationDecision registrationId="reg-1" />);
    fireEvent.click(screen.getByRole("button", { name: "ส่งกลับให้แก้ไข" }));
    fireEvent.change(screen.getByLabelText("สิ่งที่ต้องแก้ไข"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันส่งกลับ" }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(mockSendBack).not.toHaveBeenCalled();
  });

  it("cancel returns to the action buttons without calling anything", () => {
    render(<RegistrationDecision registrationId="reg-1" />);
    fireEvent.click(screen.getByRole("button", { name: "ส่งกลับให้แก้ไข" }));
    fireEvent.click(screen.getByRole("button", { name: "ยกเลิก" }));
    expect(screen.getByRole("button", { name: "อนุมัติ" })).toBeInTheDocument();
    expect(mockSendBack).not.toHaveBeenCalled();
  });

  it("still supports the terminal deny path (regression)", async () => {
    render(<RegistrationDecision registrationId="reg-1" />);
    fireEvent.click(screen.getByRole("button", { name: "ปฏิเสธ" }));
    fireEvent.change(screen.getByLabelText("เหตุผลที่ปฏิเสธ"), { target: { value: "ปลอม" } });
    fireEvent.click(screen.getByRole("button", { name: "ยืนยันปฏิเสธ" }));
    await waitFor(() =>
      expect(mockReject).toHaveBeenCalledWith({ registrationId: "reg-1", reason: "ปลอม" }),
    );
    expect(mockSendBack).not.toHaveBeenCalled();
  });
});
