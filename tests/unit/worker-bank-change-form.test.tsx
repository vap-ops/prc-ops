// Spec 170 U4c-2 U2 — WorkerBankChangeForm: a bound DC worker stages a bank-detail
// change from the portal (→ pending → PM approval, the anti-fraud gate). The
// worker analogue of the contractor BankChangeForm; reuses validateBankChange and
// calls the worker submit action. While a request is pending, the form is replaced
// by a waiting notice.
//
// Spec 315 U2 — the request now REQUIRES a passbook photo (operator decision
// 2026-07-14): the form uploads to the caller's own technician/<uid>/book_bank/
// folder first, then submits {attachmentId, ext} for the server to rebuild the
// path. Submitting without a photo is refused client-side.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const { submitWorkerBankChange, mockRefresh, mockUpload, mockPrepare } = vi.hoisted(() => ({
  submitWorkerBankChange: vi.fn(),
  mockRefresh: vi.fn(),
  mockUpload: vi.fn(),
  mockPrepare: vi.fn(),
}));
vi.mock("@/lib/portal/actions", () => ({ submitWorkerBankChange }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
vi.mock("@/lib/db/browser", () => ({
  createClient: () => ({
    storage: { from: () => ({ upload: mockUpload }) },
    // Spec 317 U7 — the embedded BankSelect fetches usage counts on mount.
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

import { WorkerBankChangeForm } from "@/components/features/portal/worker-bank-change-form";

const UID = "11111111-1111-1111-1111-111111111111";

function fillFields() {
  // Spec 317 U7 — bank name comes from the canonical picker chip, not free text.
  fireEvent.click(screen.getByRole("button", { name: /กสิกรไทย/ }));
  const [acctNo, acctName] = screen.getAllByRole("textbox");
  fireEvent.change(acctNo!, { target: { value: "1112223334" } });
  fireEvent.change(acctName!, { target: { value: "ช่าง หนึ่ง" } });
}

function pickPhoto() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "book.jpg")] } });
}

describe("WorkerBankChangeForm", () => {
  beforeEach(() => {
    submitWorkerBankChange.mockReset().mockResolvedValue({ ok: true });
    mockRefresh.mockReset();
    mockUpload.mockReset().mockResolvedValue({ error: null });
    mockPrepare.mockReset().mockResolvedValue({ blob: new Blob(["x"]), ext: "jpeg" });
  });

  it("renders the submit form when there is no pending request", () => {
    render(<WorkerBankChangeForm uid={UID} hasPending={false} />);
    expect(screen.getByRole("button", { name: "ส่งคำขอเปลี่ยนบัญชี" })).toBeInTheDocument();
  });

  it("shows a waiting notice (no form) while a request is pending", () => {
    render(<WorkerBankChangeForm uid={UID} hasPending={true} />);
    expect(screen.getByText("คำขอเปลี่ยนบัญชีธนาคารกำลังรอผู้จัดการอนุมัติ")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ส่งคำขอเปลี่ยนบัญชี" })).not.toBeInTheDocument();
  });

  it("refuses to submit without a passbook photo", async () => {
    render(<WorkerBankChangeForm uid={UID} hasPending={false} />);
    fillFields();
    fireEvent.click(screen.getByRole("button", { name: "ส่งคำขอเปลี่ยนบัญชี" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("กรุณาแนบรูปสมุดบัญชี"),
    );
    expect(mockUpload).not.toHaveBeenCalled();
    expect(submitWorkerBankChange).not.toHaveBeenCalled();
  });

  it("uploads the passbook to the own book_bank folder then submits with attachmentId/ext", async () => {
    render(<WorkerBankChangeForm uid={UID} hasPending={false} />);
    fillFields();
    pickPhoto();
    fireEvent.click(screen.getByRole("button", { name: "ส่งคำขอเปลี่ยนบัญชี" }));
    await waitFor(() => expect(submitWorkerBankChange).toHaveBeenCalledTimes(1));
    expect(mockUpload).toHaveBeenCalledTimes(1);
    const path = mockUpload.mock.calls[0]?.[0] as string;
    expect(path.startsWith(`technician/${UID}/book_bank/`)).toBe(true);
    const arg = submitWorkerBankChange.mock.calls[0]?.[0] as {
      bankName: string;
      attachmentId: string;
      ext: string;
    };
    expect(arg.bankName).toBe("กสิกรไทย");
    expect(arg.ext).toBe("jpeg");
    expect(arg.attachmentId).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("surfaces a storage upload failure and never submits", async () => {
    mockUpload.mockResolvedValue({ error: { message: "boom", statusCode: "500" } });
    render(<WorkerBankChangeForm uid={UID} hasPending={false} />);
    fillFields();
    pickPhoto();
    fireEvent.click(screen.getByRole("button", { name: "ส่งคำขอเปลี่ยนบัญชี" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("ส่งเอกสารไม่สำเร็จ"));
    expect(submitWorkerBankChange).not.toHaveBeenCalled();
  });
});
