// Writing failing test first.
//
// Spec 247 — the SERVER side of the photo gate on "ส่งงานเข้าตรวจ". The UI's
// disabled button is convenience; this action check is the enforcement: a
// submit with no current completion evidence (after photo; in rework, a
// current-round after_fix photo) is refused BEFORE the transition, so a
// crafted request cannot bypass the gate. Role/membership gates and the photo
// read are mocked; the current-photo filtering itself is covered by the
// canSubmitForApproval unit tests.
//
// Spec 337 U1 — the transition itself is no longer an ADMIN-client UPDATE: it
// runs through the submit_work_package_for_approval DEFINER RPC on the CALLER's
// session, so wp_transition_audit records who submitted (F1: 100% of transition
// audit rows were previously anonymous). The admin-client mock below THROWS —
// any regression back to the service-role write fails these tests loudly.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActionRole, getCurrentPhotos, rpc, adminClient } = vi.hoisted(() => ({
  requireActionRole: vi.fn(),
  getCurrentPhotos: vi.fn(),
  rpc: vi.fn(),
  adminClient: vi.fn(),
}));

const WP = "11111111-1111-4111-8111-111111111111";
const PROJECT = "22222222-2222-4222-8222-222222222222";

function rlsClient(
  wpRow: { id: string; project_id: string; status: string; rework_round: number } | null,
) {
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
vi.mock("@/lib/photos/current-photos", () => ({
  getCurrentPhotosForWorkPackage: getCurrentPhotos,
}));
vi.mock("@/lib/db/admin", () => ({ createClient: adminClient }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("server-only", () => ({}));

import { submitWorkPackageForApproval } from "@/app/projects/[projectId]/work-packages/[workPackageId]/actions";

function authAs(wpRow: Parameters<typeof rlsClient>[0]) {
  requireActionRole.mockResolvedValue({
    auth: { supabase: rlsClient(wpRow), user: { id: "u1" } },
    role: "site_admin",
  });
}

const noPhotos = { before: [], during: [], after: [], after_fix: [], defect: [] };

beforeEach(() => {
  requireActionRole.mockReset();
  getCurrentPhotos.mockReset().mockResolvedValue(noPhotos);
  rpc.mockReset().mockResolvedValue({ data: true, error: null });
  adminClient.mockReset().mockImplementation(() => {
    throw new Error("the admin client must not be used for a WP status transition (spec 337 U1)");
  });
});

describe("submitWorkPackageForApproval — spec 247 photo gate", () => {
  it("refuses a first-pass submit with no current after photo, before any transition", async () => {
    authAs({ id: WP, project_id: PROJECT, status: "in_progress", rework_round: 0 });
    const r = await submitWorkPackageForApproval({ projectId: PROJECT, workPackageId: WP });
    expect(r).toEqual({ ok: false, error: "ถ่ายรูปหลังทำงานก่อนจึงจะส่งตรวจได้" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a rework submit whose only after_fix photo is from a PRIOR round", async () => {
    authAs({ id: WP, project_id: PROJECT, status: "rework", rework_round: 2 });
    getCurrentPhotos.mockResolvedValue({
      ...noPhotos,
      after: [{ rework_round: 0 }],
      after_fix: [{ rework_round: 1 }],
    });
    const r = await submitWorkPackageForApproval({ projectId: PROJECT, workPackageId: WP });
    expect(r).toEqual({ ok: false, error: "ถ่ายรูปหลังแก้ไขก่อนจึงจะส่งตรวจได้" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("submits when the evidence exists (first pass: an after photo)", async () => {
    authAs({ id: WP, project_id: PROJECT, status: "in_progress", rework_round: 0 });
    getCurrentPhotos.mockResolvedValue({ ...noPhotos, after: [{ rework_round: 0 }] });
    const r = await submitWorkPackageForApproval({ projectId: PROJECT, workPackageId: WP });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("submit_work_package_for_approval", { p_wp: WP });
  });

  it("submits a rework with a current-round after_fix photo", async () => {
    authAs({ id: WP, project_id: PROJECT, status: "rework", rework_round: 2 });
    getCurrentPhotos.mockResolvedValue({ ...noPhotos, after_fix: [{ rework_round: 2 }] });
    const r = await submitWorkPackageForApproval({ projectId: PROJECT, workPackageId: WP });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("submit_work_package_for_approval", { p_wp: WP });
  });
});

// Spec 248 U4 — pairing half of the gate: floor met but a current defect
// photo unanswered → refused with the remaining count; answered → submits.
describe("submitWorkPackageForApproval — spec 248 U4 pairing", () => {
  it("refuses a rework submit while a defect photo of the round is unanswered", async () => {
    authAs({ id: WP, project_id: PROJECT, status: "rework", rework_round: 2 });
    getCurrentPhotos.mockResolvedValue({
      ...noPhotos,
      defect: [{ id: "d1", rework_round: 2, answers_photo_id: null }],
      after_fix: [{ id: "f-free", rework_round: 2, answers_photo_id: null }],
    });
    const r = await submitWorkPackageForApproval({ projectId: PROJECT, workPackageId: WP });
    expect(r).toEqual({ ok: false, error: "ถ่ายรูปแก้ไขให้ครบทุกจุดที่แจ้ง (เหลือ 1 จุด)" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("submits once every defect photo of the round is answered", async () => {
    authAs({ id: WP, project_id: PROJECT, status: "rework", rework_round: 2 });
    getCurrentPhotos.mockResolvedValue({
      ...noPhotos,
      defect: [{ id: "d1", rework_round: 2, answers_photo_id: null }],
      after_fix: [{ id: "f1", rework_round: 2, answers_photo_id: "d1" }],
    });
    const r = await submitWorkPackageForApproval({ projectId: PROJECT, workPackageId: WP });
    expect(r).toEqual({ ok: true });
    expect(rpc).toHaveBeenCalledWith("submit_work_package_for_approval", { p_wp: WP });
  });
});

// Spec 337 U1 — the transition moved onto the caller's session so the audit
// trigger sees the actor. These pin the seam: the admin client is never
// touched, and each RPC errcode maps to its own Thai refusal.
describe("submitWorkPackageForApproval — spec 337 U1 attributed transition", () => {
  it("never constructs the service-role client", async () => {
    authAs({ id: WP, project_id: PROJECT, status: "in_progress", rework_round: 0 });
    getCurrentPhotos.mockResolvedValue({ ...noPhotos, after: [{ rework_round: 0 }] });
    await submitWorkPackageForApproval({ projectId: PROJECT, workPackageId: WP });
    expect(adminClient).not.toHaveBeenCalled();
  });

  it("maps the RPC's wrong-status refusal (22023) to the already-submitted message", async () => {
    authAs({ id: WP, project_id: PROJECT, status: "in_progress", rework_round: 0 });
    getCurrentPhotos.mockResolvedValue({ ...noPhotos, after: [{ rework_round: 0 }] });
    rpc.mockResolvedValue({
      data: null,
      error: { code: "22023", message: "cannot submit from status pending_approval" },
    });
    const r = await submitWorkPackageForApproval({ projectId: PROJECT, workPackageId: WP });
    expect(r).toEqual({ ok: false, error: "งานนี้ส่งตรวจแล้ว หรือยังไม่พร้อมส่ง" });
  });

  it("maps the RPC's authorisation refusal (42501) to the RLS-shaped not-found message", async () => {
    authAs({ id: WP, project_id: PROJECT, status: "in_progress", rework_round: 0 });
    getCurrentPhotos.mockResolvedValue({ ...noPhotos, after: [{ rework_round: 0 }] });
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "not a member of this project" },
    });
    const r = await submitWorkPackageForApproval({ projectId: PROJECT, workPackageId: WP });
    expect(r).toEqual({ ok: false, error: "ไม่พบรายการงาน" });
  });

  it("maps any other RPC failure to the retry message", async () => {
    authAs({ id: WP, project_id: PROJECT, status: "in_progress", rework_round: 0 });
    getCurrentPhotos.mockResolvedValue({ ...noPhotos, after: [{ rework_round: 0 }] });
    rpc.mockResolvedValue({ data: null, error: { code: "08006", message: "connection failure" } });
    const r = await submitWorkPackageForApproval({ projectId: PROJECT, workPackageId: WP });
    expect(r).toEqual({ ok: false, error: "ส่งงานเข้าตรวจไม่สำเร็จ กรุณาลองใหม่อีกครั้ง" });
  });
});
