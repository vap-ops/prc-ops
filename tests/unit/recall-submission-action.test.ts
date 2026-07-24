// Writing failing test first.
//
// Spec 352 — recallWorkPackageSubmission: the submitter (or super_admin) pulls
// an undecided pending_approval WP back to in_progress. The action mirrors
// submitWorkPackageForApproval: it carries the role gate (WP_SUBMIT_ROLES) + the
// RLS-scoped WP read (membership gate), then runs the transition through the
// recall_work_package_submission DEFINER RPC on the CALLER's session — the
// admin client is never touched, so the transition-audit trigger sees the
// recaller. The full authority (submitter-or-super, window-closed) lives in the
// DB predicate; these tests pin the action's seam + errcode → Thai mapping.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActionRole, rpc, adminClient } = vi.hoisted(() => ({
  requireActionRole: vi.fn(),
  rpc: vi.fn(),
  adminClient: vi.fn(),
}));

const WP = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";

function rlsClient(wpRow: { id: string; project_id: string } | null) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: wpRow, error: null }),
        }),
      }),
    }),
    rpc,
  };
}

vi.mock("@/lib/auth/action-gate", () => ({
  requireActionRole,
  getActionUser: vi.fn(),
  NOT_SIGNED_IN: "not signed in",
}));
vi.mock("@/lib/db/admin", () => ({ createClient: adminClient }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));

import { recallWorkPackageSubmission } from "@/app/projects/[projectId]/work-packages/[workPackageId]/actions";

function authAs(wpRow: Parameters<typeof rlsClient>[0]) {
  requireActionRole.mockResolvedValue({
    auth: { supabase: rlsClient(wpRow), user: { id: "u1" } },
    role: "site_admin",
  });
}

beforeEach(() => {
  requireActionRole.mockReset();
  rpc.mockReset().mockResolvedValue({ data: true, error: null });
  adminClient.mockReset().mockImplementation(() => {
    throw new Error("the admin client must not be used for a WP status transition (spec 352)");
  });
});

describe("recallWorkPackageSubmission", () => {
  it("rejects an invalid work-package id before any auth or RPC", async () => {
    const r = await recallWorkPackageSubmission({
      projectId: PROJECT,
      workPackageId: "not-a-uuid",
    });
    expect(r).toEqual({ ok: false, error: "รหัสรายการงานไม่ถูกต้อง" });
    expect(requireActionRole).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("propagates the role-gate refusal", async () => {
    requireActionRole.mockResolvedValue({ error: "ไม่มีสิทธิ์ทำรายการนี้" });
    const r = await recallWorkPackageSubmission({ projectId: PROJECT, workPackageId: WP });
    expect(r).toEqual({ ok: false, error: "ไม่มีสิทธิ์ทำรายการนี้" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses when the WP is not visible to the caller (RLS read null)", async () => {
    authAs(null);
    const r = await recallWorkPackageSubmission({ projectId: PROJECT, workPackageId: WP });
    expect(r).toEqual({ ok: false, error: "ไม่พบรายการงาน" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("recalls through the DEFINER RPC and never constructs the admin client", async () => {
    authAs({ id: WP, project_id: PROJECT });
    const r = await recallWorkPackageSubmission({ projectId: PROJECT, workPackageId: WP });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("recall_work_package_submission", { p_wp: WP });
    expect(adminClient).not.toHaveBeenCalled();
  });

  it("maps the RPC's authority refusal (42501) to the not-submitter message", async () => {
    authAs({ id: WP, project_id: PROJECT });
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "recall not permitted" },
    });
    const r = await recallWorkPackageSubmission({ projectId: PROJECT, workPackageId: WP });
    expect(r).toEqual({
      ok: false,
      error: "ถอนงานไม่ได้ (คุณไม่ใช่ผู้ส่งงานนี้ หรือสถานะเปลี่ยนไปแล้ว)",
    });
  });

  it("maps the RPC's not-found (22023) to the status-changed message", async () => {
    authAs({ id: WP, project_id: PROJECT });
    rpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "work package not found" },
    });
    const r = await recallWorkPackageSubmission({ projectId: PROJECT, workPackageId: WP });
    expect(r).toEqual({ ok: false, error: "ไม่พบรายการงาน หรือสถานะเปลี่ยนไปแล้ว" });
  });

  it("maps any other RPC failure to the retry message", async () => {
    authAs({ id: WP, project_id: PROJECT });
    rpc.mockResolvedValue({ data: null, error: { code: "08006", message: "connection failure" } });
    const r = await recallWorkPackageSubmission({ projectId: PROJECT, workPackageId: WP });
    expect(r).toEqual({ ok: false, error: "ถอนงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" });
  });
});
