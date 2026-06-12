// Spec 43 / ADR 0041 — device-code handoff, step 1 of 3 (initiator).
//
// Called by the standalone PWA's login control instead of
// /auth/line/start. Issues a login_handoffs row whose `state` rides the
// authorize URL (DB-validated at the callback — the PWA's cookies never
// reach the browser context LINE may drop the user in) and whose
// `device_code` stays with the PWA for /auth/handoff/poll. POST-only:
// the row insert is a side effect and the codes must not land in URLs
// or prefetch caches. Expired rows are purged opportunistically here.

import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createAdminSupabase } from "@/lib/db/admin";
import { buildLineAuthorizeUrl } from "@/lib/auth/line-authorize-url";
import { serverEnv } from "@/lib/env.server";

const HANDOFF_TTL_SECONDS = 600; // matches the browser flow's state cookie

export async function POST(request: NextRequest): Promise<NextResponse> {
  const state = randomBytes(16).toString("hex");
  const deviceCode = randomBytes(32).toString("hex");
  const admin = createAdminSupabase();

  await admin.from("login_handoffs").delete().lt("expires_at", new Date().toISOString());

  const { error } = await admin.from("login_handoffs").insert({
    state,
    device_code: deviceCode,
    expires_at: new Date(Date.now() + HANDOFF_TTL_SECONDS * 1000).toISOString(),
  });
  if (error) {
    console.error("[auth/handoff/start] insert failed", { message: error.message });
    return NextResponse.json({ error: "handoff_failed" }, { status: 500 });
  }

  const authorizeUrl = buildLineAuthorizeUrl({
    origin: request.nextUrl.origin,
    state,
    channelId: serverEnv.LINE_CHANNEL_ID,
  });
  return NextResponse.json({ device_code: deviceCode, authorize_url: authorizeUrl.toString() });
}
