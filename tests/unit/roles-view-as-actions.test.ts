// Spec 274 — the view-as setter/exit server actions. These MUST resolve the REAL
// role (never the overridden effective role): a super_admin who has already
// assumed a narrower role must still be able to switch or EXIT. And a non-super
// caller (a forged request) must get zero effect.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetActionUser, mockSet, mockClear, redirectMock, single } = vi.hoisted(() => ({
  mockGetActionUser: vi.fn(),
  mockSet: vi.fn(),
  mockClear: vi.fn(),
  single: vi.fn(),
  redirectMock: vi.fn((_url: string): never => {
    throw new Error(`__redirect__:${_url}`);
  }),
}));

vi.mock("@/lib/auth/action-gate", () => ({ getActionUser: mockGetActionUser }));
vi.mock("@/lib/auth/assumed-role.server", () => ({
  setAssumedRoleCookie: mockSet,
  clearAssumedRoleCookie: mockClear,
}));
vi.mock("next/navigation", () => ({ redirect: redirectMock }));

import { setAssumedRole, clearAssumedRole } from "@/app/settings/roles-view-as/actions";

function signedInAs(role: string | null) {
  if (role === null) {
    mockGetActionUser.mockResolvedValue(null);
    return;
  }
  single.mockResolvedValue({ data: { role }, error: null });
  mockGetActionUser.mockResolvedValue({
    user: { id: "u1" },
    supabase: { from: () => ({ select: () => ({ eq: () => ({ single }) }) }) },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("setAssumedRole", () => {
  it("sets the cookie and redirects to the assumed role's home for a real super_admin", async () => {
    signedInAs("super_admin");
    await expect(setAssumedRole("site_admin")).rejects.toThrow("__redirect__:/sa");
    expect(mockSet).toHaveBeenCalledWith("site_admin");
  });

  it("is a no-op for a NON-super caller (forge-guard) — no cookie set", async () => {
    signedInAs("project_manager");
    await setAssumedRole("site_admin");
    expect(mockSet).not.toHaveBeenCalled();
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("rejects an unassumable role value — no cookie set", async () => {
    signedInAs("super_admin");
    await setAssumedRole("visitor"); // /coming-soon role, not assumable
    expect(mockSet).not.toHaveBeenCalled();
  });

  it("is a no-op when not signed in", async () => {
    signedInAs(null);
    await setAssumedRole("site_admin");
    expect(mockSet).not.toHaveBeenCalled();
  });
});

describe("clearAssumedRole", () => {
  it("clears the cookie and redirects a real super_admin back to their home", async () => {
    signedInAs("super_admin");
    await expect(clearAssumedRole()).rejects.toThrow("__redirect__:/dashboard");
    expect(mockClear).toHaveBeenCalled();
  });
});
