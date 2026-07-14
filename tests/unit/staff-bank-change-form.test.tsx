// Spec 317 U2/U4 — StaffBankChangeForm: an approved office staffer stages a bank
// change (approved tier; passbook photo REQUIRED, uploads to the own
// technician/<uid>/book_bank/ folder). Mirrors the worker form.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { submitStaffBankChange, mockRefresh, mockUpload, mockPrepare } = vi.hoisted(() => ({
  submitStaffBankChange: vi.fn(),
  mockRefresh: vi.fn(),
  mockUpload: vi.fn(),
  mockPrepare: vi.fn(),
}));
vi.mock("@/app/settings/my-info/actions", () => ({ submitStaffBankChange }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/lib/db/browser", () => ({
  createClient: () => ({
    storage: { from: () => ({ upload: mockUpload }) },
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
  }),
}));
vi.mock("@/lib/photos/downscale", () => ({ preparePhotoForUpload: mockPrepare }));
vi.mock("@/lib/ui/use-toast", () => ({
  useToast: () => ({
    error: vi.fn(),
    success: vi.fn(),
    toast: vi.fn(),
    dismiss: vi.fn(),
    fromResult: vi.fn(),
  }),
}));

import { StaffBankChangeForm } from "@/components/features/profile/staff-bank-change-form";

const UID = "33333333-3333-3333-3333-333333333333";

function fillFields() {
  fireEvent.click(screen.getByRole("button", { name: /กสิกรไทย/ }));
  const [acctNo, acctName] = screen.getAllByRole("textbox");
  fireEvent.change(acctNo!, { target: { value: "1112223334" } });
  fireEvent.change(acctName!, { target: { value: "บัญชี ทดสอบ" } });
}

beforeEach(() => {
  submitStaffBankChange.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
  mockUpload.mockReset().mockResolvedValue({ error: null });
  mockPrepare.mockReset().mockResolvedValue({ blob: new Blob(["x"]), ext: "jpeg" });
});

describe("StaffBankChangeForm", () => {
  it("shows the waiting notice while a request is pending", () => {
    render(<StaffBankChangeForm uid={UID} hasPending={true} />);
    expect(screen.getByText(/กำลังรอ/)).toBeInTheDocument();
  });

  it("refuses to submit without a passbook photo", async () => {
    render(<StaffBankChangeForm uid={UID} hasPending={false} />);
    fillFields();
    fireEvent.click(screen.getByRole("button", { name: "ส่งคำขอเปลี่ยนบัญชี" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("กรุณาแนบรูปสมุดบัญชี"),
    );
    expect(submitStaffBankChange).not.toHaveBeenCalled();
  });

  it("uploads to the own book_bank folder then submits with attachmentId/ext", async () => {
    render(<StaffBankChangeForm uid={UID} hasPending={false} />);
    fillFields();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "book.jpg")] } });
    fireEvent.click(screen.getByRole("button", { name: "ส่งคำขอเปลี่ยนบัญชี" }));
    await waitFor(() => expect(submitStaffBankChange).toHaveBeenCalledTimes(1));
    const path = mockUpload.mock.calls[0]?.[0] as string;
    expect(path.startsWith(`technician/${UID}/book_bank/`)).toBe(true);
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });
});
