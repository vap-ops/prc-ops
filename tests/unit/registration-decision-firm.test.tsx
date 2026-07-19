// Writing failing test first.
//
// Spec 328 U3 — RegistrationDecision gains a firm (ผู้รับเหมา) selector so the
// approver CONFIRMS the binding firm; the visitor-supplied invited_contractor_id
// is advisory pre-select ONLY (F2b trust rule: honored only when it matches one
// of the approver's RLS-scoped contractor options, else falls back to empty =
// ทีม PRC). Approving with a firm forwards contractorId; the RPC forces role
// technician for the contractor arm, so the UI keeps the role select on
// technician while a firm is picked (site_admin disabled).

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

const CONTRACTORS = [
  { id: "c1", name: "ช่างอวย" },
  { id: "c2", name: "วุฒินันท์" },
];

beforeEach(() => {
  mockApprove.mockReset().mockResolvedValue({ ok: true });
  mockReject.mockReset().mockResolvedValue({ ok: true });
  mockSendBack.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

describe("RegistrationDecision — firm selector (spec 328 U3)", () => {
  it("renders the firm selector defaulting to ทีม PRC (empty)", () => {
    render(<RegistrationDecision registrationId="reg-1" projects={[]} contractors={CONTRACTORS} />);
    const select = screen.getByLabelText("ทีมผู้รับเหมา") as HTMLSelectElement;
    expect(select.value).toBe("");
    expect(screen.getByText("ช่างอวย")).toBeInTheDocument();
    expect(screen.getByText("วุฒินันท์")).toBeInTheDocument();
  });

  it("pre-selects the invited firm when it is a visible option", () => {
    render(
      <RegistrationDecision
        registrationId="reg-1"
        projects={[]}
        contractors={CONTRACTORS}
        invitedContractorId="c2"
      />,
    );
    const select = screen.getByLabelText("ทีมผู้รับเหมา") as HTMLSelectElement;
    expect(select.value).toBe("c2");
  });

  it("falls back to empty when the invited firm is not a visible option (forged/stale)", () => {
    render(
      <RegistrationDecision
        registrationId="reg-1"
        projects={[]}
        contractors={CONTRACTORS}
        invitedContractorId="forged-id"
      />,
    );
    const select = screen.getByLabelText("ทีมผู้รับเหมา") as HTMLSelectElement;
    expect(select.value).toBe("");
  });

  it("approving with a firm forwards contractorId and keeps role technician", async () => {
    render(
      <RegistrationDecision
        registrationId="reg-1"
        projects={[]}
        contractors={CONTRACTORS}
        invitedContractorId="c1"
      />,
    );
    // While a firm is picked, the non-technician option is disabled.
    const saOption = screen.getByRole("option", { name: "ผู้ดูแลหน้างาน" }) as HTMLOptionElement;
    expect(saOption.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: "อนุมัติ" }));
    await waitFor(() => expect(mockApprove).toHaveBeenCalled());
    expect(mockApprove).toHaveBeenCalledWith(
      expect.objectContaining({ contractorId: "c1", role: "technician" }),
    );
  });

  it("switching the role to site_admin snaps back to technician when a firm is then picked", () => {
    render(<RegistrationDecision registrationId="reg-1" projects={[]} contractors={CONTRACTORS} />);
    const roleSelect = screen.getByLabelText("มอบหมายบทบาท") as HTMLSelectElement;
    fireEvent.change(roleSelect, { target: { value: "site_admin" } });
    expect(roleSelect.value).toBe("site_admin");

    const firmSelect = screen.getByLabelText("ทีมผู้รับเหมา") as HTMLSelectElement;
    fireEvent.change(firmSelect, { target: { value: "c1" } });
    expect(roleSelect.value).toBe("technician");
  });

  it("approving without a firm sends contractorId null", async () => {
    render(<RegistrationDecision registrationId="reg-1" projects={[]} contractors={CONTRACTORS} />);
    fireEvent.click(screen.getByRole("button", { name: "อนุมัติ" }));
    await waitFor(() => expect(mockApprove).toHaveBeenCalled());
    expect(mockApprove).toHaveBeenCalledWith(expect.objectContaining({ contractorId: null }));
  });
});
