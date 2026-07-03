// Writing failing test first.
//
// Spec 257 U1 — getSchedulePhotos server action. Re-reads photo_logs under the
// caller's RLS session (SCHEDULE_VIEW_ROLES gate, same as the schedule page),
// restricts to the requested Bangkok dates (day-photo-selector.ts), mints
// thumb+full signed URLs (mint-thumbnails.ts, mocked — own unit tests), and
// resolves uploader display names (fetchDisplayNames, mocked — own unit
// tests) so the calendar can show "ถ่ายโดย <name>" like every other photo
// surface (bug: calendar thumbnails shipped without it).

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActionRole, mintPhotoThumbnails, fetchDisplayNames } = vi.hoisted(() => ({
  requireActionRole: vi.fn(),
  mintPhotoThumbnails: vi.fn(),
  fetchDisplayNames: vi.fn(),
}));

vi.mock("@/lib/auth/action-gate", () => ({
  requireActionRole,
  getActionUser: vi.fn(),
  NOT_SIGNED_IN: "not signed in",
  NOT_PERMITTED: "not permitted",
}));
vi.mock("@/lib/photos/mint-thumbnails", () => ({ mintPhotoThumbnails }));
vi.mock("@/lib/users/display-names", () => ({ fetchDisplayNames }));
vi.mock("server-only", () => ({}));

import { getSchedulePhotos } from "@/app/projects/[projectId]/schedule/actions";

const PROJECT = "11111111-1111-4111-8111-111111111111";
const WP = "22222222-2222-4222-8222-222222222222";
const UPLOADER = "44444444-4444-4444-8444-444444444444";

const PHOTO_ROW = {
  id: "33333333-3333-4333-8333-333333333333",
  work_package_id: WP,
  storage_path: "a.jpg",
  superseded_by: null,
  captured_at_client: null,
  created_at: "2026-06-15T05:00:00.000Z",
  uploaded_by: UPLOADER,
};

function rlsClient({
  wpRows = [{ id: WP }],
  photoRows = [PHOTO_ROW],
}: {
  wpRows?: Array<{ id: string }>;
  photoRows?: (typeof PHOTO_ROW)[];
} = {}) {
  return {
    from: (table: string) => {
      if (table === "work_packages") {
        return { select: () => ({ eq: () => Promise.resolve({ data: wpRows, error: null }) }) };
      }
      if (table === "photo_logs") {
        return { select: () => ({ in: () => Promise.resolve({ data: photoRows, error: null }) }) };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

function authOk(opts?: Parameters<typeof rlsClient>[0]) {
  requireActionRole.mockResolvedValue({ auth: { supabase: rlsClient(opts), user: { id: "u1" } } });
}

beforeEach(() => {
  requireActionRole.mockReset();
  mintPhotoThumbnails.mockReset();
  mintPhotoThumbnails.mockResolvedValue(
    new Map([[PHOTO_ROW.id, { thumbUrl: "https://thumb", fullUrl: "https://full" }]]),
  );
  fetchDisplayNames.mockReset();
  fetchDisplayNames.mockResolvedValue(new Map([[UPLOADER, "สมชาย"]]));
});

describe("getSchedulePhotos", () => {
  it("rejects when the role gate fails", async () => {
    requireActionRole.mockResolvedValue({ error: "not permitted" });
    const result = await getSchedulePhotos(PROJECT, ["2026-06-15"]);
    expect(result).toEqual({ ok: false, error: "not permitted" });
    expect(mintPhotoThumbnails).not.toHaveBeenCalled();
  });

  it("rejects a malformed project id", async () => {
    authOk();
    const result = await getSchedulePhotos("not-a-uuid", ["2026-06-15"]);
    expect(result.ok).toBe(false);
  });

  it("returns photos grouped by requested day, with the uploader's display name", async () => {
    authOk();
    const result = await getSchedulePhotos(PROJECT, ["2026-06-15"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(fetchDisplayNames).toHaveBeenCalledWith([UPLOADER], expect.any(String));
    expect(result.days["2026-06-15"]).toEqual([
      {
        photoId: PHOTO_ROW.id,
        workPackageId: WP,
        thumbUrl: "https://thumb",
        fullUrl: "https://full",
        uploaderName: "สมชาย",
      },
    ]);
  });

  it("falls back to null when the uploader's name can't be resolved", async () => {
    authOk();
    fetchDisplayNames.mockResolvedValue(new Map());
    const result = await getSchedulePhotos(PROJECT, ["2026-06-15"]);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.days["2026-06-15"]?.[0]?.uploaderName).toBeNull();
  });

  it("drops non-ISO date strings and caps the request at 8 dates", async () => {
    authOk();
    const junk = ["not-a-date", "2026-06-15"];
    const result = await getSchedulePhotos(PROJECT, junk);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(Object.keys(result.days)).toEqual(["2026-06-15"]);
  });

  it("no work packages → empty result without minting", async () => {
    authOk({ wpRows: [] });
    const result = await getSchedulePhotos(PROJECT, ["2026-06-15"]);
    expect(result).toEqual({ ok: true, days: {} });
    expect(mintPhotoThumbnails).not.toHaveBeenCalled();
  });
});
