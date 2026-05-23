// Spike: LINE custom-flow auth — Step 1 of 3 (initiator).
// See spikes/line-auth-FINDINGS.md. Throwaway exploratory code.

import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";

const LINE_AUTHORIZE_URL = "https://access.line.me/oauth2/v2.1/authorize";
const STATE_COOKIE = "line_spike_state";
const STATE_COOKIE_MAX_AGE_SECONDS = 600;

export function GET(request: NextRequest) {
  const channelId = process.env.LINE_CHANNEL_ID;
  if (!channelId) {
    return new NextResponse("Spike misconfigured: LINE_CHANNEL_ID not set in environment.", {
      status: 500,
      headers: { "content-type": "text/plain" },
    });
  }

  const state = randomBytes(16).toString("hex");
  // Derive redirect_uri from the incoming request's own origin so the spike works on
  // localhost, Vercel Preview, and production without environment juggling. Must match
  // the value the callback handler sends to LINE's token endpoint.
  const redirectUri = `${request.nextUrl.origin}/spikes/line-auth/callback`;

  const url = new URL(LINE_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", channelId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  url.searchParams.set("scope", "openid profile");

  const response = NextResponse.redirect(url.toString(), { status: 302 });
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/spikes/line-auth",
    maxAge: STATE_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}
