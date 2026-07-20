// Writing failing test first.
//
// Spec 328/279 fix — the logged-out QR scan MUST NOT lose the QR's attribution
// params across the LINE login round-trip. Before this fix the workspace
// redirected to a STATIC `/login?next=%2Fregister%2Ftechnician`, so a brand-new
// worker (always logged out at first scan) came back to a bare form: the
// subcon bank-exempt mode never triggered and the registration was minted with
// invited_contractor_id / invited_project_id / invited_by all NULL — confirmed
// live: 0 of 18 real registrations ever carried attribution.

import { beforeEach, describe, expect, it, vi } from "vitest";

const getClaims = vi.fn();

vi.mock("@/lib/db/server", () => ({
  createClient: async () => ({ auth: { getClaims }, from: vi.fn() }),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import { StaffRegisterWorkspace } from "@/components/features/register/staff-register-workspace";

const PROJECT = "123e4567-e89b-12d3-a456-426614174000";
const BY = "223e4567-e89b-12d3-a456-426614174000";
const CONTRACTOR = "323e4567-e89b-12d3-a456-426614174000";

async function captureRedirect(
  props: Parameters<typeof StaffRegisterWorkspace>[0],
): Promise<string> {
  try {
    await StaffRegisterWorkspace(props);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw e;
  }
  throw new Error("expected a redirect, none thrown");
}

beforeEach(() => {
  getClaims.mockReset();
  getClaims.mockResolvedValue({ data: null });
});

describe("StaffRegisterWorkspace — logged-out login round-trip", () => {
  it("preserves the QR attribution params in the login return path", async () => {
    const url = await captureRedirect({
      variant: "field",
      project: PROJECT,
      site: "TFM โพธิ์ทอง",
      by: BY,
      contractor: CONTRACTOR,
      firm: "ช่างอวย",
    });
    expect(url.startsWith("/login?next=")).toBe(true);
    const next = decodeURIComponent(url.slice("/login?next=".length));
    const parsed = new URL(next, "https://prc.invalid");
    expect(parsed.pathname).toBe("/register/technician");
    expect(parsed.searchParams.get("project")).toBe(PROJECT);
    expect(parsed.searchParams.get("by")).toBe(BY);
    expect(parsed.searchParams.get("contractor")).toBe(CONTRACTOR);
    expect(parsed.searchParams.get("site")).toBe("TFM โพธิ์ทอง");
    expect(parsed.searchParams.get("firm")).toBe("ช่างอวย");
  });

  it("without QR params the field door keeps its historical bare path", async () => {
    const url = await captureRedirect({ variant: "field" });
    expect(url).toBe("/login?next=%2Fregister%2Ftechnician");
  });

  it("the office door (no QR params by design) is unchanged", async () => {
    const url = await captureRedirect({ variant: "office" });
    expect(url).toBe("/login?next=%2Fregister%2Foffice");
  });
});
