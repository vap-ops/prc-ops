// Writing failing test first.
//
// Spec 321 U4a — <ProfileEditSections audience> is the shared, ordered profile-
// edit block for the canonical door /settings/my-info. It renders the same
// section components every surface already uses (ProfileContactSection,
// ProfileBankSection, plus the staff ID-card renewal), in a fixed order with
// consistent headings, so the door's composition can't drift. This unit covers
// the two audiences /settings/my-info owns: "staff" (contact + docs + bank) and
// "user" (login-keyed bank only). Behaviour is verbatim-preserving vs the prior
// inline my-info blocks.

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

// Child sections are tested on their own — mock them so this test isolates the
// composition (which sections, which audience, what order).
vi.mock("@/components/features/profile/profile-contact-section", () => ({
  ProfileContactSection: ({ audience }: { audience: string }) => (
    <div data-testid="contact-section" data-audience={audience} />
  ),
}));
vi.mock("@/components/features/profile/profile-bank-section", () => ({
  ProfileBankSection: ({
    audience,
    showEmptyState,
    hasPending,
  }: {
    audience: string;
    showEmptyState?: boolean;
    hasPending: boolean;
  }) => (
    <div
      data-testid="bank-section"
      data-audience={audience}
      data-empty={String(Boolean(showEmptyState))}
      data-pending={String(hasPending)}
    />
  ),
}));
vi.mock("@/components/features/portal/worker-id-card-update", () => ({
  WorkerIdCardUpdate: ({ uid, currentUrl }: { uid: string; currentUrl: string | null }) => (
    <div data-testid="idcard" data-uid={uid} data-url={String(currentUrl)} />
  ),
}));

import { ProfileEditSections } from "@/components/features/profile/profile-edit-sections";

const CONTACT = {
  phone: "0810000000",
  emergencyName: "ชื่อฉุกเฉิน",
  emergencyRelation: "พี่สาว",
  emergencyPhone: "0899999999",
};
const BANK = { bankName: "กสิกรไทย", accountNo: "1112223334", accountName: "สมชาย ใจดี" };

describe("ProfileEditSections", () => {
  it("staff: renders contact → docs → bank in that order, all audience=staff", () => {
    const { container } = render(
      <ProfileEditSections
        audience="staff"
        uid="11111111-1111-1111-1111-111111111111"
        contact={CONTACT}
        idCardUrl="https://x/id.jpg"
        bank={BANK}
        hasPendingBank={false}
      />,
    );

    expect(screen.getByText("ข้อมูลติดต่อ")).toBeInTheDocument();
    expect(screen.getByText("เอกสาร")).toBeInTheDocument();
    expect(screen.getByText("บัญชีธนาคาร")).toBeInTheDocument();

    expect(screen.getByTestId("contact-section")).toHaveAttribute("data-audience", "staff");
    expect(screen.getByTestId("bank-section")).toHaveAttribute("data-audience", "staff");
    // staff bank does NOT force the empty-state (matches prior my-info behaviour)
    expect(screen.getByTestId("bank-section")).toHaveAttribute("data-empty", "false");
    expect(screen.getByTestId("idcard")).toHaveAttribute(
      "data-uid",
      "11111111-1111-1111-1111-111111111111",
    );
    expect(screen.getByTestId("idcard")).toHaveAttribute("data-url", "https://x/id.jpg");

    // fixed order: contact section, then id-card, then bank section
    const order = Array.from(container.querySelectorAll("[data-testid]")).map((el) =>
      el.getAttribute("data-testid"),
    );
    expect(order).toEqual(["contact-section", "idcard", "bank-section"]);
  });

  it("staff: a null bank + pending flows through to the bank section", () => {
    render(
      <ProfileEditSections
        audience="staff"
        uid="u1"
        contact={CONTACT}
        idCardUrl={null}
        bank={null}
        hasPendingBank
      />,
    );
    expect(screen.getByTestId("bank-section")).toHaveAttribute("data-pending", "true");
    expect(screen.getByTestId("idcard")).toHaveAttribute("data-url", "null");
  });

  it("user: renders ONLY the bank section (audience=user, empty-state on), no contact/docs", () => {
    render(<ProfileEditSections audience="user" uid="u2" bank={BANK} />);

    expect(screen.getByText("บัญชีธนาคาร")).toBeInTheDocument();
    expect(screen.queryByText("ข้อมูลติดต่อ")).not.toBeInTheDocument();
    expect(screen.queryByText("เอกสาร")).not.toBeInTheDocument();

    expect(screen.queryByTestId("contact-section")).not.toBeInTheDocument();
    expect(screen.queryByTestId("idcard")).not.toBeInTheDocument();
    const bank = screen.getByTestId("bank-section");
    expect(bank).toHaveAttribute("data-audience", "user");
    expect(bank).toHaveAttribute("data-empty", "true");
    expect(bank).toHaveAttribute("data-pending", "false");
  });
});
