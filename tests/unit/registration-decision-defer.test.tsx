// Writing failing test first.
//
// Spec 333 U2 — the decision sheet approves office hires with deferred
// documents:
// (1) the role selector is the documented SSOT (STAFF_ONBOARDABLE_ROLES) in
//     two optgroups — หน้างาน (technician, site_admin) and ออฟฟิศ (the rest) —
//     superseding the 2026-07-08 two-role narrowing (operator directive
//     2026-07-21: the legal-dept hires are approved through this queue);
// (2) a ส่งเอกสารภายหลัง checkbox appears ONLY for a non-technician role with
//     no firm picked; ticking it forwards deferDocuments: true to the approve
//     action (the RPC is the sole gate — the sheet has no client floor gate);
// (3) switching back to technician (or picking a firm) hides AND clears it.

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
import { STAFF_ONBOARDABLE_ROLES } from "@/lib/auth/role-home";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";

const DEFER_LABEL = "ส่งเอกสารภายหลัง";

beforeEach(() => {
  mockApprove.mockReset().mockResolvedValue({ ok: true });
  mockReject.mockReset().mockResolvedValue({ ok: true });
  mockSendBack.mockReset().mockResolvedValue({ ok: true });
  mockRefresh.mockReset();
});

describe("RegistrationDecision — role selector SSOT (spec 333 U2a)", () => {
  it("offers every STAFF_ONBOARDABLE_ROLES option, grouped หน้างาน/ออฟฟิศ", () => {
    render(<RegistrationDecision registrationId="reg-1" projects={[]} contractors={[]} />);
    for (const role of STAFF_ONBOARDABLE_ROLES) {
      expect(screen.getByRole("option", { name: USER_ROLE_LABEL[role] })).toBeInTheDocument();
    }
    expect(screen.getByRole("group", { name: "หน้างาน" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "ออฟฟิศ" })).toBeInTheDocument();
  });

  it("still defaults to technician", () => {
    render(<RegistrationDecision registrationId="reg-1" projects={[]} contractors={[]} />);
    const roleSelect = screen.getByLabelText("มอบหมายบทบาท") as HTMLSelectElement;
    expect(roleSelect.value).toBe("technician");
  });

  it("disables every non-technician option (office included) while a firm is picked", () => {
    render(
      <RegistrationDecision
        registrationId="reg-1"
        projects={[]}
        contractors={[{ id: "c1", name: "ช่างอวย" }]}
        invitedContractorId="c1"
      />,
    );
    const legalOption = screen.getByRole("option", {
      name: USER_ROLE_LABEL.legal,
    }) as HTMLOptionElement;
    expect(legalOption.disabled).toBe(true);
  });
});

describe("RegistrationDecision — ส่งเอกสารภายหลัง (spec 333 U2b)", () => {
  it("hides the defer checkbox for the default technician role", () => {
    render(<RegistrationDecision registrationId="reg-1" projects={[]} contractors={[]} />);
    expect(screen.queryByLabelText(DEFER_LABEL)).not.toBeInTheDocument();
  });

  it("shows it for an office role and forwards deferDocuments: true when ticked", async () => {
    render(<RegistrationDecision registrationId="reg-1" projects={[]} contractors={[]} />);
    const roleSelect = screen.getByLabelText("มอบหมายบทบาท") as HTMLSelectElement;
    fireEvent.change(roleSelect, { target: { value: "legal" } });

    const checkbox = screen.getByLabelText(DEFER_LABEL) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);

    fireEvent.click(screen.getByRole("button", { name: "อนุมัติ" }));
    await waitFor(() => expect(mockApprove).toHaveBeenCalled());
    expect(mockApprove).toHaveBeenCalledWith(
      expect.objectContaining({ role: "legal", deferDocuments: true }),
    );
  });

  it("approves an office role WITHOUT deferral when the box stays unticked", async () => {
    render(<RegistrationDecision registrationId="reg-1" projects={[]} contractors={[]} />);
    fireEvent.change(screen.getByLabelText("มอบหมายบทบาท"), { target: { value: "legal" } });
    fireEvent.click(screen.getByRole("button", { name: "อนุมัติ" }));
    await waitFor(() => expect(mockApprove).toHaveBeenCalled());
    expect(mockApprove).toHaveBeenCalledWith(
      expect.objectContaining({ role: "legal", deferDocuments: false }),
    );
  });

  it("clears AND hides the checkbox when the role returns to technician", async () => {
    render(<RegistrationDecision registrationId="reg-1" projects={[]} contractors={[]} />);
    const roleSelect = screen.getByLabelText("มอบหมายบทบาท") as HTMLSelectElement;
    fireEvent.change(roleSelect, { target: { value: "legal" } });
    fireEvent.click(screen.getByLabelText(DEFER_LABEL));
    fireEvent.change(roleSelect, { target: { value: "technician" } });
    expect(screen.queryByLabelText(DEFER_LABEL)).not.toBeInTheDocument();

    // The tick must not survive the round-trip: re-picking an office role
    // starts UNTICKED (a stale hidden true would silently defer).
    fireEvent.change(roleSelect, { target: { value: "legal" } });
    expect((screen.getByLabelText(DEFER_LABEL) as HTMLInputElement).checked).toBe(false);
    fireEvent.change(roleSelect, { target: { value: "technician" } });

    fireEvent.click(screen.getByRole("button", { name: "อนุมัติ" }));
    await waitFor(() => expect(mockApprove).toHaveBeenCalled());
    expect(mockApprove).toHaveBeenCalledWith(
      expect.objectContaining({ role: "technician", deferDocuments: false }),
    );
  });

  it("picking a firm hides the checkbox (the contractor arm is never deferred)", () => {
    render(
      <RegistrationDecision
        registrationId="reg-1"
        projects={[]}
        contractors={[{ id: "c1", name: "ช่างอวย" }]}
      />,
    );
    const roleSelect = screen.getByLabelText("มอบหมายบทบาท") as HTMLSelectElement;
    fireEvent.change(roleSelect, { target: { value: "legal" } });
    expect(screen.getByLabelText(DEFER_LABEL)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText("ทีมผู้รับเหมา"), { target: { value: "c1" } });
    expect(screen.queryByLabelText(DEFER_LABEL)).not.toBeInTheDocument();
  });
});
