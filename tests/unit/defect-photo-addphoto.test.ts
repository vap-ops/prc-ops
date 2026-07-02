// Writing failing test first.
//
// Spec 248 U2 — the SERVER scope on defect-phase photo inserts. addPhoto's
// PHOTO_PHASES allowlist grows to admit 'defect' (a runtime string list —
// typecheck never surfaces it), but a defect row is additionally scoped:
// only the filing roles (PM/PD/super — PM_ROLES) may insert one, and only
// while the WP is actually in 'rework' (no closed-round pollution, no
// SA-side defect inserts). The RLS uploaded_by pin + the DB guard trigger
// gate again underneath; this is the friendly early check.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetActionUser, insertMock, roleMock, wpMock } = vi.hoisted(() => ({
  mockGetActionUser: vi.fn(),
  insertMock: vi.fn(),
  roleMock: vi.fn(),
  wpMock: vi.fn(),
}));

const WP = "11111111-1111-4111-8111-111111111111";
const PHOTO = "22222222-2222-4222-8222-222222222222";

function rlsClient() {
  return {
    from: (table: string) => {
      if (table === "users") {
        return { select: () => ({ eq: () => ({ single: roleMock }) }) };
      }
      if (table === "work_packages") {
        return { select: () => ({ eq: () => ({ maybeSingle: wpMock }) }) };
      }
      // photo_logs
      return {
        insert: insertMock,
        select: () => ({
          eq: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ maybeSingle: vi.fn() }) }) }) }),
        }),
      };
    },
  };
}

vi.mock("@/lib/auth/action-gate", () => ({
  getActionUser: mockGetActionUser,
  requireActionRole: vi.fn(),
  NOT_SIGNED_IN: "not signed in",
}));
vi.mock("@/lib/db/admin", () => ({
  createClient: () => ({
    from: () => ({
      update: () => ({ eq: () => ({ in: () => ({ select: vi.fn() }) }) }),
    }),
  }),
}));
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

import { addPhoto } from "@/app/projects/[projectId]/work-packages/[workPackageId]/actions";

function setup(role: string, wpStatus: string, reworkRound = 2) {
  mockGetActionUser.mockResolvedValue({ supabase: rlsClient(), user: { id: "u1" } });
  roleMock.mockResolvedValue({ data: { role } });
  wpMock.mockResolvedValue({
    data: {
      id: WP,
      project_id: "33333333-3333-4333-8333-333333333333",
      status: wpStatus,
      rework_round: reworkRound,
    },
    error: null,
  });
}

beforeEach(() => {
  mockGetActionUser.mockReset();
  insertMock.mockReset().mockResolvedValue({ error: null });
  roleMock.mockReset();
  wpMock.mockReset();
});

describe("addPhoto defect scope (spec 248 U2)", () => {
  it("admits the defect phase at all (runtime allowlist grew)", async () => {
    setup("project_manager", "rework");
    const r = await addPhoto({ workPackageId: WP, phase: "defect", photoId: PHOTO, ext: "jpeg" });
    expect(r).toMatchObject({ ok: true });
  });

  it("stamps a defect row with the WP's current rework_round", async () => {
    setup("project_director", "rework", 3);
    await addPhoto({ workPackageId: WP, phase: "defect", photoId: PHOTO, ext: "jpeg" });
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "defect", rework_round: 3 }),
    );
  });

  it("refuses a site_admin defect insert before touching photo_logs", async () => {
    setup("site_admin", "rework");
    const r = await addPhoto({ workPackageId: WP, phase: "defect", photoId: PHOTO, ext: "jpeg" });
    expect(r.ok).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("refuses a defect insert on a WP that is not in rework (closed-round pollution)", async () => {
    setup("project_manager", "complete");
    const r = await addPhoto({ workPackageId: WP, phase: "defect", photoId: PHOTO, ext: "jpeg" });
    expect(r.ok).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("leaves non-defect phases un-scoped (site_admin after photo still inserts)", async () => {
    setup("site_admin", "in_progress");
    const r = await addPhoto({ workPackageId: WP, phase: "after", photoId: PHOTO, ext: "jpeg" });
    expect(r).toMatchObject({ ok: true });
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ phase: "after" }));
  });
});
