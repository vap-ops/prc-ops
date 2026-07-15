// Spec 320 U2 — PayoutNomineeForm: the PM records a TEMPORARY payout nominee (a
// friend/family bank account) for a bankless worker. Signed-consent photo
// REQUIRED, uploaded to the PM-scoped nominee-consent/<workerId>/ path; the
// action rebuilds the path and calls set_worker_payout_nominee.

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { setPayoutNominee, mockRefresh, mockPush, mockUpload, mockPrepare } = vi.hoisted(() => ({
  setPayoutNominee: vi.fn(),
  mockRefresh: vi.fn(),
  mockPush: vi.fn(),
  mockUpload: vi.fn(),
  mockPrepare: vi.fn(),
}));
vi.mock("@/app/settings/payout-nominees/actions", () => ({ setPayoutNominee }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh, push: mockPush }),
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

import { PayoutNomineeForm } from "@/components/features/payroll/payout-nominee-form";

const WORKER = "a1111111-1111-4111-8111-111111111111";

function fillFields() {
  const [payeeName, relationship, acctNo, acctName] = screen.getAllByRole("textbox");
  fireEvent.change(payeeName!, { target: { value: "สมชาย ใจดี" } });
  fireEvent.change(relationship!, { target: { value: "พี่ชาย" } });
  fireEvent.click(screen.getByRole("button", { name: /กสิกรไทย/ }));
  fireEvent.change(acctNo!, { target: { value: "1112223334" } });
  fireEvent.change(acctName!, { target: { value: "สมชาย ใจดี" } });
}

beforeEach(() => {
  setPayoutNominee.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
  mockPush.mockReset();
  mockUpload.mockReset().mockResolvedValue({ error: null });
  mockPrepare.mockReset().mockResolvedValue({ blob: new Blob(["x"]), ext: "jpeg" });
});

describe("PayoutNomineeForm", () => {
  it("refuses to submit without a consent photo", async () => {
    render(<PayoutNomineeForm workerId={WORKER} initial={null} />);
    fillFields();
    fireEvent.click(screen.getByRole("button", { name: /บันทึกบัญชีตัวแทน/ }));
    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent("กรุณาแนบรูปหนังสือยินยอม"),
    );
    expect(setPayoutNominee).not.toHaveBeenCalled();
  });

  it("refuses a non-numeric account number", async () => {
    render(<PayoutNomineeForm workerId={WORKER} initial={null} />);
    const [payeeName, relationship, acctNo, acctName] = screen.getAllByRole("textbox");
    fireEvent.change(payeeName!, { target: { value: "สมชาย" } });
    fireEvent.change(relationship!, { target: { value: "พี่ชาย" } });
    fireEvent.click(screen.getByRole("button", { name: /กสิกรไทย/ }));
    fireEvent.change(acctNo!, { target: { value: "12ab" } });
    fireEvent.change(acctName!, { target: { value: "สมชาย" } });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "consent.jpg")] } });
    fireEvent.click(screen.getByRole("button", { name: /บันทึกบัญชีตัวแทน/ }));
    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(setPayoutNominee).not.toHaveBeenCalled();
  });

  it("uploads consent to nominee-consent/<workerId>/ then calls setPayoutNominee", async () => {
    render(<PayoutNomineeForm workerId={WORKER} initial={null} />);
    fillFields();
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [new File(["x"], "consent.jpg")] } });
    fireEvent.click(screen.getByRole("button", { name: /บันทึกบัญชีตัวแทน/ }));
    await waitFor(() => expect(setPayoutNominee).toHaveBeenCalledTimes(1));
    const path = mockUpload.mock.calls[0]?.[0] as string;
    expect(path.startsWith(`nominee-consent/${WORKER}/`)).toBe(true);
    const arg = setPayoutNominee.mock.calls[0]?.[0];
    expect(arg).toMatchObject({
      workerId: WORKER,
      payeeName: "สมชาย ใจดี",
      relationship: "พี่ชาย",
    });
  });
});
