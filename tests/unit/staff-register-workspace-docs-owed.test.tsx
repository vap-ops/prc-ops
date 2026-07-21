// Writing failing test first.
//
// Spec 333 U2 — the register workspace's post-approval docs-owed branch. An
// APPROVED registration normally redirects straight to roleHome; when the
// approval deferred the document floors (documents_deferred_at set) and at
// least one owed document is still missing, the workspace renders the
// DocsOwedCard (uploads + bank mini-form + a ไปหน้าหลัก link) instead. Once
// nothing is owed — or on a plain approved row — the redirect behaves exactly
// as before (mode F6 self-heals).

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
  addStaffRegistrationDoc: vi.fn(),
  recordOwnStaffBank: vi.fn(),
}));

import { StaffRegisterWorkspace } from "@/components/features/register/staff-register-workspace";

const UID = "a1000333-0000-4000-8000-000000000333";

function registration(overrides: Record<string, unknown> = {}) {
  return {
    id: "b1000333-0000-4000-8000-000000000333",
    user_id: UID,
    employee_id: "PRC-26-0004",
    full_name: "ณัฐวุฒิ ทดสอบ",
    status: "approved",
    documents_deferred_at: "2026-07-21T04:00:00Z",
    invited_contractor_id: null,
    reject_reason: null,
    phone: null,
    date_of_birth: null,
    emergency_contact_name: null,
    emergency_contact_relation: null,
    emergency_contact_phone: null,
    declared_role_hint: "ที่ปรึกษากฎหมาย",
    created_at: "2026-07-08T08:00:00Z",
    updated_at: "2026-07-21T04:00:00Z",
    reviewed_at: "2026-07-21T04:00:00Z",
    reviewed_by: "x",
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
        maybeSingle: async () => ({ data: { role: "legal", line_avatar_url: null } }),
      }),
    }),
  });
  getReg.mockReset().mockResolvedValue(registration());
  getDocs.mockReset().mockResolvedValue({ urls: {} });
  getConsent.mockReset().mockResolvedValue({ consentedAt: "2026-07-20T00:00:00Z" });
  getBank.mockReset().mockResolvedValue(null);
});

async function renderWorkspace(): Promise<void> {
  render(await StaffRegisterWorkspace({ variant: "office" }));
}

async function captureRedirect(): Promise<string> {
  try {
    await StaffRegisterWorkspace({ variant: "office" });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw e;
  }
  throw new Error("expected a redirect, none thrown");
}

describe("StaffRegisterWorkspace — deferred docs owed (spec 333 U2)", () => {
  it("renders the docs-owed card instead of redirecting while documents are owed", async () => {
    await renderWorkspace();
    expect(screen.getByText("เอกสารที่ต้องส่งเพิ่ม")).toBeInTheDocument();
    const home = screen.getByRole("link", { name: "ไปหน้าหลัก" }) as HTMLAnchorElement;
    expect(home.getAttribute("href")).toBe("/legal");
  });

  it("redirects to roleHome once nothing is owed (F6 self-heals)", async () => {
    getDocs.mockResolvedValue({
      urls: { id_card: "https://signed/id", book_bank: "https://signed/bb" },
    });
    getBank.mockResolvedValue({ bankName: "กสิกรไทย", accountNumber: "123", accountName: "ณ" });
    expect(await captureRedirect()).toBe("/legal");
  });

  it("redirects a plain approved registration exactly as before (no stamp)", async () => {
    getReg.mockResolvedValue(registration({ documents_deferred_at: null }));
    expect(await captureRedirect()).toBe("/legal");
  });
});
