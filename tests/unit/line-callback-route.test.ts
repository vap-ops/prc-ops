// GET /auth/line/callback — flow resolution + the ADR 0041 amendment
// (Android incident 2026-07-02): the HANDOFF branch binds the row for
// the PWA's poll AND ALSO mints the session in the landing context.
// On Android the callback link-captures back into the installed PWA,
// so the landing jar IS the PWA's jar — minting here logs the user in
// regardless of which client JS version the login page runs, whether
// localStorage is readable, or whether the initiating document
// survived the LINE round-trip. The browser (cookie-state) flow is
// pinned unchanged.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/env.server", () => ({
  serverEnv: { LINE_CHANNEL_ID: "cid", LINE_CHANNEL_SECRET: "csecret" },
}));

// ---- next/headers cookies (state-cookie channel) ----
let stateCookieValue: string | null = null;
const cookieDeleteMock = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "line_oauth_state" && stateCookieValue !== null
        ? { name, value: stateCookieValue }
        : undefined,
    delete: cookieDeleteMock,
  }),
}));

// ---- token exchange (shared lib) ----
const exchangeMock = vi.fn();
vi.mock("@/lib/auth/line-token-exchange", () => ({
  exchangeLineCode: (...args: unknown[]) => exchangeMock(...args),
}));

// ---- resolve-home (single-project SA landing) ----
vi.mock("@/lib/auth/resolve-home", () => ({
  homePathForUser: async () => "/sa",
}));

// ---- admin client (handoff row lookup + bind, createUser, generateLink, profile write) ----
type HandoffRow = { id: string; status: string; expires_at: string } | null;
let handoffLookupRow: HandoffRow = null;
let bindResult: Array<{ id: string }> = [];
const bindUpdateMock = vi.fn();
const createUserMock = vi.fn();
const generateLinkMock = vi.fn();
const adminUsersUpdateMock = vi.fn();

vi.mock("@/lib/db/admin", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === "login_handoffs") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: handoffLookupRow, error: null }),
            }),
          }),
          update: (values: Record<string, unknown>) => {
            bindUpdateMock(values);
            return {
              eq: () => ({
                eq: () => ({
                  gt: () => ({
                    select: async () => ({ data: bindResult, error: null }),
                  }),
                }),
              }),
            };
          },
        };
      }
      if (table === "users") {
        return {
          update: (values: Record<string, unknown>) => {
            adminUsersUpdateMock(values);
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      throw new Error(`unexpected admin table ${table}`);
    },
    auth: { admin: { createUser: createUserMock, generateLink: generateLinkMock } },
  }),
}));

// ---- SSR server client (verifyOtp + role read) ----
const verifyOtpMock = vi.fn();
let userRow: {
  role: string;
  line_user_id: string | null;
  full_name: string | null;
  line_avatar_url: string | null;
  // spec 265 U1 — LINE-owned identity fields read for the minimal-diff write.
  line_display_name: string | null;
  line_synced_at: string | null;
} | null = null;

vi.mock("@/lib/db/server", () => ({
  createClient: async () => ({
    auth: { verifyOtp: verifyOtpMock },
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: userRow, error: null }),
        }),
      }),
    }),
  }),
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/auth/line/callback/route";

const FUTURE = new Date(Date.now() + 5 * 60_000).toISOString();

function makeRequest(query: string): NextRequest {
  return new NextRequest(`https://app.example.com/auth/line/callback${query}`);
}

beforeEach(() => {
  stateCookieValue = null;
  handoffLookupRow = null;
  bindResult = [];
  userRow = {
    role: "site_admin",
    line_user_id: "Uhandoff1",
    full_name: "สมชาย",
    line_avatar_url: null,
    line_display_name: null,
    line_synced_at: null,
  };
  cookieDeleteMock.mockReset();
  bindUpdateMock.mockReset();
  adminUsersUpdateMock.mockReset();
  exchangeMock.mockReset().mockResolvedValue({
    ok: true,
    claims: { sub: "Uhandoff1", name: "สมชาย", picture: null },
  });
  createUserMock.mockReset().mockResolvedValue({
    data: { user: { id: "user-1" } },
    error: null,
  });
  generateLinkMock.mockReset().mockResolvedValue({
    data: { properties: { hashed_token: "hashed-token" } },
    error: null,
  });
  verifyOtpMock.mockReset().mockResolvedValue({
    data: { user: { id: "user-1" } },
    error: null,
  });
});

describe("GET /auth/line/callback — handoff flow (ADR 0041 amendment)", () => {
  beforeEach(() => {
    // No state cookie; ?state matches a pending, unexpired handoff row.
    handoffLookupRow = { id: "h1", status: "pending", expires_at: FUTURE };
    bindResult = [{ id: "h1" }];
  });

  it("binds the row AND mints the session in the landing context, redirecting by role", async () => {
    const response = await GET(makeRequest("?code=abc&state=st1"));

    // Bind for the PWA's poll path (iOS) stays.
    expect(bindUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "approved",
        user_email: "line_Uhandoff1@line.local",
      }),
    );
    // The landing context gets a real session (Android: this IS the PWA jar).
    expect(generateLinkMock).toHaveBeenCalledWith({
      type: "magiclink",
      email: "line_Uhandoff1@line.local",
    });
    expect(verifyOtpMock).toHaveBeenCalledWith({
      type: "magiclink",
      token_hash: "hashed-token",
    });
    // Redirect goes to the role home, NOT the return-to-app banner.
    expect(response.status).toBeGreaterThanOrEqual(300);
    expect(response.status).toBeLessThan(400);
    const location = response.headers.get("location") ?? "";
    expect(location).toBe("https://app.example.com/sa");
    expect(location).not.toContain("handoff=approved");
  });

  it("bind lost (expired or replayed row) → oauth_failed, no mint", async () => {
    bindResult = [];
    const response = await GET(makeRequest("?code=abc&state=st1"));

    expect(response.headers.get("location")).toBe(
      "https://app.example.com/login?error=oauth_failed",
    );
    expect(generateLinkMock).not.toHaveBeenCalled();
  });

  it("no cookie and no matching row → oauth_failed", async () => {
    handoffLookupRow = null;
    const response = await GET(makeRequest("?code=abc&state=st1"));

    expect(response.headers.get("location")).toBe(
      "https://app.example.com/login?error=oauth_failed",
    );
    expect(exchangeMock).not.toHaveBeenCalled();
  });
});

describe("GET /auth/line/callback — browser flow (pinned unchanged)", () => {
  it("JSON-payload state cookie (no next) → mint + redirect by role, handoff untouched", async () => {
    // Cookie is now a JSON payload {s: <state>}; the CSRF value is `s`.
    stateCookieValue = JSON.stringify({ s: "st1" });
    const response = await GET(makeRequest("?code=abc&state=st1"));

    expect(generateLinkMock).toHaveBeenCalled();
    expect(verifyOtpMock).toHaveBeenCalled();
    expect(bindUpdateMock).not.toHaveBeenCalled();
    // DEFAULT (no next): byte-identical to today — roleHome.
    expect(response.headers.get("location")).toBe("https://app.example.com/sa");
  });

  it("legacy plain-string state cookie still validates (in-flight-login compat)", async () => {
    stateCookieValue = "st1";
    const response = await GET(makeRequest("?code=abc&state=st1"));

    expect(generateLinkMock).toHaveBeenCalled();
    expect(bindUpdateMock).not.toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("https://app.example.com/sa");
  });

  // spec 263 follow-up — the OPTIONAL `next` return path rides the cookie.
  it("valid `next` in the cookie payload → redirect there INSTEAD of roleHome", async () => {
    stateCookieValue = JSON.stringify({ s: "st1", n: "/register/technician" });
    const response = await GET(makeRequest("?code=abc&state=st1"));

    expect(generateLinkMock).toHaveBeenCalled();
    expect(verifyOtpMock).toHaveBeenCalled();
    expect(response.headers.get("location")).toBe("https://app.example.com/register/technician");
  });

  it("unsafe `next` in the cookie payload → falls back to roleHome (defense in depth)", async () => {
    stateCookieValue = JSON.stringify({ s: "st1", n: "https://evil.com" });
    const response = await GET(makeRequest("?code=abc&state=st1"));

    expect(response.headers.get("location")).toBe("https://app.example.com/sa");
  });

  it("still validates CSRF: cookie `s` must equal the ?state param", async () => {
    stateCookieValue = JSON.stringify({ s: "st1", n: "/register/technician" });
    const response = await GET(makeRequest("?code=abc&state=DIFFERENT"));

    // Mismatch → invalid flow → login error, no mint.
    expect(response.headers.get("location")).toBe(
      "https://app.example.com/login?error=oauth_failed",
    );
    expect(generateLinkMock).not.toHaveBeenCalled();
  });
});

// spec 265 U1 — the profile-write block now ALSO stamps the LINE-owned identity
// (line_display_name = claims.name, ALWAYS refreshed; line_synced_at = now()),
// WITHOUT disturbing full_name (NULL-only, user-owned — ADR 0020/0017) or the
// default redirect flow. The write remains in step 7 only.
describe("GET /auth/line/callback — LINE identity write (spec 265 U1)", () => {
  it("always refreshes line_display_name + stamps line_synced_at, and does NOT overwrite an already-set full_name", async () => {
    // full_name is ALREADY set (the person edited their in-app name → it has
    // drifted from the LINE name). claims.name is the CURRENT LINE display name.
    stateCookieValue = JSON.stringify({ s: "st1" });
    userRow = {
      role: "site_admin",
      line_user_id: "Uhandoff1", // already set → NOT rewritten
      full_name: "ชื่อที่ผู้ใช้แก้เอง", // user-edited → must stay untouched
      line_avatar_url: "https://line/pic.jpg", // same as claims → no avatar write
      line_display_name: null,
      line_synced_at: null,
    };
    exchangeMock.mockResolvedValue({
      ok: true,
      claims: { sub: "Uhandoff1", name: "สมชาย LINE", picture: "https://line/pic.jpg" },
    });

    const response = await GET(makeRequest("?code=abc&state=st1"));

    // The admin-client write ran exactly once with the identity fields.
    expect(adminUsersUpdateMock).toHaveBeenCalledTimes(1);
    const written = adminUsersUpdateMock.mock.calls[0]![0] as Record<string, unknown>;
    // line_display_name = the CURRENT LINE name, always refreshed.
    expect(written.line_display_name).toBe("สมชาย LINE");
    // line_synced_at is stamped as an ISO-8601 timestamp string.
    expect(typeof written.line_synced_at).toBe("string");
    expect(Number.isNaN(Date.parse(written.line_synced_at as string))).toBe(false);
    // full_name (user-owned, already set) is NOT in the update.
    expect(written).not.toHaveProperty("full_name");
    // line_user_id (already set) is NOT rewritten; avatar unchanged (same URL).
    expect(written).not.toHaveProperty("line_user_id");
    expect(written).not.toHaveProperty("line_avatar_url");
    // Default flow redirect is byte-identical to before (roleHome).
    expect(response.headers.get("location")).toBe("https://app.example.com/sa");
  });

  it("first login (full_name NULL) sets full_name NULL-only AND stamps LINE identity together", async () => {
    stateCookieValue = JSON.stringify({ s: "st1" });
    userRow = {
      role: "site_admin",
      line_user_id: null,
      full_name: null,
      line_avatar_url: null,
      line_display_name: null,
      line_synced_at: null,
    };
    exchangeMock.mockResolvedValue({
      ok: true,
      claims: { sub: "Uhandoff1", name: "สมชาย", picture: null },
    });

    await GET(makeRequest("?code=abc&state=st1"));

    const written = adminUsersUpdateMock.mock.calls[0]![0] as Record<string, unknown>;
    // full_name seeded NULL-only from LINE (unchanged ADR 0017 behavior).
    expect(written.full_name).toBe("สมชาย");
    // AND the LINE-owned identity is stamped in the same write.
    expect(written.line_display_name).toBe("สมชาย");
    expect(typeof written.line_synced_at).toBe("string");
    expect(written.line_user_id).toBe("Uhandoff1");
  });
});
