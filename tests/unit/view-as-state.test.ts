// Spec 274 U2 — getActiveViewAs() drives the global exit banner + the
// identity-scoped "no personal data" placeholder. It returns the assumed role
// ONLY for a real super_admin with a valid assumed_role cookie; null otherwise.
// Cheap in the common case: no cookie → null before any DB read.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateClient, mockGetClaims, mockMaybeSingle, mockReadAssumedRoleCookie } = vi.hoisted(
  () => ({
    mockCreateClient: vi.fn(),
    mockGetClaims: vi.fn(),
    mockMaybeSingle: vi.fn(),
    mockReadAssumedRoleCookie: vi.fn(),
  }),
);

vi.mock("@/lib/db/server", () => ({ createClient: mockCreateClient }));
vi.mock("@/lib/auth/assumed-role.server", () => ({
  readAssumedRoleCookie: mockReadAssumedRoleCookie,
}));

import { getActiveViewAs } from "@/lib/auth/view-as-state.server";

function setup(realRole: string | null) {
  mockCreateClient.mockResolvedValue({
    auth: { getClaims: mockGetClaims },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mockMaybeSingle }) }) }),
  });
  mockGetClaims.mockResolvedValue({ data: { claims: { sub: "u" } }, error: null });
  mockMaybeSingle.mockResolvedValue({ data: realRole ? { role: realRole } : null, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getActiveViewAs", () => {
  it("returns null (no DB read) when there is no assumed_role cookie", async () => {
    mockReadAssumedRoleCookie.mockResolvedValue(null);
    expect(await getActiveViewAs()).toBeNull();
    expect(mockCreateClient).not.toHaveBeenCalled();
  });

  it("returns the assumed role for a real super_admin with a valid cookie", async () => {
    setup("super_admin");
    mockReadAssumedRoleCookie.mockResolvedValue("site_admin");
    expect(await getActiveViewAs()).toBe("site_admin");
  });

  it("returns null for a NON-super caller with a forged cookie", async () => {
    setup("project_manager");
    mockReadAssumedRoleCookie.mockResolvedValue("site_admin");
    expect(await getActiveViewAs()).toBeNull();
  });

  it("returns null for an unassumable cookie value even for a super_admin", async () => {
    setup("super_admin");
    mockReadAssumedRoleCookie.mockResolvedValue("visitor");
    expect(await getActiveViewAs()).toBeNull();
  });

  it("returns null when there is no session", async () => {
    setup("super_admin");
    mockReadAssumedRoleCookie.mockResolvedValue("site_admin");
    mockGetClaims.mockResolvedValue({ data: null, error: null });
    expect(await getActiveViewAs()).toBeNull();
  });
});
