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
// Two pins live here:
//   1. isForeignSession over the WHOLE live role domain (Object.keys of the
//      USER_ROLE_LABEL Record<UserRole, …>) — the exact positive set, so adding
//      an enum value REDS this file and forces a deliberate classification.
//   2. The mount seam on BOTH register doors: foreign session → notice and the
//      workspace is NOT rendered; a visitor (the actual registrant, with or
//      without their own registration) still gets the workspace untouched.

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getClaims, row } = vi.hoisted(() => ({
  getClaims: vi.fn(),
  row: {
    current: null as {
      role: string;
      full_name: string | null;
      line_display_name: string | null;
    } | null,
  },
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
import { isForeignSession } from "@/lib/register/foreign-session";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";
import type { UserRole } from "@/lib/db/enums";

const UID = "a4000376-0000-4000-8000-000000000376";
const PROJECT = "123e4567-e89b-12d3-a456-426614174000";
const BY = "223e4567-e89b-12d3-a456-426614174000";
const CONTRACTOR = "323e4567-e89b-12d3-a456-426614174000";

const LOGOUT_LABEL = "ออกจากระบบเพื่อสมัครใหม่";

const ROLES = Object.keys(USER_ROLE_LABEL) as UserRole[];

// The exact positive set, pinned as a literal (not `ROLES.filter(r => r !==
// "visitor")`, which would silently auto-classify a newly added role).
const FOREIGN_ROLES: UserRole[] = [
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

beforeEach(() => {
  getClaims.mockReset().mockResolvedValue({ data: { claims: { sub: UID } } });
  row.current = null;
});

describe("isForeignSession — exhaustive over the live role domain", () => {
  it("classifies every role in the domain (an enum add must land here)", () => {
    expect(sorted([...FOREIGN_ROLES, "visitor"])).toEqual(sorted(ROLES));
  });

  it("every role except visitor is a borrowed session", () => {
    const foreign = ROLES.filter((role) => isForeignSession({ role }));
    expect(sorted(foreign)).toEqual(sorted(FOREIGN_ROLES));
  });

  it("a visitor is the registrant — own registration or not, never foreign", () => {
    expect(isForeignSession({ role: "visitor" })).toBe(false);
    expect(isForeignSession({ role: "visitor", hasOwnRegistration: false })).toBe(false);
    expect(isForeignSession({ role: "visitor", hasOwnRegistration: true })).toBe(false);
  });

  it("an own registration never rescues a non-visitor role either", () => {
    const foreign = ROLES.filter((role) => isForeignSession({ role, hasOwnRegistration: true }));
    expect(sorted(foreign)).toEqual(sorted(FOREIGN_ROLES));
  });
});

describe("ForeignSessionNotice", () => {
  it("names the signed-in user and points at the logout button by its real label", () => {
    render(
      <ForeignSessionNotice
        displayName="สมชาย ใจดี"
        returnTo="/register/technician?site=โพธิ์ทอง"
      />,
    );
    expect(screen.getByText("เครื่องนี้มีคนอื่นเข้าสู่ระบบอยู่")).toBeInTheDocument();
    expect(screen.getByText("เข้าสู่ระบบในชื่อ สมชาย ใจดี อยู่")).toBeInTheDocument();
    expect(
      screen.getByText(
        "หากนี่ไม่ใช่บัญชีของท่าน กดปุ่ม “ออกจากระบบเพื่อสมัครใหม่” ด้านล่าง แล้วสมัครด้วยบัญชีของท่านเอง",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: LOGOUT_LABEL })).toBeInTheDocument();
  });

  it("logs out BACK to the door it was rendered on, params intact", () => {
    render(
      <ForeignSessionNotice
        displayName="สมชาย ใจดี"
        returnTo={`/register/technician?project=${PROJECT}&site=โพธิ์ทอง`}
      />,
    );
    const returnTo = logoutReturnTo();
    expect(logoutAction().startsWith("/auth/logout?next=")).toBe(true);
    expect(returnTo.pathname).toBe("/register/technician");
    expect(returnTo.searchParams.get("project")).toBe(PROJECT);
    expect(returnTo.searchParams.get("site")).toBe("โพธิ์ทอง");
  });

  it("offers no other way on (one primary action, spec 376 U4)", () => {
    render(<ForeignSessionNotice displayName="สมชาย ใจดี" returnTo="/register/technician" />);
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryAllByRole("link")).toEqual([]);
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

  it("a nameless account is still identified — by its role label, never blank", async () => {
    row.current = { role: "procurement", full_name: null, line_display_name: null };
    render(await RegisterTechnicianPage({ searchParams: Promise.resolve({}) }));
    expect(
      screen.getByText(`เข้าสู่ระบบในชื่อ ${USER_ROLE_LABEL.procurement} อยู่`),
    ).toBeInTheDocument();
  });
});
