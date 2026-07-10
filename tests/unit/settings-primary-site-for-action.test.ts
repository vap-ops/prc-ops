// Spec 292 U4 — the PM/PD/super "set an SA's primary site" server action. Thin
// relay of the DEFINER RPC set_primary_project_for(p_user, p_project); the DB
// enforces authorization (caller ∈ PM/PD/super AND can_see_project AND target is a
// site_admin member). The action only shapes args, confirms a session, maps the
// 42501 reject to Thai, and revalidates.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetActionUser, mockRpc, mockRevalidate } = vi.hoisted(() => ({
  mockGetActionUser: vi.fn(),
  mockRpc: vi.fn(),
  mockRevalidate: vi.fn(),
}));

vi.mock("@/lib/auth/action-gate", () => ({
  getActionUser: mockGetActionUser,
  NOT_SIGNED_IN: "ยังไม่ได้เข้าสู่ระบบ",
  NOT_PERMITTED: "ไม่มีสิทธิ์ทำรายการนี้",
}));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidate }));

import { setPrimaryProjectFor } from "@/app/projects/[projectId]/settings/actions";

const PROJECT = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const USER = "11111111-1111-4111-8111-111111111111";

function signedIn() {
  mockRpc.mockResolvedValue({ error: null });
  mockGetActionUser.mockResolvedValue({ user: { id: "pm1" }, supabase: { rpc: mockRpc } });
}

beforeEach(() => vi.clearAllMocks());

describe("setPrimaryProjectFor", () => {
  it("relays set_primary_project_for with (p_user, p_project)", async () => {
    signedIn();
    const r = await setPrimaryProjectFor(USER, PROJECT);
    expect(r.ok).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("set_primary_project_for", {
      p_user: USER,
      p_project: PROJECT,
    });
    expect(mockRevalidate).toHaveBeenCalled();
  });

  it("rejects malformed uuids without calling the RPC", async () => {
    signedIn();
    const r = await setPrimaryProjectFor("nope", PROJECT);
    expect(r.ok).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("maps a 42501 not-permitted reject to a Thai error", async () => {
    signedIn();
    mockRpc.mockResolvedValue({
      error: { code: "42501", message: "set_primary_project_for: not permitted" },
    });
    const r = await setPrimaryProjectFor(USER, PROJECT);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/\S/);
  });

  it("is a no-op when not signed in", async () => {
    mockGetActionUser.mockResolvedValue(null);
    const r = await setPrimaryProjectFor(USER, PROJECT);
    expect(r.ok).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
