// Spec 130 U4 / spec 317 U5 — BankChangeForm (contractor portal): staged bank
// change with a REQUIRED passbook photo (parity with workers/staff). The photo
// uploads to the caller's own contractor/<id>/ folder, then the action receives
// {attachmentId, ext} and rebuilds the path server-side.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { submitBankChange, mockRefresh, mockUpload, mockPrepare } = vi.hoisted(() => ({
  submitBankChange: vi.fn(),
  mockRefresh: vi.fn(),
  mockUpload: vi.fn(),
  mockPrepare: vi.fn(),
}));
vi.mock("@/lib/portal/actions", () => ({ submitBankChange }));
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

import { BankChangeForm } from "@/components/features/portal/bank-change-form";

const CONTRACTOR = "22222222-2222-2222-2222-222222222222";

function fillFields() {
  fireEvent.click(screen.getByRole("button", { name: /กสิกรไทย/ }));
  const [acctNo, acctName] = screen.getAllByRole("textbox");
  fireEvent.change(acctNo!, { target: { value: "1112223334" } });
  fireEvent.change(acctName!, { target: { value: "ผู้รับเหมา ทดสอบ" } });
}

function pickPhoto() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "book.jpg")] } });
}

beforeEach(() => {
  submitBankChange.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
  mockUpload.mockReset().mockResolvedValue({ error: null });
  mockPrepare.mockReset().mockResolvedValue({ blob: new Blob(["x"]), ext: "jpeg" });
});

describe("BankChangeForm (contractor)", () => {
  it("shows the waiting notice while a request is pending", () => {
    render(<BankChangeForm contractorId={CONTRACTOR} hasPending={true} />);
    expect(screen.getByText("คำขอเปลี่ยนบัญชีธนาคารกำลังรอผู้จัดการอนุมัติ")).toBeInTheDocument();
  });

  it("refuses to submit without a passbook photo", async () => {
    render(<BankChangeForm contractorId={CONTRACTOR} hasPending={false} />);
    fillFields();
    fireEvent.click(screen.getByRole("button", { name: "ส่งคำขอเปลี่ยนบัญชี" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("กรุณาแนบรูปสมุดบัญชี"),
    );
    expect(mockUpload).not.toHaveBeenCalled();
    expect(submitBankChange).not.toHaveBeenCalled();
  });

  it("uploads to the own contractor folder then submits with attachmentId/ext", async () => {
    render(<BankChangeForm contractorId={CONTRACTOR} hasPending={false} />);
    fillFields();
    pickPhoto();
    fireEvent.click(screen.getByRole("button", { name: "ส่งคำขอเปลี่ยนบัญชี" }));
    await waitFor(() => expect(submitBankChange).toHaveBeenCalledTimes(1));
    const path = mockUpload.mock.calls[0]?.[0] as string;
    expect(path.startsWith(`contractor/${CONTRACTOR}/`)).toBe(true);
    const arg = submitBankChange.mock.calls[0]?.[0] as { ext: string; attachmentId: string };
    expect(arg.ext).toBe("jpeg");
    expect(arg.attachmentId).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });
});
