// Spec 321 U2 — ProfileBankSection: the ONE bank-change surface for every
// audience (worker / contractor / staff / user), replacing the 4 clone forms.
// Read card (current bank) + แก้ไข opens a BottomSheet hosting the shared form.
// Per-audience config drives the passbook path builder, accountName maxLength,
// approver copy, and submit dispatch. This test pins the read/edit/pending
// behavior + the per-audience maxLength; the submit flow is ported verbatim from
// the (already-verified) clone bodies and exercised in the browser.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { submitProfileBankChange, mockRefresh, mockUpload, mockPrepare } = vi.hoisted(() => ({
  submitProfileBankChange: vi.fn(),
  mockRefresh: vi.fn(),
  mockUpload: vi.fn(),
  mockPrepare: vi.fn(),
}));
vi.mock("@/lib/profile/submit-profile-bank-change", () => ({ submitProfileBankChange }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh, push: vi.fn() }),
}));
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

import { ProfileBankSection } from "@/components/features/profile/profile-bank-section";

const UID = "a1111111-1111-4111-8111-111111111111";

beforeEach(() => {
  submitProfileBankChange.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
  mockUpload.mockReset().mockResolvedValue({ error: null });
  mockPrepare.mockReset().mockResolvedValue({ blob: new Blob(["x"]), ext: "jpeg" });
});

describe("ProfileBankSection", () => {
  it("shows the current bank as a read card", () => {
    render(
      <ProfileBankSection
        audience="worker"
        ownerId={UID}
        current={{ bankName: "กสิกรไทย", accountNo: "1112223334", accountName: "สมชาย ใจดี" }}
        hasPending={false}
      />,
    );
    expect(screen.getByText("กสิกรไทย")).toBeInTheDocument();
    expect(screen.getByText(/1112223334/)).toBeInTheDocument();
  });

  it("shows an empty-state when there is no bank on file and showEmptyState is set", () => {
    render(
      <ProfileBankSection
        audience="user"
        ownerId={UID}
        current={null}
        showEmptyState
        hasPending={false}
      />,
    );
    expect(screen.getByText("ยังไม่มีบัญชีธนาคาร")).toBeInTheDocument();
  });

  it("omits the empty-state when showEmptyState is not set (surface never showed one)", () => {
    render(<ProfileBankSection audience="staff" ownerId={UID} current={null} hasPending={false} />);
    expect(screen.queryByText("ยังไม่มีบัญชีธนาคาร")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "แก้ไข" })).toBeInTheDocument();
  });

  it("replaces the edit control with a pending notice while a request is pending", () => {
    render(<ProfileBankSection audience="staff" ownerId={UID} current={null} hasPending={true} />);
    expect(screen.getByText(/รอการอนุมัติ/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "แก้ไข" })).not.toBeInTheDocument();
  });

  it("opens the edit sheet with the shared form when แก้ไข is tapped", () => {
    render(
      <ProfileBankSection audience="worker" ownerId={UID} current={null} hasPending={false} />,
    );
    expect(screen.queryByText("เลขที่บัญชี")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข" }));
    expect(screen.getByText("เลขที่บัญชี")).toBeInTheDocument();
    expect(screen.getByText("ชื่อบัญชี")).toBeInTheDocument();
  });

  it("caps accountName at the audience length (worker 120, contractor 200)", () => {
    const { unmount } = render(
      <ProfileBankSection audience="worker" ownerId={UID} current={null} hasPending={false} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข" }));
    const workerAcctName = screen.getByLabelText("ชื่อบัญชี") as HTMLInputElement;
    expect(workerAcctName.maxLength).toBe(120);
    unmount();

    render(
      <ProfileBankSection
        audience="contractor"
        ownerId="c2222222-2222-4222-8222-222222222222"
        current={null}
        hasPending={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข" }));
    const contractorAcctName = screen.getByLabelText("ชื่อบัญชี") as HTMLInputElement;
    expect(contractorAcctName.maxLength).toBe(200);
  });

  it("user (instant tier): the sheet saves directly — บันทึก, instant subtitle, no ส่งคำขอ", () => {
    render(
      <ProfileBankSection
        audience="user"
        ownerId={UID}
        current={null}
        showEmptyState
        hasPending={false}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "แก้ไข" }));
    expect(screen.getByRole("button", { name: "บันทึก" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ส่งคำขอเปลี่ยนบัญชี" })).not.toBeInTheDocument();
    expect(screen.getByText("บันทึกและใช้งานได้ทันที")).toBeInTheDocument();
  });

  it("user (instant tier): never shows a pending banner (the approval queue is gone)", () => {
    render(<ProfileBankSection audience="user" ownerId={UID} current={null} hasPending={true} />);
    // instant ignores hasPending — the แก้ไข control stays, no waiting banner
    expect(screen.getByRole("button", { name: "แก้ไข" })).toBeInTheDocument();
    expect(screen.queryByText(/รอการอนุมัติ/)).not.toBeInTheDocument();
  });
});

function openAndFill() {
  fireEvent.click(screen.getByRole("button", { name: "แก้ไข" }));
  fireEvent.click(screen.getByRole("button", { name: /กสิกรไทย/ }));
  const acctNo = screen.getByLabelText("เลขที่บัญชี");
  const acctName = screen.getByLabelText("ชื่อบัญชี");
  fireEvent.change(acctNo, { target: { value: "1112223334" } });
  fireEvent.change(acctName, { target: { value: "ช่าง หนึ่ง" } });
}

function pickPhoto() {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "book.jpg")] } });
}

describe("ProfileBankSection submit flow", () => {
  it("refuses to submit without a passbook photo", async () => {
    render(
      <ProfileBankSection audience="worker" ownerId={UID} current={null} hasPending={false} />,
    );
    openAndFill();
    fireEvent.click(screen.getByRole("button", { name: "ส่งคำขอเปลี่ยนบัญชี" }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("กรุณาแนบรูปสมุดบัญชี"),
    );
    expect(mockUpload).not.toHaveBeenCalled();
    expect(submitProfileBankChange).not.toHaveBeenCalled();
  });

  it("uploads the passbook to the book_bank folder then dispatches with the audience + attachmentId/ext", async () => {
    render(
      <ProfileBankSection audience="worker" ownerId={UID} current={null} hasPending={false} />,
    );
    openAndFill();
    pickPhoto();
    fireEvent.click(screen.getByRole("button", { name: "ส่งคำขอเปลี่ยนบัญชี" }));
    await waitFor(() => expect(submitProfileBankChange).toHaveBeenCalledTimes(1));
    const path = mockUpload.mock.calls[0]?.[0] as string;
    expect(path.startsWith(`technician/${UID}/book_bank/`)).toBe(true);
    const [audienceArg, payload] = submitProfileBankChange.mock.calls[0] as [
      string,
      { bankName: string; attachmentId: string; ext: string },
    ];
    expect(audienceArg).toBe("worker");
    expect(payload.bankName).toBe("กสิกรไทย");
    expect(payload.ext).toBe("jpeg");
    expect(payload.attachmentId).toMatch(/^[0-9a-f-]{36}$/);
    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
  });

  it("surfaces a storage upload failure and never dispatches", async () => {
    mockUpload.mockResolvedValue({ error: { message: "boom", statusCode: "500" } });
    render(
      <ProfileBankSection audience="worker" ownerId={UID} current={null} hasPending={false} />,
    );
    openAndFill();
    pickPhoto();
    fireEvent.click(screen.getByRole("button", { name: "ส่งคำขอเปลี่ยนบัญชี" }));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("ส่งเอกสารไม่สำเร็จ"));
    expect(submitProfileBankChange).not.toHaveBeenCalled();
  });

  it("dispatches with the contractor audience from the contractor mount", async () => {
    const CID = "c2222222-2222-4222-8222-222222222222";
    render(
      <ProfileBankSection audience="contractor" ownerId={CID} current={null} hasPending={false} />,
    );
    openAndFill();
    pickPhoto();
    fireEvent.click(screen.getByRole("button", { name: "ส่งคำขอเปลี่ยนบัญชี" }));
    await waitFor(() => expect(submitProfileBankChange).toHaveBeenCalledTimes(1));
    const [audienceArg] = submitProfileBankChange.mock.calls[0] as [string, unknown];
    expect(audienceArg).toBe("contractor");
    const path = mockUpload.mock.calls[0]?.[0] as string;
    expect(path.startsWith(`contractor/${CID}/`)).toBe(true);
  });
});
