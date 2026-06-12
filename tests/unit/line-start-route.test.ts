// Spec 42 — /auth/line/start standalone behavior.
//
// The installed iOS PWA must keep the whole LINE OAuth flow inside its
// own browsing context: ?standalone=1 + an iOS User-Agent appends
// disable_auto_login=true to the authorize URL so LINE shows its web
// login instead of deep-linking into the LINE app (which strands the
// callback — and the session — in the system browser's cookie jar).

import { describe, it, expect, vi } from "vitest";

// The route imports serverEnv, which validates process.env at module
// load and throws on missing vars. Mock the module so the route is
// testable without a full server env.
vi.mock("@/lib/env.server", () => ({
  serverEnv: { LINE_CHANNEL_ID: "test-channel-id" },
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/auth/line/start/route";

const IOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID_UA =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Mobile Safari/537.36";

function makeRequest(path: string, userAgent: string): NextRequest {
  return new NextRequest(`https://app.example.com${path}`, {
    headers: { "user-agent": userAgent },
  });
}

function authorizeUrl(response: Response): URL {
  const location = response.headers.get("location");
  if (!location) throw new Error("redirect response missing Location header");
  return new URL(location);
}

describe("GET /auth/line/start", () => {
  it("redirects to LINE authorize without disable_auto_login by default (browser launch)", () => {
    const response = GET(makeRequest("/auth/line/start", IOS_UA));
    const url = authorizeUrl(response);
    expect(url.origin + url.pathname).toBe("https://access.line.me/oauth2/v2.1/authorize");
    expect(url.searchParams.get("client_id")).toBe("test-channel-id");
    expect(url.searchParams.get("redirect_uri")).toBe("https://app.example.com/auth/line/callback");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(url.searchParams.get("disable_auto_login")).toBeNull();
  });

  it("appends disable_auto_login=true for standalone=1 on iOS", () => {
    const response = GET(makeRequest("/auth/line/start?standalone=1", IOS_UA));
    const url = authorizeUrl(response);
    expect(url.searchParams.get("disable_auto_login")).toBe("true");
    // The rest of the flow is unchanged — state cookie still set.
    expect(response.cookies.get("line_oauth_state")?.value).toBe(url.searchParams.get("state"));
  });

  it("leaves disable_auto_login off for standalone=1 on Android (shared WebAPK jar)", () => {
    const response = GET(makeRequest("/auth/line/start?standalone=1", ANDROID_UA));
    const url = authorizeUrl(response);
    expect(url.searchParams.get("disable_auto_login")).toBeNull();
  });
});
