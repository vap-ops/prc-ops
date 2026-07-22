// Writing failing test first.
//
// Spec 337 U5 follow-up — the ลูกค้าแจ้ง refusal used to LIE.
//
// The live RPC refuses `p_source='client'` when the caller's role is in
// ('site_admin','auditor') — "only PM tier may file a client defect", errcode
// 42501 — but reportDefect mapped EVERY 42501 to "…(ต้องเป็นทีมงานของโครงการ)",
// a MEMBERSHIP diagnosis. So a site admin who IS on the project, filing a defect
// and choosing ลูกค้าแจ้ง, was told they are not on the project team. Spec 337 U5
// put a defect door on every finished row, which makes the SA — the primary
// filer — reach this in one tap.
//
// The RPC stays the enforcement point. This is the friendly early check that
// gives the honest reason, in the house `requireActionRole` shape.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetActionUser, mockRequireActionRole, rpcMock } = vi.hoisted(() => ({
  mockGetActionUser: vi.fn(),
  mockRequireActionRole: vi.fn(),
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/auth/action-gate", () => ({
  getActionUser: mockGetActionUser,
  requireActionRole: mockRequireActionRole,
  NOT_SIGNED_IN: "not signed in",
}));
vi.mock("@/lib/db/admin", () => ({ createClient: () => ({ from: () => ({}) }) }));
vi.mock("@/lib/photos/current-photos", () => ({
  getCurrentPhotosForWorkPackage: vi.fn(async () => ({
    before: [],
    during: [],
    after: [],
    after_fix: [],
    defect: [],
  })),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));

import { reportDefect } from "@/app/projects/[projectId]/work-packages/[workPackageId]/actions";
import { CLIENT_DEFECT_NOT_PERMITTED } from "@/lib/i18n/labels";
import { PM_ROLES } from "@/lib/auth/role-home";

const WP = "11111111-1111-4111-8111-111111111111";
const PROJECT = "33333333-3333-4333-8333-333333333333";

beforeEach(() => {
  rpcMock.mockReset().mockResolvedValue({ data: true, error: null });
  mockGetActionUser.mockReset().mockResolvedValue({
    supabase: { rpc: rpcMock },
    user: { id: "u1" },
  });
  mockRequireActionRole.mockReset();
});

describe("reportDefect — client-source authority", () => {
  it("refuses a client-source filing below PM tier with the ROLE reason, not a membership one", async () => {
    mockRequireActionRole.mockResolvedValue({ error: CLIENT_DEFECT_NOT_PERMITTED });

    const res = await reportDefect({
      projectId: PROJECT,
      workPackageId: WP,
      reason: "รอยร้าวที่ผนัง",
      source: "client",
    });

    expect(res).toEqual({ ok: false, error: CLIENT_DEFECT_NOT_PERMITTED });
    // The honest message is not the membership one.
    expect(CLIENT_DEFECT_NOT_PERMITTED).not.toContain("ต้องเป็นทีมงานของโครงการ");
    // And we never fired the RPC just to be told off by it.
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("gates that check on PM_ROLES — the exact mirror of the RPC's rule", async () => {
    mockRequireActionRole.mockResolvedValue({ error: CLIENT_DEFECT_NOT_PERMITTED });

    await reportDefect({
      projectId: PROJECT,
      workPackageId: WP,
      reason: "รอยร้าว",
      source: "client",
    });

    expect(mockRequireActionRole).toHaveBeenCalledWith(PM_ROLES, CLIENT_DEFECT_NOT_PERMITTED);

    // …but asserting "it was called with PM_ROLES" is self-referential — it holds
    // for ANY contents of that array, including a widened one that re-opens the
    // dead-door bug. So pin the MEMBERSHIP against the live RPC's rule: its
    // overall gate admits SA/PM/PD/super/auditor, and the client arm removes
    // site_admin + auditor, leaving exactly these three.
    const [passedRoles] = mockRequireActionRole.mock.calls[0] as [readonly string[], string];
    expect([...passedRoles].sort()).toEqual(
      ["project_director", "project_manager", "super_admin"].sort(),
    );
    expect(passedRoles).not.toContain("site_admin");
    expect(passedRoles).not.toContain("auditor");
  });

  it("lets a PM-tier client-source filing through to the RPC", async () => {
    mockRequireActionRole.mockResolvedValue({ auth: { supabase: { rpc: rpcMock } } });

    const res = await reportDefect({
      projectId: PROJECT,
      workPackageId: WP,
      reason: "ลูกค้าแจ้งรอยร้าว",
      source: "client",
    });

    expect(res).toEqual({ ok: true });
    expect(rpcMock).toHaveBeenCalledWith(
      "reopen_work_package_for_defect",
      expect.objectContaining({ p_source: "client" }),
    );
  });

  it("never spends the extra role read on an internal filing (the SA's normal path)", async () => {
    const res = await reportDefect({
      projectId: PROJECT,
      workPackageId: WP,
      reason: "ตรวจเจอรอยร้าว",
      source: "internal",
    });

    expect(res).toEqual({ ok: true });
    expect(mockRequireActionRole).not.toHaveBeenCalled();
    expect(rpcMock).toHaveBeenCalledWith(
      "reopen_work_package_for_defect",
      expect.objectContaining({ p_source: "internal" }),
    );
  });

  it("still answers a genuine 42501 as a membership problem", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { code: "42501", message: "not a member" } });

    const res = await reportDefect({
      projectId: PROJECT,
      workPackageId: WP,
      reason: "รอยร้าว",
      source: "internal",
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("ต้องเป็นทีมงานของโครงการ");
  });
});
