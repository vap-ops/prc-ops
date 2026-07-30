// Writing failing test first.
//
// Spec 376 U4 (§3.3, D5) — the shared-phone register door. A new ช่าง scans the
// site's register QR on a phone that still carries SOMEONE ELSE's live session
// and lands inside that account: the technician arm silently redirects to that
// person's home, and every other signed-in role drops into the fresh form under
// their identity — "no form and no explanation" either way (real spec-328 pilot
// risk). The fix is an interstitial that NAMES whose session this is and offers
// exactly one way forward: log out and come BACK to this same door with the QR's
// attribution params intact (they are mint-once — start_staff_registration binds
// project/contractor/inviter, so losing them loses the binding for good).
//
// The question is "is this session's owner the person registering?", NOT "is
// their role visitor?" — a role-only rule locks out any signed-in applicant whose
// own registration is still in flight. Constraint (live, 2026-07-30): two `legal`
// users hold `pending` own registrations whose only remaining step is to reopen
// this page and tick PDPA, and the spec-333 deferred-docs view is served here to
// approved office roles. So: foreign ⇔ a session exists AND that user has no own
// registration THIS DOOR STILL SERVES.
//
// Four pins live here:
//   1. isForeignSession over the WHOLE live role domain (Object.keys of the
//      USER_ROLE_LABEL Record<UserRole, …>) — the exact positive set in both
//      registration directions, so adding an enum value REDS this file and
//      forces a deliberate classification.
//   2. servesOwnRegistration — which own rows the door renders (that is what
//      makes the session the registrant's own).
//   3. The mount seam on BOTH register doors: foreign session → notice and the
//      workspace is NOT rendered; a visitor, and anyone whose own registration
//      is still served, gets the workspace untouched.
//   4. The screen's TWO ways out, and a heading true of both. The predicate
//      classifies as borrowed a session whose owner IS the person holding the
//      phone — every `technician` (13 live users re-scanning the site poster on
//      their OWN phone) and the site admin who printed it. So the heading may
//      not assert someone ELSE is signed in, and logout-only was a loop: it
//      returns to this same door, and logging back in with the same LINE
//      identity lands here again with no in-app break (the page renders no
//      bottom bar, no hub strip, no home link). The secondary exit is
//      roleHome() for the signed-in account.

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getClaims, row, getReg, getDocs, getBank } = vi.hoisted(() => ({
  getClaims: vi.fn(),
  row: {
    current: null as {
      role: string;
      full_name: string | null;
      line_display_name: string | null;
    } | null,
  },
  getReg: vi.fn(),
  getDocs: vi.fn(),
  getBank: vi.fn(),
}));

vi.mock("@/lib/db/server", () => ({
  createClient: async () => ({
    auth: { getClaims },
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: row.current }) }),
      }),
    }),
  }),
}));

vi.mock("@/lib/register/own-registration", () => ({
  getOwnTechnicianRegistration: getReg,
  getOwnRegistrationDocuments: getDocs,
  getOwnStaffBank: getBank,
}));

// The gate renders null and probes /api/health on mount — irrelevant here, and
// its route wiring is pinned by source count in register-freshness-gate-wiring.
vi.mock("@/components/features/chrome/register-freshness-gate", () => ({
  RegisterFreshnessGate: () => null,
}));

// Stubbed so "the workspace did NOT render" is an assertion about the MOUNT,
// not about the workspace's own (async, deeply-mocked) body.
vi.mock("@/components/features/register/staff-register-workspace", () => ({
  StaffRegisterWorkspace: (props: { variant: string }) => (
    <div data-testid="register-workspace" data-variant={props.variant} />
  ),
}));

import RegisterTechnicianPage from "@/app/register/technician/page";
import RegisterOfficePage from "@/app/register/office/page";
import { ForeignSessionNotice } from "@/components/features/register/foreign-session-notice";
import { isForeignSession, servesOwnRegistration } from "@/lib/register/foreign-session";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";
import { Constants } from "@/lib/db/database.types";
import type { UserRole } from "@/lib/db/enums";

const UID = "a4000376-0000-4000-8000-000000000376";
const REG_ID = "b4000376-0000-4000-8000-000000000376";
const PROJECT = "123e4567-e89b-12d3-a456-426614174000";
const BY = "223e4567-e89b-12d3-a456-426614174000";
const CONTRACTOR = "323e4567-e89b-12d3-a456-426614174000";

const LOGOUT_LABEL = "ออกจากระบบเพื่อสมัครใหม่";
const HOME_LABEL = "ไปหน้าหลัก";
const NEUTRAL_HEADING = "เครื่องนี้มีการเข้าสู่ระบบอยู่แล้ว";

const ROLES = Object.keys(USER_ROLE_LABEL) as UserRole[];

// The exact positive set WHEN THE USER HOLDS NO SERVED REGISTRATION, pinned as a
// literal (not `ROLES.filter(r => r !== "visitor")`, which would silently
// auto-classify a newly added role).
const FOREIGN_WHEN_UNREGISTERED: UserRole[] = [
  "accounting",
  "auditor",
  "client",
  "contractor",
  "hr",
  "legal",
  "procurement",
  "procurement_manager",
  "project_coordinator",
  "project_director",
  "project_manager",
  "site_admin",
  "site_owner",
  "subcon_manager",
  "super_admin",
  "technician",
];

function sorted(roles: readonly UserRole[]): UserRole[] {
  return [...roles].sort();
}

function logoutAction(): string {
  const button = screen.getByRole("button", { name: LOGOUT_LABEL });
  const form = button.closest("form");
  return form?.getAttribute("action") ?? "";
}

/** The `next` the logout form carries, decoded back to a same-origin path. */
function logoutReturnTo(): URL {
  const action = new URL(logoutAction(), "https://prc.invalid");
  return new URL(action.searchParams.get("next") ?? "", "https://prc.invalid");
}

/** The secondary exit. Queried BY ROLE, so it only resolves for an element the
 * a11y tree exposes as a link — i.e. an <a> that carries an href, which is also
 * exactly what makes it a real tab stop (a bare <a> is role=generic and
 * unfocusable). */
function homeLink(): HTMLAnchorElement {
  return screen.getByRole("link", { name: HOME_LABEL }) as HTMLAnchorElement;
}

beforeEach(() => {
  getClaims.mockReset().mockResolvedValue({ data: { claims: { sub: UID } } });
  row.current = null;
  getReg.mockReset().mockResolvedValue(null);
  // Nothing uploaded, no bank row → a deferred approval OWES all three.
  getDocs.mockReset().mockResolvedValue({ urls: {} });
  getBank.mockReset().mockResolvedValue(null);
});

describe("isForeignSession — exhaustive over the live role domain", () => {
  it("classifies every role in the domain (an enum add must land here)", () => {
    expect(sorted([...FOREIGN_WHEN_UNREGISTERED, "visitor"])).toEqual(sorted(ROLES));
  });

  it("no served registration → every role except visitor is a borrowed session", () => {
    const foreign = ROLES.filter((role) => isForeignSession({ role, hasOwnRegistration: false }));
    expect(sorted(foreign)).toEqual(sorted(FOREIGN_WHEN_UNREGISTERED));
  });

  // `technician` is the exception in BOTH directions: staff-register-workspace
  // redirects that role home BEFORE it ever reads the registration, so no row can
  // make the door serve them — and being bounced into someone's home with no
  // explanation is U4's headline symptom. Paired pin on the workspace's own
  // redirect lives in staff-register-workspace-prep.test.tsx.
  it("a served registration clears every role EXCEPT technician", () => {
    const foreign = ROLES.filter((role) => isForeignSession({ role, hasOwnRegistration: true }));
    expect(foreign).toEqual(["technician"]);
  });

  it("a visitor is the registrant — own registration or not, never foreign", () => {
    expect(isForeignSession({ role: "visitor", hasOwnRegistration: false })).toBe(false);
    expect(isForeignSession({ role: "visitor", hasOwnRegistration: true })).toBe(false);
  });

  // Constraint, not a story: a served office role must reach its own workspace.
  // Two live `legal` users hold pending registrations whose only remaining step
  // is on this page; a role-only rule would lock them out of it.
  it("role `legal` with a pending own registration is NOT foreign", () => {
    expect(isForeignSession({ role: "legal", hasOwnRegistration: true })).toBe(false);
    expect(isForeignSession({ role: "legal", hasOwnRegistration: false })).toBe(true);
  });
});

describe("servesOwnRegistration — which own rows the door still renders", () => {
  // Exhaustive over the live registration_status domain, same discipline as the
  // role domain: a new status value reds this instead of silently suppressing
  // the notice for it.
  const STATUSES = Constants.public.Enums.registration_status;

  it("no deferral: exactly pending + rejected are served", () => {
    const served = STATUSES.filter((status) =>
      servesOwnRegistration({ status, documentsDeferredAt: null, deferredDocsOwed: false }),
    );
    expect([...served].sort()).toEqual(["pending", "rejected"]);
  });

  it("a deferred stamp changes nothing for a non-approved status", () => {
    const served = STATUSES.filter((status) =>
      servesOwnRegistration({
        status,
        documentsDeferredAt: "2026-07-21T00:00:00Z",
        deferredDocsOwed: true,
      }),
    );
    expect([...served].sort()).toEqual(["approved", "pending", "rejected"]);
  });

  it("a deferred approval is served only while something is still owed", () => {
    const deferredAt = "2026-07-21T00:00:00Z";
    expect(
      servesOwnRegistration({
        status: "approved",
        documentsDeferredAt: deferredAt,
        deferredDocsOwed: true,
      }),
    ).toBe(true);
    // Documents complete → the workspace redirects home and renders NOTHING, so
    // calling it served would suppress the notice for this class forever (the
    // stamp is never cleared anywhere in src/ or the migrations).
    expect(
      servesOwnRegistration({
        status: "approved",
        documentsDeferredAt: deferredAt,
        deferredDocsOwed: false,
      }),
    ).toBe(false);
  });

  it("a plain approved row is NOT served — the door only redirects it home", () => {
    expect(
      servesOwnRegistration({
        status: "approved",
        documentsDeferredAt: null,
        deferredDocsOwed: false,
      }),
    ).toBe(false);
  });

  it("no row at all is not served", () => {
    expect(servesOwnRegistration(null)).toBe(false);
  });
});

describe("ForeignSessionNotice", () => {
  it("names the signed-in user and points at the logout button by its real label", () => {
    render(
      <ForeignSessionNotice
        displayName="สมชาย ใจดี"
        returnTo="/register/technician?site=โพธิ์ทอง"
        homeHref="/technician"
      />,
    );
    expect(screen.getByText(NEUTRAL_HEADING)).toBeInTheDocument();
    expect(screen.getByText("เข้าสู่ระบบในชื่อ สมชาย ใจดี อยู่")).toBeInTheDocument();
    expect(
      screen.getByText(
        "หากนี่ไม่ใช่บัญชีของท่าน กดปุ่ม “ออกจากระบบเพื่อสมัครใหม่” ด้านล่าง แล้วสมัครด้วยบัญชีของท่านเอง",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: LOGOUT_LABEL })).toBeInTheDocument();
  });

  // The heading is FALSE for the case the predicate cannot distinguish: a
  // technician re-scanning the site poster on their own phone is classified
  // borrowed (the role is always foreign — the workspace bounces it home before
  // it reads a row), and so is the site admin who printed the poster. Pinned as
  // a BARE substring so reverting to the old wording reds this whether the
  // literal is quoted, interpolated, or written as JSX text.
  it("never claims the session belongs to someone ELSE", () => {
    const { container } = render(
      <ForeignSessionNotice
        displayName="สมชาย ใจดี"
        returnTo="/register/technician"
        homeHref="/technician"
      />,
    );
    expect(container.textContent).toContain(NEUTRAL_HEADING);
    expect(container.textContent).not.toContain("มีคนอื่น");
  });

  it("logs out BACK to the door it was rendered on, params intact", () => {
    render(
      <ForeignSessionNotice
        displayName="สมชาย ใจดี"
        returnTo={`/register/technician?project=${PROJECT}&site=โพธิ์ทอง`}
        homeHref="/technician"
      />,
    );
    const returnTo = logoutReturnTo();
    expect(logoutAction().startsWith("/auth/logout?next=")).toBe(true);
    expect(returnTo.pathname).toBe("/register/technician");
    expect(returnTo.searchParams.get("project")).toBe(PROJECT);
    expect(returnTo.searchParams.get("site")).toBe("โพธิ์ทอง");
  });

  // Logout alone was a closed loop: it returns to THIS door, and signing back in
  // with the same LINE identity lands here again. Nothing else on the page
  // breaks it — no bottom bar, no hub strip. So exactly two ways out, logout
  // first (the primary) and the account's own home second.
  it("offers the logout primary plus exactly one secondary exit", () => {
    render(
      <ForeignSessionNotice
        displayName="สมชาย ใจดี"
        returnTo="/register/technician"
        homeHref="/technician"
      />,
    );
    expect(screen.getAllByRole("button")).toHaveLength(1);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0]).toBe(homeLink());
    // Secondary = it comes AFTER the primary in DOM (and so in tab) order.
    const button = screen.getByRole("button", { name: LOGOUT_LABEL });
    expect(
      button.compareDocumentPosition(homeLink()) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("the secondary exit is a real tab stop pointing at the given home", () => {
    render(
      <ForeignSessionNotice
        displayName="อรุณี ผู้ดูแล"
        returnTo="/register/technician"
        homeHref="/dashboard"
      />,
    );
    const link = homeLink();
    expect(link.tagName).toBe("A");
    expect(link.getAttribute("href")).toBe("/dashboard");
    // Never removed from the tab order — this is the only in-app break in the
    // logout↔re-login loop for a user standing in their OWN account.
    expect(link.getAttribute("tabindex")).toBeNull();
    expect(link.getAttribute("aria-disabled")).toBeNull();
  });
});

describe("register doors mount the interstitial ahead of the workspace", () => {
  it("field door: a foreign session sees the notice, never the workspace", async () => {
    row.current = { role: "super_admin", full_name: "อรุณี ผู้ดูแล", line_display_name: null };
    render(
      await RegisterTechnicianPage({
        searchParams: Promise.resolve({
          site: "TFM โพธิ์ทอง",
          project: PROJECT,
          by: BY,
          contractor: CONTRACTOR,
          firm: "ช่างอวย",
        }),
      }),
    );
    expect(screen.getByText("เข้าสู่ระบบในชื่อ อรุณี ผู้ดูแล อยู่")).toBeInTheDocument();
    expect(screen.queryByTestId("register-workspace")).toBeNull();
  });

  // The secondary exit is resolved from the role the session read ALREADY has,
  // through roleHome() — no second read, and no per-role branch in the door.
  // Driven through the page (not the component) so the resolution itself is
  // pinned, for two roles whose homes differ.
  it("field door: the secondary exit is the signed-in role's own roleHome", async () => {
    row.current = { role: "technician", full_name: "ช่างเก่า", line_display_name: null };
    render(await RegisterTechnicianPage({ searchParams: Promise.resolve({ project: PROJECT }) }));
    expect(homeLink().getAttribute("href")).toBe("/technician");
  });

  it("field door: a super_admin's secondary exit is the PM home, not the ช่าง one", async () => {
    row.current = { role: "super_admin", full_name: "อรุณี ผู้ดูแล", line_display_name: null };
    render(await RegisterTechnicianPage({ searchParams: Promise.resolve({ project: PROJECT }) }));
    expect(homeLink().getAttribute("href")).toBe("/dashboard");
  });

  it("field door: the logout return path keeps every QR attribution param", async () => {
    row.current = { role: "technician", full_name: "ช่างเก่า", line_display_name: null };
    render(
      await RegisterTechnicianPage({
        searchParams: Promise.resolve({
          site: "TFM โพธิ์ทอง",
          project: PROJECT,
          by: BY,
          contractor: CONTRACTOR,
          firm: "ช่างอวย",
        }),
      }),
    );
    const returnTo = logoutReturnTo();
    expect(returnTo.pathname).toBe("/register/technician");
    expect(returnTo.searchParams.get("project")).toBe(PROJECT);
    expect(returnTo.searchParams.get("by")).toBe(BY);
    expect(returnTo.searchParams.get("contractor")).toBe(CONTRACTOR);
    expect(returnTo.searchParams.get("site")).toBe("TFM โพธิ์ทอง");
    expect(returnTo.searchParams.get("firm")).toBe("ช่างอวย");
  });

  it("field door: a visitor is the registrant and still gets the workspace", async () => {
    row.current = { role: "visitor", full_name: "ช่างใหม่", line_display_name: null };
    render(await RegisterTechnicianPage({ searchParams: Promise.resolve({ project: PROJECT }) }));
    expect(screen.getByTestId("register-workspace")).toHaveAttribute("data-variant", "field");
    expect(screen.queryByText(/เข้าสู่ระบบในชื่อ/)).toBeNull();
  });

  it("field door: an approved ช่าง's session is still borrowed — notice, not a silent home redirect", async () => {
    // The headline hazard: nearly every ช่าง login HAS a registration row, so
    // "any row" would have to leave this case in the old silent-redirect state.
    row.current = { role: "technician", full_name: "ช่างเก่า", line_display_name: null };
    getReg.mockResolvedValue({ id: REG_ID, status: "approved", documents_deferred_at: null });
    render(await RegisterTechnicianPage({ searchParams: Promise.resolve({ project: PROJECT }) }));
    expect(screen.getByText("เข้าสู่ระบบในชื่อ ช่างเก่า อยู่")).toBeInTheDocument();
    expect(screen.queryByTestId("register-workspace")).toBeNull();
  });

  it("field door: an office applicant mid-registration reaches their OWN workspace", async () => {
    row.current = { role: "legal", full_name: "จารุวัฒน์", line_display_name: null };
    getReg.mockResolvedValue({ id: REG_ID, status: "pending", documents_deferred_at: null });
    render(await RegisterTechnicianPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByTestId("register-workspace")).toBeInTheDocument();
    expect(screen.queryByText(/เข้าสู่ระบบในชื่อ/)).toBeNull();
  });

  it("field door: a deferred-docs row with documents still owed is served", async () => {
    row.current = { role: "accounting", full_name: "ณัฐวุฒิ", line_display_name: null };
    getReg.mockResolvedValue({
      id: REG_ID,
      status: "approved",
      documents_deferred_at: "2026-07-21T00:00:00Z",
    });
    render(await RegisterTechnicianPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByTestId("register-workspace")).toBeInTheDocument();
  });

  it("field door: a deferred-docs row with NOTHING owed is borrowed — the door only redirects it", async () => {
    // The stamp is never cleared, so "any deferred row is served" would suppress
    // the notice for this person forever while the door silently bounces them.
    row.current = { role: "accounting", full_name: "ณัฐวุฒิ", line_display_name: null };
    getReg.mockResolvedValue({
      id: REG_ID,
      status: "approved",
      documents_deferred_at: "2026-07-21T00:00:00Z",
    });
    getDocs.mockResolvedValue({ urls: { id_card: "signed://id", book_bank: "signed://bb" } });
    getBank.mockResolvedValue({ bankName: "kbank", accountNumber: "1", accountName: "ณัฐวุฒิ" });
    render(await RegisterTechnicianPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("เข้าสู่ระบบในชื่อ ณัฐวุฒิ อยู่")).toBeInTheDocument();
    expect(screen.queryByTestId("register-workspace")).toBeNull();
  });

  it("field door: a technician is borrowed even mid-registration — the door bounces the role home", async () => {
    row.current = { role: "technician", full_name: "ช่างเก่า", line_display_name: null };
    getReg.mockResolvedValue({ id: REG_ID, status: "pending", documents_deferred_at: null });
    render(await RegisterTechnicianPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByText("เข้าสู่ระบบในชื่อ ช่างเก่า อยู่")).toBeInTheDocument();
    expect(screen.queryByTestId("register-workspace")).toBeNull();
  });

  it("field door: a logged-out scan falls through to the workspace's login redirect", async () => {
    getClaims.mockResolvedValue({ data: null });
    render(await RegisterTechnicianPage({ searchParams: Promise.resolve({}) }));
    expect(screen.getByTestId("register-workspace")).toBeInTheDocument();
  });

  it("office door: same interstitial, invite params kept through logout", async () => {
    row.current = { role: "accounting", full_name: null, line_display_name: "Nok LINE" };
    render(await RegisterOfficePage({ searchParams: Promise.resolve({ by: BY, role: "hr" }) }));
    expect(screen.getByText("เข้าสู่ระบบในชื่อ Nok LINE อยู่")).toBeInTheDocument();
    expect(screen.queryByTestId("register-workspace")).toBeNull();
    const returnTo = logoutReturnTo();
    expect(returnTo.pathname).toBe("/register/office");
    expect(returnTo.searchParams.get("by")).toBe(BY);
    expect(returnTo.searchParams.get("role")).toBe("hr");
  });

  it("office door: a visitor with a valid invite still reaches the workspace", async () => {
    row.current = { role: "visitor", full_name: null, line_display_name: null };
    render(await RegisterOfficePage({ searchParams: Promise.resolve({ by: BY, role: "hr" }) }));
    expect(screen.getByTestId("register-workspace")).toHaveAttribute("data-variant", "office");
  });

  it("office door: a `legal` applicant with a pending registration is not locked out", async () => {
    row.current = { role: "legal", full_name: "จารุวัฒน์", line_display_name: null };
    getReg.mockResolvedValue({ id: REG_ID, status: "pending", documents_deferred_at: null });
    render(await RegisterOfficePage({ searchParams: Promise.resolve({ by: BY, role: "legal" }) }));
    expect(screen.getByTestId("register-workspace")).toHaveAttribute("data-variant", "office");
    expect(screen.queryByText(/เข้าสู่ระบบในชื่อ/)).toBeNull();
  });

  it("a nameless account is still identified — by its role label, never blank", async () => {
    row.current = { role: "procurement", full_name: null, line_display_name: null };
    render(await RegisterTechnicianPage({ searchParams: Promise.resolve({}) }));
    expect(
      screen.getByText(`เข้าสู่ระบบในชื่อ ${USER_ROLE_LABEL.procurement} อยู่`),
    ).toBeInTheDocument();
  });
});
