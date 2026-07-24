// Writing failing test first.
//
// Spec 337 U1 — recordDecision is the PM approval write path. It used to insert
// the approvals row under the user's session and then flip work_packages.status
// with a separate ADMIN-client UPDATE, which made the transition anonymous:
// the service-role session has no JWT `sub`, so wp_transition_audit recorded
// actor_id NULL for 100% of transitions (F1).
//
// Both writes now happen inside decide_work_package, a SECURITY DEFINER RPC run
// on the PM's own session — one atomic call, attributed. It also carries F3:
// `rejected` means "send the work back", flipping the WP to the EXISTING rework
// status and advancing rework_round; `needs_revision` stays evidence-cure and
// does not flip. freeze_wp_labor_cost (spec 68) stays action-side, non-fatal, on
// the same PM session.
//
// The admin-client mock THROWS — any regression to the service-role write fails
// these tests loudly.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { getActionUser, applyAssumedRole, rpc, adminClient } = vi.hoisted(() => ({
  getActionUser: vi.fn(),
  applyAssumedRole: vi.fn(),
  rpc: vi.fn(),
  adminClient: vi.fn(),
}));

const WP = "11111111-1111-4111-8111-111111111111";
const PM = "33333333-3333-4333-8333-333333333333";

function client(wpStatus: string | null, role: string | null = "project_manager") {
  return {
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            table === "users"
              ? { data: role === null ? null : { role }, error: null }
              : {
                  data: wpStatus === null ? null : { id: WP, status: wpStatus },
                  error: null,
                },
        }),
      }),
    }),
    rpc,
  };
}

vi.mock("@/lib/auth/action-gate", () => ({
  getActionUser,
  requireActionRole: vi.fn(),
  NOT_SIGNED_IN: "not signed in",
}));
vi.mock("@/lib/auth/apply-assumed-role", () => ({ applyAssumedRole }));
vi.mock("@/lib/db/admin", () => ({ createClient: adminClient }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));

import { recordDecision } from "@/app/review/work-packages/[workPackageId]/actions";

function authAs(wpStatus: string | null, role: string | null = "project_manager") {
  getActionUser.mockResolvedValue({ supabase: client(wpStatus, role), user: { id: PM } });
  applyAssumedRole.mockResolvedValue(role);
}

beforeEach(() => {
  getActionUser.mockReset();
  applyAssumedRole.mockReset();
  rpc.mockReset().mockResolvedValue({ data: "complete", error: null });
  adminClient.mockReset().mockImplementation(() => {
    throw new Error("the admin client must not be used for a WP status transition (spec 337 U1)");
  });
});

describe("recordDecision — gates (unchanged)", () => {
  it("refuses a non-PM role before any write", async () => {
    authAs("pending_approval", "site_admin");
    const r = await recordDecision({ workPackageId: WP, decision: "approved" });
    expect(r).toEqual({
      ok: false,
      error: "เฉพาะผู้จัดการโครงการเท่านั้นที่บันทึกผลการตรวจได้",
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a WP that is not up for review", async () => {
    authAs("complete");
    const r = await recordDecision({ workPackageId: WP, decision: "approved" });
    expect(r).toEqual({ ok: false, error: "รายการงานนี้ไม่ได้อยู่ในสถานะรอตรวจ" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a negative decision with no comment", async () => {
    authAs("pending_approval");
    const r = await recordDecision({ workPackageId: WP, decision: "rejected", comment: "   " });
    expect(r).toEqual({ ok: false, error: "ผลการตรวจนี้ต้องใส่ความเห็น" });
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("recordDecision — spec 337 U1 attributed decision", () => {
  it("records the decision through the DEFINER RPC on the caller's session", async () => {
    authAs("pending_approval");
    const r = await recordDecision({ workPackageId: WP, decision: "approved", comment: null });
    // p_comment omitted entirely when there is none — the RPC's `default null`
    // does the rest (supabase-js drops undefined keys anyway).
    expect(rpc).toHaveBeenCalledWith("decide_work_package", {
      p_wp: WP,
      p_decision: "approved",
    });
    expect(r).toEqual({ ok: true, transitioned: true });
  });

  it("never constructs the service-role client", async () => {
    authAs("pending_approval");
    await recordDecision({ workPackageId: WP, decision: "approved", comment: null });
    expect(adminClient).not.toHaveBeenCalled();
  });

  it("trims the comment to its visible text before the RPC", async () => {
    authAs("pending_approval");
    rpc.mockResolvedValue({ data: "pending_approval", error: null });
    await recordDecision({
      workPackageId: WP,
      decision: "needs_revision",
      comment: "  ถ่ายรูปใหม่  ",
      revisionReason: "mismatch",
    });
    expect(rpc).toHaveBeenCalledWith("decide_work_package", {
      p_wp: WP,
      p_decision: "needs_revision",
      p_comment: "ถ่ายรูปใหม่",
      p_revision_reason: "mismatch",
    });
  });

  it("freezes the labor cost on the PM session only when the WP reached complete", async () => {
    authAs("pending_approval");
    await recordDecision({ workPackageId: WP, decision: "approved", comment: null });
    expect(rpc).toHaveBeenCalledWith("freeze_wp_labor_cost", { p_wp: WP });
  });

  it("reports transitioned=false and skips the freeze when needs_revision leaves the status", async () => {
    authAs("pending_approval");
    rpc.mockResolvedValue({ data: "pending_approval", error: null });
    const r = await recordDecision({
      workPackageId: WP,
      decision: "needs_revision",
      comment: "ถ่ายรูปใหม่",
      revisionReason: "mismatch",
    });
    expect(r).toEqual({ ok: true, transitioned: false });
    expect(rpc).not.toHaveBeenCalledWith("freeze_wp_labor_cost", { p_wp: WP });
  });

  // Spec 355 — the action mirrors the RPC's reason rule so the error is clean.
  it("refuses needs_revision without a structured reason", async () => {
    authAs("pending_approval");
    const r = await recordDecision({ workPackageId: WP, decision: "needs_revision", comment: "x" });
    expect(r.ok).toBe(false);
  });

  it("refuses a reason on a reject-work (rejected) decision", async () => {
    authAs("pending_approval");
    const r = await recordDecision({
      workPackageId: WP,
      decision: "rejected",
      comment: "defect",
      revisionReason: "mismatch",
    });
    expect(r.ok).toBe(false);
  });

  // F3 — a rejection sends the work back to rework; the WP did NOT close, so
  // there is no labor cost to freeze.
  it("reports transitioned=false and skips the freeze when rejected sends the WP to rework", async () => {
    authAs("pending_approval");
    rpc.mockResolvedValue({ data: "rework", error: null });
    const r = await recordDecision({
      workPackageId: WP,
      decision: "rejected",
      comment: "ผนังไม่ได้ระดับ",
    });
    expect(r).toEqual({ ok: true, transitioned: false });
    expect(rpc).not.toHaveBeenCalledWith("freeze_wp_labor_cost", { p_wp: WP });
  });

  it("still succeeds when the non-fatal freeze fails (spec 46 C6 re-freeze recovers it)", async () => {
    authAs("pending_approval");
    rpc.mockImplementation(async (fn: string) =>
      fn === "freeze_wp_labor_cost"
        ? { data: null, error: { code: "P0001", message: "freeze failed" } }
        : { data: "complete", error: null },
    );
    const r = await recordDecision({ workPackageId: WP, decision: "approved", comment: null });
    expect(r).toEqual({ ok: true, transitioned: true });
  });

  it("maps the RPC's wrong-status refusal (22023) to the not-pending message", async () => {
    authAs("pending_approval");
    rpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "work package is not pending approval" },
    });
    const r = await recordDecision({ workPackageId: WP, decision: "approved", comment: null });
    expect(r).toEqual({ ok: false, error: "รายการงานนี้ไม่ได้อยู่ในสถานะรอตรวจ" });
  });

  it("maps the RPC's authorisation refusal (42501) to the RLS-shaped not-found message", async () => {
    authAs("pending_approval");
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "not a member of this project" },
    });
    const r = await recordDecision({ workPackageId: WP, decision: "approved", comment: null });
    expect(r).toEqual({ ok: false, error: "ไม่พบรายการงาน" });
  });

  it("maps any other RPC failure to the retry message", async () => {
    authAs("pending_approval");
    rpc.mockResolvedValue({ data: null, error: { code: "08006", message: "connection failure" } });
    const r = await recordDecision({ workPackageId: WP, decision: "approved", comment: null });
    expect(r).toEqual({ ok: false, error: "บันทึกผลการตรวจไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" });
  });
});
