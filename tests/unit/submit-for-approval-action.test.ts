// Writing failing test first.
//
// Spec 247 — the SERVER side of the photo gate on "ส่งงานเข้าตรวจ". The UI's
// disabled button is convenience; this action check is the enforcement: a
// submit with no current completion evidence (after photo; in rework, a
// current-round after_fix photo) is refused BEFORE the status UPDATE, so a
// crafted request cannot bypass the gate. Role/membership gates and the photo
// read are mocked; the current-photo filtering itself is covered by the
// canSubmitForApproval unit tests.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActionRole, getCurrentPhotos, adminUpdate } = vi.hoisted(() => ({
  requireActionRole: vi.fn(),
  getCurrentPhotos: vi.fn(),
  adminUpdate: vi.fn(),
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
vi.mock("@/lib/db/admin", () => ({
  createClient: () => ({
    from: () => ({
      update: () => ({
        eq: () => ({
          in: () => ({
            select: adminUpdate,
          }),
        }),
      }),
    }),
  }),
}));
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
  adminUpdate.mockReset().mockResolvedValue({ data: [{ id: WP }], error: null });
});

describe("submitWorkPackageForApproval — spec 247 photo gate", () => {
  it("refuses a first-pass submit with no current after photo, before any UPDATE", async () => {
    authAs({ id: WP, project_id: PROJECT, status: "in_progress", rework_round: 0 });
    const r = await submitWorkPackageForApproval({ projectId: PROJECT, workPackageId: WP });
    expect(r).toEqual({ ok: false, error: "ถ่ายรูปหลังทำงานก่อนจึงจะส่งตรวจได้" });
    expect(adminUpdate).not.toHaveBeenCalled();
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
    expect(adminUpdate).not.toHaveBeenCalled();
  });

  it("submits when the evidence exists (first pass: an after photo)", async () => {
    authAs({ id: WP, project_id: PROJECT, status: "in_progress", rework_round: 0 });
    getCurrentPhotos.mockResolvedValue({ ...noPhotos, after: [{ rework_round: 0 }] });
    const r = await submitWorkPackageForApproval({ projectId: PROJECT, workPackageId: WP });
    expect(r).toEqual({ ok: true });
    expect(adminUpdate).toHaveBeenCalled();
  });

  it("submits a rework with a current-round after_fix photo", async () => {
    authAs({ id: WP, project_id: PROJECT, status: "rework", rework_round: 2 });
    getCurrentPhotos.mockResolvedValue({ ...noPhotos, after_fix: [{ rework_round: 2 }] });
    const r = await submitWorkPackageForApproval({ projectId: PROJECT, workPackageId: WP });
    expect(r).toEqual({ ok: true });
    expect(adminUpdate).toHaveBeenCalled();
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
    expect(adminUpdate).not.toHaveBeenCalled();
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
    expect(adminUpdate).toHaveBeenCalled();
  });
});
