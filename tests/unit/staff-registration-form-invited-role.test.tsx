// tests/unit/staff-registration-form-invited-role.test.tsx
// Writing failing test first.
//
// Spec 342 D2 — an invited office applicant sees the role as read-only fact:
// no input, nothing to get wrong. The free-text
// "คาดว่าจะทำงานตำแหน่งใด" box must be ABSENT (absence pin, not just
// label presence), and the uninvited form must keep it.

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/ui/use-toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/register/actions", () => ({
  startStaffRegistration: vi.fn(),
  updateOwnStaffRegistration: vi.fn(),
  addStaffRegistrationDoc: vi.fn(),
  recordOwnStaffConsent: vi.fn(),
  recordOwnStaffBank: vi.fn(),
}));

import { StaffRegistrationForm } from "@/components/features/register/staff-registration-form";
import { INVITED_ROLE_LABEL, USER_ROLE_LABEL } from "@/lib/i18n/labels";

const BLANK_INITIAL = {
  fullName: "",
  phone: "",
  dob: "",
  emergencyName: "",
  emergencyRelation: "",
  emergencyPhone: "",
  declaredRoleHint: "",
  bankName: "",
  accountNumber: "",
  accountName: "",
};

function renderForm(invitedRole: "accounting" | null) {
  return render(
    <StaffRegistrationForm
      registrationExists={false}
      uid={null}
      docUrls={{}}
      consentedAt={null}
      invitedRole={invitedRole}
      initial={{ ...BLANK_INITIAL, declaredRoleHint: invitedRole ?? "" }}
    />,
  );
}

describe("StaffRegistrationForm — invited role (spec 342)", () => {
  it("invited: shows the role as read-only text and renders NO hint input", () => {
    renderForm("accounting");
    expect(screen.getByText(INVITED_ROLE_LABEL)).toBeInTheDocument();
    expect(screen.getByText(USER_ROLE_LABEL.accounting)).toBeInTheDocument();
    expect(screen.queryByLabelText(/คาดว่าจะทำงานตำแหน่งใด/)).not.toBeInTheDocument();
  });

  it("uninvited: keeps the free-text hint box and shows no invited-role line", () => {
    renderForm(null);
    expect(screen.getByLabelText(/คาดว่าจะทำงานตำแหน่งใด/)).toBeInTheDocument();
    expect(screen.queryByText(INVITED_ROLE_LABEL)).not.toBeInTheDocument();
  });
});
