// Spec 43 — POST /auth/handoff/poll: the standalone PWA polls with its
// device_code; an approved row is atomically claimed (consumed) and the
// Supabase session is minted onto THIS response, in the PWA's cookie
// jar (ADR 0041). Everything not claimable answers "expired".

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/env.server", () => ({
  serverEnv: { LINE_CHANNEL_ID: "test-channel-id" },
}));

type HandoffRow = {
  id: string;
  status: "pending" | "approved" | "consumed";
  user_email: string | null;
  line_claims: { sub?: string; name?: string | null; picture?: string | null };
  expires_at: string;
};

// ---- admin client mock (login_handoffs + users tables + generateLink) ----
let handoffRow: HandoffRow | null = null;
let claimResult: Array<{ id: string }> = [];
const claimUpdateMock = vi.fn();
const usersUpdateMock = vi.fn();
const generateLinkMock = vi.fn();

vi.mock("@/lib/db/admin", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === "login_handoffs") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: handoffRow, error: null }),
            }),
          }),
          update: (values: Record<string, unknown>) => {
            claimUpdateMock(values);
            return {
              eq: () => ({
                eq: () => ({
                  select: async () => ({ data: claimResult, error: null }),
                }),
              }),
            };
          },
        };
      }
      if (table === "users") {
        return {
          update: (values: Record<string, unknown>) => {
            usersUpdateMock(values);
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    auth: { admin: { generateLink: generateLinkMock } },
  }),
}));

// ---- SSR server client mock (verifyOtp + role read) ----
const verifyOtpMock = vi.fn();
let userRow: {
  role: string;
  line_user_id: string | null;
  full_name: string | null;
  line_avatar_url: string | null;
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
import { POST } from "@/app/auth/handoff/poll/route";

function makeRequest(body: unknown): NextRequest {
  return new NextRequest("https://app.example.com/auth/handoff/poll", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const FUTURE = new Date(Date.now() + 5 * 60_000).toISOString();
const PAST = new Date(Date.now() - 60_000).toISOString();

function approvedRow(overrides: Partial<HandoffRow> = {}): HandoffRow {
  return {
    id: "h1",
    status: "approved",
    user_email: "line_Uhandoff1@line.local",
    line_claims: { sub: "Uhandoff1", name: "สมชาย", picture: null },
    expires_at: FUTURE,
    ...overrides,
  };
}

beforeEach(() => {
  handoffRow = null;
  claimResult = [];
  claimUpdateMock.mockReset();
  usersUpdateMock.mockReset();
  generateLinkMock.mockReset().mockResolvedValue({
    data: { properties: { hashed_token: "hashed-token" } },
    error: null,
  });
  verifyOtpMock.mockReset().mockResolvedValue({
    data: { user: { id: "user-1" } },
    error: null,
  });
  userRow = { role: "site_admin", line_user_id: null, full_name: null, line_avatar_url: null };
});

describe("POST /auth/handoff/poll", () => {
  it("answers expired for an unknown device_code", async () => {
    const response = await POST(makeRequest({ device_code: "nope" }));
    expect(await response.json()).toEqual({ status: "expired" });
  });

  it("answers pending for a pending, unexpired row", async () => {
    handoffRow = approvedRow({ status: "pending", user_email: null });
    const response = await POST(makeRequest({ device_code: "d" }));
    expect(await response.json()).toEqual({ status: "pending" });
  });

  it("answers expired for a pending row past its TTL", async () => {
    handoffRow = approvedRow({ status: "pending", user_email: null, expires_at: PAST });
    const response = await POST(makeRequest({ device_code: "d" }));
    expect(await response.json()).toEqual({ status: "expired" });
  });

  it("answers expired for a consumed row (single use)", async () => {
    handoffRow = approvedRow({ status: "consumed" });
    const response = await POST(makeRequest({ device_code: "d" }));
    expect(await response.json()).toEqual({ status: "expired" });
  });

  it("claims an approved row, mints the session, and returns the role home", async () => {
    handoffRow = approvedRow();
    claimResult = [{ id: "h1" }];
    const response = await POST(makeRequest({ device_code: "d" }));
    // Spec 192 U4: site_admin's role home is the daily home /sa.
    expect(await response.json()).toEqual({ status: "ok", redirect: "/sa" });

    // Atomic claim before any minting.
    expect(claimUpdateMock).toHaveBeenCalledWith({ status: "consumed" });
    expect(generateLinkMock).toHaveBeenCalledWith({
      type: "magiclink",
      email: "line_Uhandoff1@line.local",
    });
    expect(verifyOtpMock).toHaveBeenCalledWith({
      type: "magiclink",
      token_hash: "hashed-token",
    });
    // Profile write parity with the browser callback (NULL-only fields).
    expect(usersUpdateMock).toHaveBeenCalledWith({
      line_user_id: "Uhandoff1",
      full_name: "สมชาย",
    });
  });

  it("answers expired when the claim is lost to a concurrent poll", async () => {
    handoffRow = approvedRow();
    claimResult = []; // another request already flipped it
    const response = await POST(makeRequest({ device_code: "d" }));
    expect(await response.json()).toEqual({ status: "expired" });
    expect(generateLinkMock).not.toHaveBeenCalled();
  });

  it("answers expired on a malformed body", async () => {
    const response = await POST(makeRequest({}));
    expect(await response.json()).toEqual({ status: "expired" });
  });
});
