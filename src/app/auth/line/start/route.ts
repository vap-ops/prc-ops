// Custom-flow LINE auth — Step 1 of 2 (initiator). See ADR 0012.
//
// Generates a CSRF `state`, stores it in an httpOnly cookie scoped to
// /auth/line, and 302s to LINE's authorize endpoint. The `redirect_uri`
// is derived from the incoming request's own origin so the flow works
// on production, every Vercel preview, and localhost without per-env
// env vars (multi-env policy from ADR 0012 — both this route and the
// callback must compute the same value on a given request).
//
// Browser flow only: the installed PWA starts its login through
// /auth/handoff/start instead (spec 43 / ADR 0041 — its cookies can't
// survive the LINE-app → system-browser hop, so its state lives in
// login_handoffs rather than this cookie).

import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { buildLineAuthorizeUrl } from "@/lib/auth/line-authorize-url";
import { serverEnv } from "@/lib/env.server";

const STATE_COOKIE_NAME = "line_oauth_state";
const STATE_COOKIE_MAX_AGE_SECONDS = 600;

export function GET(request: NextRequest) {
  const state = randomBytes(16).toString("hex");
  const authorizeUrl = buildLineAuthorizeUrl({
    origin: request.nextUrl.origin,
    state,
    channelId: serverEnv.LINE_CHANNEL_ID,
  });

  const response = NextResponse.redirect(authorizeUrl.toString(), { status: 302 });
  response.cookies.set(STATE_COOKIE_NAME, state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/auth/line",
    maxAge: STATE_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}
