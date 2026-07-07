// Tests for the require-role Server-Component gate after the ADR 0021 swap
// from auth.getUser() (network round-trip to GoTrue) to auth.getClaims()
// (local JWT verify against the cached JWKS — project is on an asymmetric
// ECC P-256 signing key, so verification has no Auth-server round-trip).
//
// Contract the test pins:
//   - getClaims() is called, getUser() is NOT.
//   - The user id is derived from the verified JWT (claims.sub), not from
//     the User object returned by GoTrue.
//   - All three getClaims() result shapes route correctly:
//       success            → continue, look up role
//       no session         → redirect("/login")
//       verification error → redirect("/login")
//   - users-row missing  → redirect("/login")
//   - role not in allowed list → redirect(roleHome(role))

import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockCreateClient,
  mockGetClaims,
  mockGetUser,
  mockFromMaybeSingle,
  mockReadAssumedRoleCookie,
  redirectMock,
} = vi.hoisted(() => ({
  mockCreateClient: vi.fn(),
  mockGetClaims: vi.fn(),
  mockGetUser: vi.fn(),
  mockFromMaybeSingle: vi.fn(),
  mockReadAssumedRoleCookie: vi.fn(),
  redirectMock: vi.fn((_url: string): never => {
    throw new Error(`__redirect__:${_url}`);
  }),
}));

vi.mock("@/lib/db/server", () => ({
  createClient: mockCreateClient,
}));

// Spec 274 — loadUserContext reads the assumed_role cookie. Mock the server-only
// cookie reader; the real resolveEffectiveRole (forge-guard + allowlist) runs.
vi.mock("@/lib/auth/assumed-role.server", () => ({
  readAssumedRoleCookie: mockReadAssumedRoleCookie,
}));

vi.mock("next/navigation", () => ({
  redirect: redirectMock,
}));

import { requireRole } from "@/lib/auth/require-role";

function setupSupabase() {
  const supabase = {
    auth: {
      getClaims: mockGetClaims,
      getUser: mockGetUser,
    },
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: mockFromMaybeSingle,
        })),
      })),
    })),
  };
  mockCreateClient.mockResolvedValue(supabase);
  // Default: no assumed role. Spec 274 tests override this per-case.
  mockReadAssumedRoleCookie.mockResolvedValue(null);
  return supabase;
}

describe("requireRole — uses getClaims, not getUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls supabase.auth.getClaims() to verify the session", async () => {
    setupSupabase();
    mockGetClaims.mockResolvedValue({
      data: {
        claims: { sub: "user-1", role: "authenticated" },
        header: { alg: "ES256", kid: "k1", typ: "JWT" },
        signature: new Uint8Array(),
      },
      error: null,
    });
    mockFromMaybeSingle.mockResolvedValue({
      data: { role: "site_admin", full_name: "Alice" },
      error: null,
    });

    const ctx = await requireRole(["site_admin"]);

    expect(mockGetClaims).toHaveBeenCalledOnce();
    expect(mockGetUser).not.toHaveBeenCalled();
    expect(ctx).toEqual({ id: "user-1", role: "site_admin", fullName: "Alice" });
  });

  it("uses claims.sub as the user id when looking up the users row", async () => {
    const supabase = setupSupabase();
    mockGetClaims.mockResolvedValue({
      data: {
        claims: { sub: "user-from-jwt" },
        header: { alg: "ES256", kid: "k1", typ: "JWT" },
        signature: new Uint8Array(),
      },
      error: null,
    });
    mockFromMaybeSingle.mockResolvedValue({
      data: { role: "site_admin", full_name: null },
      error: null,
    });

    await requireRole(["site_admin"]);

    // The .eq() call is what filters by id; check it was given the JWT sub.
    const selectChain = supabase.from.mock.results[0]!.value;
    const eqChain = selectChain.select.mock.results[0]!.value;
    expect(eqChain.eq).toHaveBeenCalledWith("id", "user-from-jwt");
  });
});

describe("requireRole — failure paths all redirect to /login", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects to /login when getClaims returns { data: null, error: null } (no session)", async () => {
    setupSupabase();
    mockGetClaims.mockResolvedValue({ data: null, error: null });

    await expect(requireRole(["site_admin"])).rejects.toThrow("__redirect__:/login");
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });

  it("redirects to /login when getClaims returns { data: null, error: AuthError } (verify failed)", async () => {
    setupSupabase();
    mockGetClaims.mockResolvedValue({
      data: null,
      error: { name: "AuthError", message: "bad signature" },
    });

    await expect(requireRole(["site_admin"])).rejects.toThrow("__redirect__:/login");
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });

  it("redirects to /login when the users row is missing", async () => {
    setupSupabase();
    mockGetClaims.mockResolvedValue({
      data: {
        claims: { sub: "user-no-row" },
        header: { alg: "ES256", kid: "k1", typ: "JWT" },
        signature: new Uint8Array(),
      },
      error: null,
    });
    mockFromMaybeSingle.mockResolvedValue({ data: null, error: null });

    await expect(requireRole(["site_admin"])).rejects.toThrow("__redirect__:/login");
    expect(redirectMock).toHaveBeenCalledWith("/login");
  });
});

describe("requireRole — role-mismatch redirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redirects a project_manager who hits a site_admin-only route to /dashboard (roleHome)", async () => {
    setupSupabase();
    mockGetClaims.mockResolvedValue({
      data: {
        claims: { sub: "pm-user" },
        header: { alg: "ES256", kid: "k1", typ: "JWT" },
        signature: new Uint8Array(),
      },
      error: null,
    });
    mockFromMaybeSingle.mockResolvedValue({
      data: { role: "project_manager", full_name: "Bob" },
      error: null,
    });

    await expect(requireRole(["site_admin"])).rejects.toThrow("__redirect__:/dashboard");
    expect(redirectMock).toHaveBeenCalledWith("/dashboard");
  });
});

// Spec 274 — super_admin "View as role". The assumed_role cookie re-interprets a
// super_admin's effective role at this gate: they PASS the assumed role's pages
// and are bounced off pages the assumed role can't reach (to the assumed role's
// home). A non-super caller's cookie is inert (forge-guard).
describe("requireRole — super_admin View as role (spec 274)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function asUser(role: string) {
    mockGetClaims.mockResolvedValue({
      data: {
        claims: { sub: "u" },
        header: { alg: "ES256", kid: "k1", typ: "JWT" },
        signature: new Uint8Array(),
      },
      error: null,
    });
    mockFromMaybeSingle.mockResolvedValue({ data: { role, full_name: "N" }, error: null });
  }

  it("a super_admin assuming site_admin PASSES a site_admin-only page with the assumed role", async () => {
    setupSupabase();
    asUser("super_admin");
    mockReadAssumedRoleCookie.mockResolvedValue("site_admin");

    const ctx = await requireRole(["site_admin"]);

    expect(ctx.role).toBe("site_admin");
    expect(redirectMock).not.toHaveBeenCalled();
  });

  it("a super_admin assuming site_admin is BOUNCED off a super_admin-only page to the assumed role's home (/sa)", async () => {
    setupSupabase();
    asUser("super_admin");
    mockReadAssumedRoleCookie.mockResolvedValue("site_admin");

    await expect(requireRole(["super_admin"])).rejects.toThrow("__redirect__:/sa");
    expect(redirectMock).toHaveBeenCalledWith("/sa");
  });

  it("ignores an unassumable cookie value (super_admin stays super_admin)", async () => {
    setupSupabase();
    asUser("super_admin");
    mockReadAssumedRoleCookie.mockResolvedValue("visitor"); // /coming-soon role — not assumable

    const ctx = await requireRole(["super_admin"]);

    expect(ctx.role).toBe("super_admin");
  });

  it("FORGE-GUARD: a non-super caller's assumed_role cookie has zero effect", async () => {
    setupSupabase();
    asUser("project_manager");
    mockReadAssumedRoleCookie.mockResolvedValue("accounting"); // forged

    // The forged cookie must NOT let a PM into an accounting-only page…
    await expect(requireRole(["accounting"])).rejects.toThrow("__redirect__:/dashboard");

    // …and their real role is unchanged on a page they DO own.
    setupSupabase();
    asUser("project_manager");
    mockReadAssumedRoleCookie.mockResolvedValue("accounting");
    const ctx = await requireRole(["project_manager"]);
    expect(ctx.role).toBe("project_manager");
  });
});
