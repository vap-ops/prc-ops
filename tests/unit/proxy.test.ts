// Tests for the proxy middleware (the app's auth gate that runs on every
// navigation). It verifies the session with getClaims() — a LOCAL JWT verify
// against the cached JWKS (project is on asymmetric signing keys, ADR 0021) —
// instead of getUser(), which made a GoTrue network round-trip on every nav.
//
// Session refresh is preserved: getClaims() reads the session via getSession(),
// which auto-refreshes an expired access token (auth-js _callRefreshToken), and
// the @supabase/ssr cookie adapter persists the rotated tokens. So the swap is a
// pure latency win, not a correctness change — these tests pin that contract.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockCreateServerClient, mockGetClaims, mockGetUser } = vi.hoisted(() => ({
  mockCreateServerClient: vi.fn(),
  mockGetClaims: vi.fn(),
  mockGetUser: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mockCreateServerClient,
}));

vi.mock("@/lib/env", () => ({
  clientEnv: {
    NEXT_PUBLIC_SUPABASE_URL: "https://test.supabase.co",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: "anon-test",
  },
}));

const { nextMock, redirectMock } = vi.hoisted(() => ({
  nextMock: vi.fn(() => ({ __kind: "next" as const, cookies: { set: vi.fn() } })),
  redirectMock: vi.fn((url: { pathname: string }) => ({ __kind: "redirect" as const, url })),
}));

vi.mock("next/server", () => ({
  NextResponse: { next: nextMock, redirect: redirectMock },
}));

import { proxy } from "../../proxy";

function setupSupabase() {
  mockCreateServerClient.mockReturnValue({
    auth: { getClaims: mockGetClaims, getUser: mockGetUser },
  });
}

function makeRequest(pathname: string) {
  return {
    cookies: { getAll: () => [], set: vi.fn() },
    nextUrl: {
      pathname,
      search: "",
      clone() {
        return { pathname, search: "" };
      },
    },
  } as unknown as Parameters<typeof proxy>[0];
}

describe("proxy — verifies the session via getClaims, not getUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls getClaims() and never getUser()", async () => {
    setupSupabase();
    mockGetClaims.mockResolvedValue({ data: { claims: { sub: "u1" } }, error: null });

    await proxy(makeRequest("/dashboard"));

    expect(mockGetClaims).toHaveBeenCalledOnce();
    expect(mockGetUser).not.toHaveBeenCalled();
  });

  it("lets an authenticated request through to a protected path", async () => {
    setupSupabase();
    mockGetClaims.mockResolvedValue({ data: { claims: { sub: "u1" } }, error: null });

    const res = await proxy(makeRequest("/dashboard"));

    expect(redirectMock).not.toHaveBeenCalled();
    expect(res).toMatchObject({ __kind: "next" });
  });
});

describe("proxy — redirect rules unchanged by the getClaims swap", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redirects an unauthenticated request on a protected path to /login", async () => {
    setupSupabase();
    mockGetClaims.mockResolvedValue({ data: null, error: null });

    await proxy(makeRequest("/dashboard"));

    expect(redirectMock).toHaveBeenCalledOnce();
    const arg = redirectMock.mock.calls[0]![0] as { pathname: string };
    expect(arg.pathname).toBe("/login");
  });

  it("does NOT redirect an unauthenticated request on a public path", async () => {
    setupSupabase();
    mockGetClaims.mockResolvedValue({ data: null, error: null });

    const res = await proxy(makeRequest("/login"));

    expect(redirectMock).not.toHaveBeenCalled();
    expect(res).toMatchObject({ __kind: "next" });
  });
});
