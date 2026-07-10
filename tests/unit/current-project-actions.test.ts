// Spec 292 U4 — the SA current-project server actions (view-override set/clear +
// pin). Mirrors src/app/sa/plan/actions.ts: getActionUser gate, UUID validate,
// thin RPC/cookie relay, Thai error map, revalidate. The cookie I/O helpers
// (posture) live in current-project.server and are mocked here — this file tests
// the ACTION logic (validation, visibility gate, relay, pin-clears-override).
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetActionUser, mockVisible, mockSetCookie, mockClearCookie, mockRpc, mockRevalidate } =
  vi.hoisted(() => ({
    mockGetActionUser: vi.fn(),
    mockVisible: vi.fn(),
    mockSetCookie: vi.fn(),
    mockClearCookie: vi.fn(),
    mockRpc: vi.fn(),
    mockRevalidate: vi.fn(),
  }));

vi.mock("@/lib/auth/action-gate", () => ({
  getActionUser: mockGetActionUser,
  NOT_SIGNED_IN: "ยังไม่ได้เข้าสู่ระบบ",
}));
vi.mock("@/lib/sa/current-project.server", () => ({
  SA_ACTIVE_PROJECT_COOKIE: "sa_active_project",
  getSaVisibleProjects: mockVisible,
  setSaActiveProjectCookie: mockSetCookie,
  clearSaActiveProjectCookie: mockClearCookie,
}));
vi.mock("next/cache", () => ({ revalidatePath: mockRevalidate }));

import {
  setActiveProjectOverride,
  clearActiveProjectOverride,
  pinPrimaryProject,
} from "@/app/sa/current-project-actions";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";

function signedIn() {
  mockRpc.mockResolvedValue({ error: null });
  mockGetActionUser.mockResolvedValue({ user: { id: "sa1" }, supabase: { rpc: mockRpc } });
}

beforeEach(() => {
  vi.clearAllMocks();
  // Only P1 is visible to the caller by default.
  mockVisible.mockResolvedValue([
    { id: P1, code: "A", name: "Alpha", isPrimary: false, addedAt: null, hasMembership: true },
  ]);
});

describe("setActiveProjectOverride", () => {
  it("sets the session cookie when the project is in the caller's visible list", async () => {
    signedIn();
    const r = await setActiveProjectOverride(P1);
    expect(r.ok).toBe(true);
    expect(mockSetCookie).toHaveBeenCalledWith(P1);
    expect(mockRevalidate).toHaveBeenCalled();
  });

  it("refuses a project NOT in the visible list — forge guard, no cookie", async () => {
    signedIn();
    const r = await setActiveProjectOverride(P2);
    expect(r.ok).toBe(false);
    expect(mockSetCookie).not.toHaveBeenCalled();
  });

  it("rejects a malformed uuid before any read", async () => {
    signedIn();
    const r = await setActiveProjectOverride("not-a-uuid");
    expect(r.ok).toBe(false);
    expect(mockVisible).not.toHaveBeenCalled();
    expect(mockSetCookie).not.toHaveBeenCalled();
  });

  it("is a no-op when not signed in", async () => {
    mockGetActionUser.mockResolvedValue(null);
    const r = await setActiveProjectOverride(P1);
    expect(r).toEqual({ ok: false, error: "ยังไม่ได้เข้าสู่ระบบ" });
    expect(mockSetCookie).not.toHaveBeenCalled();
  });
});

describe("clearActiveProjectOverride", () => {
  it("deletes the override cookie", async () => {
    signedIn();
    const r = await clearActiveProjectOverride();
    expect(r.ok).toBe(true);
    expect(mockClearCookie).toHaveBeenCalledTimes(1);
    expect(mockRevalidate).toHaveBeenCalled();
  });

  it("is a no-op when not signed in", async () => {
    mockGetActionUser.mockResolvedValue(null);
    const r = await clearActiveProjectOverride();
    expect(r.ok).toBe(false);
    expect(mockClearCookie).not.toHaveBeenCalled();
  });
});

describe("pinPrimaryProject", () => {
  it("relays set_primary_project AND clears the override on success (spec: pin clears view)", async () => {
    signedIn();
    const r = await pinPrimaryProject(P1);
    expect(r.ok).toBe(true);
    expect(mockRpc).toHaveBeenCalledWith("set_primary_project", { p_project: P1 });
    expect(mockClearCookie).toHaveBeenCalledTimes(1);
    expect(mockRevalidate).toHaveBeenCalled();
  });

  it("maps a 42501 membership reject to a Thai error and does NOT clear the cookie", async () => {
    signedIn();
    mockRpc.mockResolvedValue({
      error: { code: "42501", message: "set_primary_project: not a project member" },
    });
    const r = await pinPrimaryProject(P1);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/\S/);
    expect(mockClearCookie).not.toHaveBeenCalled();
  });

  it("rejects a malformed uuid without calling the RPC", async () => {
    signedIn();
    const r = await pinPrimaryProject("nope");
    expect(r.ok).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("is a no-op when not signed in", async () => {
    mockGetActionUser.mockResolvedValue(null);
    const r = await pinPrimaryProject(P1);
    expect(r.ok).toBe(false);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});
