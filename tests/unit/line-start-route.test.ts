// /auth/line/start — browser-flow initiator (ADR 0012). Spec 43 named
// update: the spec-42 disable_auto_login branch is removed (standalone
// launches now use /auth/handoff/start), so this file pins only the
// plain authorize redirect + state cookie.

import { describe, it, expect, vi } from "vitest";

// The route imports serverEnv, which validates process.env at module
// load and throws on missing vars. Mock the module so the route is
// testable without a full server env.
vi.mock("@/lib/env.server", () => ({
  serverEnv: { LINE_CHANNEL_ID: "test-channel-id" },
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/auth/line/start/route";

function makeRequest(path: string): NextRequest {
  return new NextRequest(`https://app.example.com${path}`);
}

function authorizeUrl(response: Response): URL {
  const location = response.headers.get("location");
  if (!location) throw new Error("redirect response missing Location header");
  return new URL(location);
}

describe("GET /auth/line/start", () => {
  it("redirects to LINE authorize with the locked params and a state cookie", () => {
    const response = GET(makeRequest("/auth/line/start"));
    const url = authorizeUrl(response);
    expect(url.origin + url.pathname).toBe("https://access.line.me/oauth2/v2.1/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("test-channel-id");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example.com/auth/line/callback");
    expect(url.searchParams.get("scope")).toBe("openid profile");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(response.cookies.get("line_oauth_state")?.value).toBe(url.searchParams.get("state"));
  });

  it("never sets disable_auto_login (spec-42 branch removed by spec 43)", () => {
    const response = GET(makeRequest("/auth/line/start?standalone=1"));
    const url = authorizeUrl(response);
    expect(url.searchParams.get("disable_auto_login")).toBeNull();
  });
});
