// Spec 343 U2 — the WIRING seam: StaffRegisterWorkspace must wrap the FRESH form
// in the เตรียมตัว prep gate, and only the fresh form (a returning applicant with
// a registration skips prep entirely). The gate's own behaviour is pinned in
// register-prep-gate.test.tsx; this pins that the workspace actually mounts it,
// so `RegisterPrepGate` cannot be silently dropped from the fresh-form branch.

import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getClaims, fromMock, getReg, getDocs, getConsent, getBank } = vi.hoisted(() => ({
  getClaims: vi.fn(),
  fromMock: vi.fn(),
  getReg: vi.fn(),
  getDocs: vi.fn(),
  getConsent: vi.fn(),
  getBank: vi.fn(),
}));

vi.mock("@/lib/db/server", () => ({
  createClient: async () => ({ auth: { getClaims }, from: fromMock }),
}));
vi.mock("@/lib/register/own-registration", () => ({
  getOwnTechnicianRegistration: getReg,
  getOwnRegistrationDocuments: getDocs,
  getOwnStaffConsent: getConsent,
  getOwnStaffBank: getBank,
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/ui/use-toast", () => ({
  useToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock("@/lib/db/browser", () => ({
  createClient: () => ({ rpc: () => Promise.resolve({ data: null, error: null }) }),
}));
vi.mock("@/lib/register/actions", () => ({
  startStaffRegistration: vi.fn(),
  updateOwnStaffRegistration: vi.fn(),
  addStaffRegistrationDoc: vi.fn(),
  recordOwnStaffConsent: vi.fn(),
  recordOwnStaffBank: vi.fn(),
}));

import { StaffRegisterWorkspace } from "@/components/features/register/staff-register-workspace";
import { REGISTER_PREP_HEADING, REGISTER_PREP_BANK_ITEM } from "@/lib/i18n/labels";

const UID = "a2000343-0000-4000-8000-000000000343";
const FIRM = "3b3e7e44-301a-446f-8e80-d5958c0be34b";

beforeEach(() => {
  getClaims.mockReset().mockResolvedValue({ data: { claims: { sub: UID } } });
  fromMock.mockReset().mockReturnValue({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: { role: "visitor", line_avatar_url: null } }),
      }),
    }),
  });
  getReg.mockReset().mockResolvedValue(null); // no registration → the FRESH branch
  getDocs.mockReset().mockResolvedValue({ urls: {} });
  getConsent.mockReset().mockResolvedValue(null);
  getBank.mockReset().mockResolvedValue(null);
});

describe("StaffRegisterWorkspace — fresh applicant sees the prep gate (spec 343 U2)", () => {
  it("renders the เตรียมตัว landing, not the form fields, on first arrival", async () => {
    render(await StaffRegisterWorkspace({ variant: "field" }));
    expect(screen.getByText(REGISTER_PREP_HEADING)).toBeInTheDocument();
    // The form's own fields are behind the gate until the applicant taps in.
    expect(screen.queryByText("ข้อมูลของฉัน")).toBeNull();
  });

  it("omits the passbook line for a firm-QR (bank-exempt) scan", async () => {
    render(await StaffRegisterWorkspace({ variant: "field", contractor: FIRM }));
    expect(screen.getByText(REGISTER_PREP_HEADING)).toBeInTheDocument();
    expect(screen.queryByText(REGISTER_PREP_BANK_ITEM)).toBeNull();
  });

  it("shows the passbook line for a plain PRC scan", async () => {
    render(await StaffRegisterWorkspace({ variant: "field" }));
    expect(screen.getByText(REGISTER_PREP_BANK_ITEM)).toBeInTheDocument();
  });
});
