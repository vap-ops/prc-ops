// Writing failing test first.
//
// Spec 328 U2 — the register form's subcon (bank-exempt) mode. A member arriving
// via the per-firm QR is pay-exempt: the firm is paid per WP, PRC never collects
// their bank. The form must therefore (a) hide the declared-bank fields, (b) hide
// the book_bank passbook upload row, and (c) let the PDPA consent gate open once
// the NON-bank floor (full_name + id_card + consent) is satisfiable — mirroring
// the approve RPC's contractor arm (mig 075815). PRC mode stays byte-identical.

import { describe, it, expect, vi } from "vitest";
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
vi.mock("@/lib/db/browser", () => ({
  createClient: () => ({
    rpc: () => Promise.resolve({ data: null, error: null }),
  }),
}));

import { StaffRegistrationForm } from "@/components/features/register/staff-registration-form";
import { STAFF_DOC_LABELS } from "@/lib/register/document-types";

const INITIAL = {
  fullName: "สมาชิก ทีมอวย",
  phone: "0810000328",
  dob: "",
  emergencyName: "",
  emergencyRelation: "",
  emergencyPhone: "",
  declaredRoleHint: "",
  bankName: "",
  accountNumber: "",
  accountName: "",
};

function renderExisting(bankExempt: boolean) {
  return render(
    <StaffRegistrationForm
      registrationExists
      uid="00000000-0000-4000-8000-000000000328"
      docUrls={{}}
      consentedAt={null}
      initial={INITIAL}
      bankExempt={bankExempt}
    />,
  );
}

/** Spec 343 — renderExisting hardcodes an empty docUrls and a null consent, so
 *  it cannot express the partially-complete states this unit is about. */
function renderExistingWith(props: {
  bankExempt: boolean;
  docUrls?: Record<string, string>;
  consentedAt?: string | null;
}) {
  return render(
    <StaffRegistrationForm
      registrationExists
      uid="00000000-0000-4000-8000-000000000328"
      docUrls={props.docUrls ?? {}}
      consentedAt={props.consentedAt ?? null}
      initial={INITIAL}
      bankExempt={props.bankExempt}
    />,
  );
}

describe("StaffRegistrationForm — spec 328 bank-exempt (subcon member) mode", () => {
  it("hides the declared-bank section when bankExempt", () => {
    renderExisting(true);
    expect(screen.queryByText(/บัญชีธนาคาร/)).toBeNull();
    expect(screen.queryByLabelText(/เลขที่บัญชี|เลขบัญชี/)).toBeNull();
  });

  it("hides the book_bank passbook upload row when bankExempt", () => {
    renderExisting(true);
    expect(screen.queryByText(STAFF_DOC_LABELS.book_bank)).toBeNull();
    expect(screen.getByText(STAFF_DOC_LABELS.id_card)).toBeInTheDocument();
  });

  it("PRC mode (default) still renders bank fields + the passbook row", () => {
    renderExisting(false);
    expect(screen.getByText(STAFF_DOC_LABELS.book_bank)).toBeInTheDocument();
    expect(screen.getAllByText(/บัญชี/).length).toBeGreaterThan(0);
  });
});

describe("StaffRegistrationForm — outstanding-items hint (spec 343 D3)", () => {
  it("still names the outstanding id_card after consent is given", () => {
    // The hint used to be gated on `!consentedAt`, so it vanished the moment the
    // applicant ticked consent — exactly one step from done, with an id_card
    // still owed and nothing on screen saying so.
    renderExistingWith({ bankExempt: true, consentedAt: "2026-07-22T13:09:53Z" });
    // Asserted by intent, not by the whole sentence: the hint is a STATIC list of
    // every floor requirement, so pinning it verbatim here would also pin the
    // now-satisfied consent clause it still contains (tracker open question).
    const hint = screen.getByText(/ก่อนที่จะได้รับการอนุมัติ/);
    expect(hint).toBeInTheDocument();
    expect(hint).toHaveTextContent("อัปโหลดบัตรประชาชน");
  });

  it("drops the hint once the floor is actually met", () => {
    renderExistingWith({
      bankExempt: true,
      docUrls: { id_card: "https://example.test/a.jpg" },
      consentedAt: "2026-07-22T13:09:53Z",
    });
    expect(screen.queryByText(/ก่อนที่จะได้รับการอนุมัติ/)).toBeNull();
  });
});
