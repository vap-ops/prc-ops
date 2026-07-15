// Spec 319 U2 — UserBankChangeForm: a login-keyed (admin/office) staffer with no
// worker/contractor/registration bank home stages a bank change (passbook photo
// REQUIRED, uploads to the own technician/<uid>/book_bank/ folder). Clone of the
// staff form, wired to submitUserBankChange.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { submitUserBankChange, mockRefresh, mockUpload, mockPrepare } = vi.hoisted(() => ({
  submitUserBankChange: vi.fn(),
  mockRefresh: vi.fn(),
  mockUpload: vi.fn(),
  mockPrepare: vi.fn(),
}));
vi.mock("@/app/settings/my-info/actions", () => ({ submitUserBankChange }));
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

import { UserBankChangeForm } from "@/components/features/profile/user-bank-change-form";

const UID = "44444444-4444-4444-4444-444444444444";

function fillFields() {
  fireEvent.click(screen.getByRole("button", { name: /กสิกรไทย/ }));
  const [acctNo, acctName] = screen.getAllByRole("textbox");
  fireEvent.change(acctNo!, { target: { value: "1112223334" } });
  fireEvent.change(acctName!, { target: { value: "บัญชี ทดสอบ" } });
}

beforeEach(() => {
  submitUserBankChange.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
  mockUpload.mockReset().mockResolvedValue({ error: null });
  mockPrepare.mockReset().mockResolvedValue({ blob: new Blob(["x"]), ext: "jpeg" });
});

describe("UserBankChangeForm", () => {
  it("shows the waiting notice while a request is pending", () => {
    render(<UserBankChangeForm uid={UID} hasPending={true} />);
    expect(screen.getByText(/กำลังรอ/)).toBeInTheDocument();
  });

  it("refuses to submit without a passbook photo", async () => {
    render(<UserBankChangeForm uid={UID} hasPending={false} />);
    fillFields();
    fireEvent.click(screen.getByRole("button", { name: "ส่งคำขอเปลี่ยนบัญชี" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("กรุณาแนบรูปสมุดบัญชี"),
    );
    expect(submitUserBankChange).not.toHaveBeenCalled();
  });

  it("uploads to the own book_bank folder then submits with attachmentId/ext", async () => {
    render(<UserBankChangeForm uid={UID} hasPending={false} />);
    fillFields();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "book.jpg")] } });
    fireEvent.click(screen.getByRole("button", { name: "ส่งคำขอเปลี่ยนบัญชี" }));
    await waitFor(() => expect(submitUserBankChange).toHaveBeenCalledTimes(1));
    const path = mockUpload.mock.calls[0]?.[0] as string;
    expect(path.startsWith(`technician/${UID}/book_bank/`)).toBe(true);
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });
});
