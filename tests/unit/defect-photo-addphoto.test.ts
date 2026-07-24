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

const { mockGetActionUser, insertMock, roleMock, wpMock, latestDecisionMock, auditMock } =
  vi.hoisted(() => ({
    mockGetActionUser: vi.fn(),
    insertMock: vi.fn(),
    roleMock: vi.fn(),
    wpMock: vi.fn(),
    latestDecisionMock: vi.fn(),
    auditMock: vi.fn(),
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
      if (table === "audit_log") {
        // Spec 353 — revisionWindowFor's resubmit probe: .select("payload").eq×4
        // → awaited rows. Returned pre-filtered, so any non-empty array = answered.
        return {
          select: () => ({
            eq: () => ({ eq: () => ({ eq: () => ({ eq: () => auditMock() }) }) }),
          }),
        };
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
// Spec 353 — revisionWindowFor reads the latest decision through this helper; mock
// it so the after_fix-gate tests can set the WP's revision state directly.
vi.mock("@/lib/approvals/latest-decision", () => ({
  getLatestDecisionsForWorkPackages: latestDecisionMock,
}));

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
  // Default: no prior decision (revisionWindowFor short-circuits to open:false)
  // and no resubmit row. The reworked-needs_revision cases override these.
  latestDecisionMock.mockReset().mockResolvedValue(new Map());
  auditMock.mockReset().mockResolvedValue({ data: [], error: null });
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

// Spec 248 U3 — the pairing thread: an after_fix answer carries
// answers_photo_id through AddPhotoInput to the row (the U1 trigger validates
// the target). Plain rows insert answers_photo_id null.
describe("addPhoto answersPhotoId (spec 248 U3)", () => {
  const DEFECT = "44444444-4444-4444-8444-444444444444";

  it("threads answersPhotoId onto an after_fix row", async () => {
    setup("site_admin", "rework", 2);
    const r = await addPhoto({
      workPackageId: WP,
      phase: "after_fix",
      photoId: PHOTO,
      ext: "jpeg",
      answersPhotoId: DEFECT,
    });
    expect(r).toMatchObject({ ok: true });
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "after_fix", answers_photo_id: DEFECT, rework_round: 2 }),
    );
  });

  it("inserts answers_photo_id null when no pairing is given", async () => {
    setup("site_admin", "rework", 2);
    await addPhoto({ workPackageId: WP, phase: "after_fix", photoId: PHOTO, ext: "jpeg" });
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ phase: "after_fix", answers_photo_id: null }),
    );
  });

  it("refuses a pairing on a non-after_fix phase before any insert", async () => {
    setup("site_admin", "in_progress");
    const r = await addPhoto({
      workPackageId: WP,
      phase: "after",
      photoId: PHOTO,
      ext: "jpeg",
      answersPhotoId: DEFECT,
    });
    expect(r.ok).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("refuses a malformed answersPhotoId", async () => {
    setup("site_admin", "rework");
    const r = await addPhoto({
      workPackageId: WP,
      phase: "after_fix",
      photoId: PHOTO,
      ext: "jpeg",
      answersPhotoId: "not-a-uuid",
    });
    expect(r.ok).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });
});

// Spec 353 U2 — after_fix is a WP's completion evidence only inside a rework cycle,
// so the SERVER refuses an after_fix insert outside the capture window (mirrors the
// canCaptureAfterFix predicate the WP-detail tile uses). The photo_logs INSERT RLS
// has no WP-status gate on a fresh row, so this action check is the real backstop.
describe("addPhoto after_fix capture window (spec 353 U2)", () => {
  it("admits after_fix on a WP in rework (rework short-circuits the decision read)", async () => {
    setup("site_admin", "rework", 1);
    const r = await addPhoto({
      workPackageId: WP,
      phase: "after_fix",
      photoId: PHOTO,
      ext: "jpeg",
    });
    expect(r).toMatchObject({ ok: true });
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ phase: "after_fix" }));
    expect(latestDecisionMock).not.toHaveBeenCalled();
  });

  it("refuses after_fix on a completed WP (the 20-WP leak)", async () => {
    setup("site_admin", "complete", 1);
    const r = await addPhoto({
      workPackageId: WP,
      phase: "after_fix",
      photoId: PHOTO,
      ext: "jpeg",
    });
    expect(r.ok).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("refuses after_fix on a round-0 pending_approval WP (evidence is `after`)", async () => {
    setup("site_admin", "pending_approval", 0);
    const r = await addPhoto({
      workPackageId: WP,
      phase: "after_fix",
      photoId: PHOTO,
      ext: "jpeg",
    });
    expect(r.ok).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("admits after_fix on a reworked pending_approval WP inside the revision window", async () => {
    setup("site_admin", "pending_approval", 1);
    latestDecisionMock.mockResolvedValue(
      new Map([[WP, { id: "dec1", decision: "needs_revision" }]]),
    );
    auditMock.mockResolvedValue({ data: [], error: null }); // unanswered → window open
    const r = await addPhoto({
      workPackageId: WP,
      phase: "after_fix",
      photoId: PHOTO,
      ext: "jpeg",
    });
    expect(r).toMatchObject({ ok: true });
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ phase: "after_fix" }));
  });

  it("refuses after_fix once that revision was answered (window closed)", async () => {
    setup("site_admin", "pending_approval", 1);
    latestDecisionMock.mockResolvedValue(
      new Map([[WP, { id: "dec1", decision: "needs_revision" }]]),
    );
    auditMock.mockResolvedValue({
      data: [{ payload: { answers_decision_id: "dec1" } }],
      error: null,
    });
    const r = await addPhoto({
      workPackageId: WP,
      phase: "after_fix",
      photoId: PHOTO,
      ext: "jpeg",
    });
    expect(r.ok).toBe(false);
    expect(insertMock).not.toHaveBeenCalled();
  });
});
