// Writing failing test first.
//
// Spec 291 U1 — removePhoto refuses once the WP is submitted for approval or
// complete. RLS is the authority (migration 075630); this is the friendly Thai
// error so a locked delete never round-trips to a raw 42501. The action reads
// the target photo's WP status before building the tombstone and returns
// PHOTO_DELETE_LOCKED_ERROR without touching photo_logs when the status is
// locked. Deletable statuses (not_started/in_progress/on_hold/rework) still
// tombstone as before.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetActionUser, targetMock, antiJoinMock, wpMock, insertMock } = vi.hoisted(() => ({
  mockGetActionUser: vi.fn(),
  targetMock: vi.fn(),
  antiJoinMock: vi.fn(),
  wpMock: vi.fn(),
  insertMock: vi.fn(),
}));

const PHOTO = "22222222-2222-4222-8222-222222222222";
const WP = "11111111-1111-4111-8111-111111111111";
const PROJ = "33333333-3333-4333-8333-333333333333";
const LOCKED_ERROR = "งานนี้ส่งตรวจแล้ว ลบรูปไม่ได้";

function rlsClient() {
  return {
    from: (table: string) => {
      if (table === "work_packages") {
        return { select: () => ({ eq: () => ({ maybeSingle: wpMock }) }) };
      }
      // photo_logs — target load (.eq().maybeSingle()) + anti-join (.eq().limit())
      return {
        insert: insertMock,
        select: () => ({
          eq: () => ({ maybeSingle: targetMock, limit: antiJoinMock }),
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
    from: () => ({ update: () => ({ eq: () => ({ in: () => ({ select: vi.fn() }) }) }) }),
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

import { removePhoto } from "@/app/projects/[projectId]/work-packages/[workPackageId]/actions";

function setup(wpStatus: string) {
  mockGetActionUser.mockResolvedValue({ supabase: rlsClient(), user: { id: "u1" } });
  targetMock.mockResolvedValue({
    data: {
      id: PHOTO,
      work_package_id: WP,
      phase: "before",
      storage_path: "d/x.jpg",
      rework_round: 0,
    },
    error: null,
  });
  antiJoinMock.mockResolvedValue({ data: [], error: null });
  wpMock.mockResolvedValue({ data: { project_id: PROJ, status: wpStatus }, error: null });
}

beforeEach(() => {
  mockGetActionUser.mockReset();
  targetMock.mockReset();
  antiJoinMock.mockReset();
  wpMock.mockReset();
  insertMock.mockReset().mockResolvedValue({ error: null });
});

describe("removePhoto submit gate (spec 291 U1)", () => {
  it("refuses a delete on a pending_approval WP without touching photo_logs", async () => {
    setup("pending_approval");
    const r = await removePhoto({ photoLogId: PHOTO });
    expect(r).toEqual({ ok: false, error: LOCKED_ERROR });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("refuses a delete on a complete WP", async () => {
    setup("complete");
    const r = await removePhoto({ photoLogId: PHOTO });
    expect(r).toEqual({ ok: false, error: LOCKED_ERROR });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("still tombstones on an in_progress WP", async () => {
    setup("in_progress");
    const r = await removePhoto({ photoLogId: PHOTO });
    expect(r).toEqual({ ok: true });
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({ superseded_by: PHOTO, storage_path: null }),
    );
  });

  it("still tombstones on a rework WP", async () => {
    setup("rework");
    const r = await removePhoto({ photoLogId: PHOTO });
    expect(r).toEqual({ ok: true });
    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});
