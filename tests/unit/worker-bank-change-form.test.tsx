// Spec 170 U4c-2 U2 — WorkerBankChangeForm: a bound DC worker stages a bank-detail
// change from the portal (→ pending → PM approval, the anti-fraud gate). The
// worker analogue of the contractor BankChangeForm; reuses validateBankChange and
// calls the worker submit action. While a request is pending, the form is replaced
// by a waiting notice.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const { submitWorkerBankChange, mockRefresh } = vi.hoisted(() => ({
  submitWorkerBankChange: vi.fn(),
  mockRefresh: vi.fn(),
}));
vi.mock("@/lib/portal/actions", () => ({ submitWorkerBankChange }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mockRefresh }) }));
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

describe("WorkerBankChangeForm", () => {
  beforeEach(() => {
    submitWorkerBankChange.mockReset();
  });

  it("renders the submit form when there is no pending request", () => {
    render(<WorkerBankChangeForm hasPending={false} />);
    expect(screen.getByRole("button", { name: "ส่งคำขอเปลี่ยนบัญชี" })).toBeInTheDocument();
  });

  it("shows a waiting notice (no form) while a request is pending", () => {
    render(<WorkerBankChangeForm hasPending={true} />);
    expect(screen.getByText("คำขอเปลี่ยนบัญชีธนาคารกำลังรอผู้จัดการอนุมัติ")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "ส่งคำขอเปลี่ยนบัญชี" })).not.toBeInTheDocument();
  });
});
