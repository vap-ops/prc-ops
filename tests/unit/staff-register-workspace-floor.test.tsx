// Spec 343 U1 — the WIRING seam between the workspace and the pending notice.
// The notice's own branches are pinned in registration-pending-notice.test.tsx;
// what is pinned here is that the workspace actually derives the floor from the
// data it loaded and hands it over. Without this, `floor={floor}` could be
// swapped for a constant and the whole suite would stay green — the spec-337 U5
// lesson (the producer was covered, the page wiring was not).

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

import { RegistrationWorkspace } from "@/components/features/register/staff-register-workspace";

const UID = "a1000343-0000-4000-8000-000000000343";
const FIRM = "3b3e7e44-301a-446f-8e80-d5958c0be34b";

/** Shaped on the real live row: a firm member, pending, nothing but a name. */
function registration(overrides: Record<string, unknown> = {}) {
  return {
    id: "b1000343-0000-4000-8000-000000000343",
    user_id: UID,
    employee_id: "PRC-26-0031",
    full_name: "เหิน ทดสอบ",
    status: "pending",
    documents_deferred_at: null,
    invited_contractor_id: FIRM,
    reject_reason: null,
    phone: "0810000343",
    date_of_birth: null,
    emergency_contact_name: null,
    emergency_contact_relation: null,
    emergency_contact_phone: null,
    declared_role_hint: null,
    created_at: "2026-07-22T13:09:53Z",
    updated_at: "2026-07-22T13:09:53Z",
    reviewed_at: null,
    reviewed_by: null,
    invited_by: null,
    invited_project_id: null,
    ...overrides,
  };
}

beforeEach(() => {
  getClaims.mockReset().mockResolvedValue({ data: { claims: { sub: UID } } });
  fromMock.mockReset().mockReturnValue({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: { role: "visitor", line_avatar_url: null } }),
      }),
    }),
  });
  getReg.mockReset().mockResolvedValue(registration());
  getDocs.mockReset().mockResolvedValue({ urls: {} });
  getConsent.mockReset().mockResolvedValue(null);
  getBank.mockReset().mockResolvedValue(null);
});

// Rendered DIRECTLY, not through StaffRegisterWorkspace: the inner workspace is
// an async component nested in the parent's JSX, which RTL cannot resolve.
async function renderWorkspace(): Promise<void> {
  render(
    await RegistrationWorkspace({
      uid: UID,
      registration: (await getReg()) as Parameters<typeof RegistrationWorkspace>[0]["registration"],
      lineAvatarUrl: null,
    }),
  );
}

describe("StaffRegisterWorkspace — pending notice reflects the real floor (spec 343 U1)", () => {
  it("does not claim submission for a firm member who owes an id_card and consent", async () => {
    await renderWorkspace();
    expect(screen.getByText("ยังส่งไม่ครบ")).toBeInTheDocument();
    expect(screen.queryByText("ส่งใบสมัครแล้ว รอการอนุมัติ")).not.toBeInTheDocument();
  });

  it("lists exactly the two items a bank-exempt member still owes", async () => {
    await renderWorkspace();
    expect(screen.getByRole("link", { name: "อัปโหลดบัตรประชาชน" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "ให้ความยินยอม (PDPA)" })).toBeInTheDocument();
    // Bank items belong to a PRC applicant, never a firm member.
    expect(screen.queryByText("อัปโหลดสมุดบัญชีธนาคาร")).toBeNull();
    expect(screen.queryByText("กรอกเลขบัญชีธนาคาร")).toBeNull();
  });

  it("claims submission only once the floor is genuinely met", async () => {
    getDocs.mockResolvedValue({ urls: { id_card: "https://example.test/a.jpg" } });
    getConsent.mockResolvedValue({ consentedAt: "2026-07-22T14:00:00Z" });
    await renderWorkspace();
    expect(screen.getByText("ส่งใบสมัครแล้ว รอการอนุมัติ")).toBeInTheDocument();
    expect(screen.queryByText("ยังส่งไม่ครบ")).toBeNull();
  });
});
