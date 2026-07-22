// tests/unit/registration-decision-invited-role.test.tsx
// Writing failing test first.
//
// Spec 342 U3 — the approver's selector defaults to the invited role when
// declared_role_hint parses as an onboardable role; legacy prose keeps the
// technician default. The URL never binds (D5) — this is a prefill, the
// approver still confirms. A firm pre-select outranks the invite (the RPC's
// contractor arm is technician-only).

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/ui/use-toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/app/registrations/actions", () => ({
  approveStaffRegistration: vi.fn(),
  rejectStaffRegistration: vi.fn(),
  sendBackStaffRegistration: vi.fn(),
}));

import { RegistrationDecision } from "@/components/features/registrations/registration-decision";
import { INVITED_ROLE_LABEL, USER_ROLE_LABEL } from "@/lib/i18n/labels";

const REG = "423e4567-e89b-12d3-a456-426614174000";
const FIRM = "523e4567-e89b-12d3-a456-426614174000";

describe("RegistrationDecision — invited role prefill (spec 342 U3)", () => {
  it("defaults the selector to a parsed role key and labels it as invited", () => {
    render(<RegistrationDecision registrationId={REG} declaredRoleHint="accounting" />);
    expect(screen.getByLabelText("มอบหมายบทบาท")).toHaveValue("accounting");
    expect(
      screen.getByText(`${INVITED_ROLE_LABEL}: ${USER_ROLE_LABEL.accounting}`),
    ).toBeInTheDocument();
  });

  it("legacy prose keeps the technician default and the declared-by display", () => {
    render(<RegistrationDecision registrationId={REG} declaredRoleHint="จัดซื้อ" />);
    expect(screen.getByLabelText("มอบหมายบทบาท")).toHaveValue("technician");
    expect(screen.getByText("ผู้สมัครระบุว่า: จัดซื้อ")).toBeInTheDocument();
  });

  it("a firm pre-select outranks the invited role (contractor arm is technician-only)", () => {
    render(
      <RegistrationDecision
        registrationId={REG}
        declaredRoleHint="accounting"
        contractors={[{ id: FIRM, name: "ช่างอวย" }]}
        invitedContractorId={FIRM}
      />,
    );
    expect(screen.getByLabelText("มอบหมายบทบาท")).toHaveValue("technician");
  });
});
