// Spec 343 U1 / D2 — the two required steps used to render AFTER the form's
// full-width primary button. On a phone a full-width primary CTA reads as the
// end of the form, so the id_card upload and the PDPA consent sat below what
// looked like the finish line — and all 4 live pending applicants stopped there.
// These pins fix the DOM order and the CTA's promise.

import { describe, it, expect, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/lib/ui/use-toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
const { updateOwnStaffRegistration } = vi.hoisted(() => ({
  updateOwnStaffRegistration: vi.fn(),
}));
vi.mock("@/lib/register/actions", () => ({
  startStaffRegistration: vi.fn(),
  updateOwnStaffRegistration,
  addStaffRegistrationDoc: vi.fn(),
  recordOwnStaffConsent: vi.fn(),
  recordOwnStaffBank: vi.fn(),
}));
vi.mock("@/lib/db/browser", () => ({
  createClient: () => ({ rpc: () => Promise.resolve({ data: null, error: null }) }),
}));

import { StaffRegistrationForm } from "@/components/features/register/staff-registration-form";
import {
  REGISTER_CONSENT_ANCHOR,
  REGISTER_DOCUMENTS_ANCHOR,
  REGISTER_SAVE_AND_NEXT_LABEL,
} from "@/lib/i18n/labels";

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

function renderForm(props: { docUrls?: Record<string, string>; consentedAt?: string | null }) {
  return render(
    <StaffRegistrationForm
      registrationExists
      uid="00000000-0000-4000-8000-000000000328"
      docUrls={props.docUrls ?? {}}
      consentedAt={props.consentedAt ?? null}
      initial={INITIAL}
      bankExempt
    />,
  );
}

const MET = {
  docUrls: { id_card: "https://example.test/a.jpg" },
  consentedAt: "2026-07-22T13:09:53Z",
};

describe("StaffRegistrationForm — required steps precede the CTA (spec 343 D2)", () => {
  it("renders the document and consent controls BEFORE the primary button", () => {
    const { container } = renderForm({});
    const nodes = Array.from(
      container.querySelectorAll(
        `#${REGISTER_DOCUMENTS_ANCHOR}, #${REGISTER_CONSENT_ANCHOR}, [data-testid='reg-primary']`,
      ),
    );
    const order = nodes.map((n) => n.id || n.getAttribute("data-testid"));
    expect(order).toEqual([REGISTER_DOCUMENTS_ANCHOR, REGISTER_CONSENT_ANCHOR, "reg-primary"]);
  });

  it("gives both anchors a target so the notice's links land somewhere", () => {
    const { container } = renderForm({});
    expect(container.querySelector(`#${REGISTER_DOCUMENTS_ANCHOR}`)).not.toBeNull();
    expect(container.querySelector(`#${REGISTER_CONSENT_ANCHOR}`)).not.toBeNull();
  });

  it("names the next step on the CTA while the floor is unmet", () => {
    renderForm({});
    expect(screen.getByTestId("reg-primary")).toHaveTextContent(REGISTER_SAVE_AND_NEXT_LABEL);
  });

  it("still promises a next step when ONLY the consent is outstanding", () => {
    // Covers the consent arm of nextAnchor on its own. Without this case, every
    // other test has id_card missing too, so the documents anchor wins and the
    // consent arm could be deleted with the suite staying green (found by
    // mutation-check).
    renderForm({ docUrls: { id_card: "https://example.test/a.jpg" } });
    expect(screen.getByTestId("reg-primary")).toHaveTextContent(REGISTER_SAVE_AND_NEXT_LABEL);
  });

  it("reverts to a plain save once the floor is met", () => {
    renderForm(MET);
    const cta = screen.getByTestId("reg-primary");
    expect(cta).toHaveTextContent("บันทึก");
    expect(cta).not.toHaveTextContent("ไปขั้นต่อไป");
  });
});

describe("StaffRegistrationForm — the CTA performs what it promises (spec 343 D2)", () => {
  // The label says "บันทึกและไปขั้นต่อไป". A label naming a step it does not
  // actually perform is the same defect class as the pending notice claiming a
  // submission it does not have — so the scroll is pinned, not just the wording.
  it("scrolls to the first outstanding control after a successful save", async () => {
    const scrollIntoView = vi.fn();
    // jsdom implements no scrollIntoView at all.
    Element.prototype.scrollIntoView = scrollIntoView;
    updateOwnStaffRegistration.mockResolvedValue({ ok: true });

    renderForm({});
    await act(async () => {
      screen.getByTestId("reg-primary").click();
    });

    expect(updateOwnStaffRegistration).toHaveBeenCalled();
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("does NOT yank the page when there is no outstanding step", async () => {
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    updateOwnStaffRegistration.mockResolvedValue({ ok: true });

    renderForm(MET);
    await act(async () => {
      screen.getByTestId("reg-primary").click();
    });

    expect(updateOwnStaffRegistration).toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
