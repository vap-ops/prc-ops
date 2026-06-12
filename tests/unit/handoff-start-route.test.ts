// Spec 43 — POST /auth/handoff/start: issues a device-code handoff row
// and returns the LINE authorize URL carrying the row's state. The
// standalone PWA calls this instead of /auth/line/start (ADR 0041).

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/env.server", () => ({
  serverEnv: { LINE_CHANNEL_ID: "test-channel-id" },
}));

const insertMock = vi.fn();
const ltMock = vi.fn();
vi.mock("@/lib/db/admin", () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table !== "login_handoffs") throw new Error(`unexpected table ${table}`);
      return {
        delete: () => ({ lt: ltMock }),
        insert: insertMock,
      };
    },
  }),
}));

import { NextRequest } from "next/server";
import * as route from "@/app/auth/handoff/start/route";

function makeRequest(): NextRequest {
  return new NextRequest("https://app.example.com/auth/handoff/start", { method: "POST" });
}

beforeEach(() => {
  insertMock.mockReset().mockResolvedValue({ error: null });
  ltMock.mockReset().mockResolvedValue({ error: null });
});

describe("POST /auth/handoff/start", () => {
  it("inserts a pending row and returns device_code + authorize_url", async () => {
    const response = await route.POST(makeRequest());
    expect(response.status).toBe(200);
    const json = (await response.json()) as { device_code: string; authorize_url: string };

    // 32 random bytes, hex — never guessable, never in a URL.
    expect(json.device_code).toMatch(/^[0-9a-f]{64}$/);

    const url = new URL(json.authorize_url);
    expect(url.origin + url.pathname).toBe("https://access.line.me/oauth2/v2.1/authorize");
    expect(url.searchParams.get("client_id")).toBe("test-channel-id");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example.com/auth/line/callback");
    expect(url.searchParams.get("scope")).toBe("openid profile");
    // Auto-login is wanted again — the handoff tolerates the browser hop.
    expect(url.searchParams.get("disable_auto_login")).toBeNull();

    expect(insertMock).toHaveBeenCalledTimes(1);
    const inserted = insertMock.mock.calls[0]?.[0] as {
      state: string;
      device_code: string;
      expires_at: string;
    };
    expect(inserted.state).toBe(url.searchParams.get("state"));
    expect(inserted.device_code).toBe(json.device_code);
    expect(new Date(inserted.expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it("purges expired rows opportunistically", async () => {
    await route.POST(makeRequest());
    expect(ltMock).toHaveBeenCalledWith("expires_at", expect.any(String));
  });

  it("fails closed when the insert errors", async () => {
    insertMock.mockResolvedValue({ error: { message: "boom" } });
    const response = await route.POST(makeRequest());
    expect(response.status).toBe(500);
  });

  it("exposes no GET handler (POST-only route)", () => {
    expect((route as Record<string, unknown>).GET).toBeUndefined();
  });
});
