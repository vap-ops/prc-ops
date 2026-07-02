// Custom-flow LINE auth — Step 2 of 2 (callback). See ADR 0012 + 0041.
//
// Two flows share this endpoint, resolved by resolveCallbackFlow():
//
// BROWSER (ADR 0012, unchanged behavior):
//   1. Validate CSRF state (cookie vs query param). Cookie is single-use.
//   2. Exchange ?code + verify the HS256 id_token (shared lib).
//   3. Provision-or-locate the auth.users row (admin client; synthetic
//      email line_<sub>@line.local; duplicates idempotent).
//   4. Mint a Supabase session via admin.generateLink({type:'magiclink'})
//      then verifyOtp({type:'magiclink', token_hash}) on the SSR client so
//      the sb-* cookies are written onto the route handler's response.
//   5. Read public.users.role (retried for the trigger-race window).
//   6. Profile write: NULL-only line_user_id/full_name; avatar refresh.
//   7. Redirect by role.
//
// HANDOFF (spec 43 / ADR 0041 as amended 2026-07-02 — flow started
// inside the installed PWA, landing context unpredictable): state
// validates against a pending, unexpired login_handoffs row instead of
// the cookie. Steps 2–3 run the same, then the row is atomically bound
// (user_email + claims stash, status → approved) and the flow FALLS
// THROUGH into steps 5–8: the session is minted in the landing context
// too. On Android the callback link-captures back into the installed
// PWA, so the landing jar is the PWA's jar and this mint IS the login;
// on iOS the landing context is Safari and the PWA still collects its
// own session via /auth/handoff/poll from the approved row.
//
// Security: all Supabase clients are created INSIDE this handler (no
// module-scope instances — Vercel Fluid Compute reuses warm processes
// across requests). The admin (service-role) client never reaches the
// browser; the generateLink hashed_token is consumed in the same handler.

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createAdminSupabase } from "@/lib/db/admin";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { resolveCallbackFlow } from "@/lib/auth/handoff-flow";
import { exchangeLineCode } from "@/lib/auth/line-token-exchange";
import { type UserRole } from "@/lib/auth/role-home";
import { homePathForUser } from "@/lib/auth/resolve-home";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import { serverEnv } from "@/lib/env.server";

const STATE_COOKIE_NAME = "line_oauth_state";
const PROFILE_READ_MAX_ATTEMPTS = 3;
const PROFILE_READ_RETRY_DELAY_MS = 50;

function redirectToLogin(request: NextRequest, error: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}

async function redirectByRole(
  request: NextRequest,
  client: SupabaseClient<Database>,
  role: UserRole,
  userId: string,
): Promise<NextResponse> {
  const url = request.nextUrl.clone();
  url.search = "";
  // A single-project site_admin lands on their project (operator: works one
  // project at a time); every other role lands on its roleHome.
  url.pathname = await homePathForUser(client, role, userId);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // ---- 1. Resolve the flow from the state channel (cookie or DB row) ----
  const cookieStore = await cookies();
  const stateCookie = cookieStore.get(STATE_COOKIE_NAME)?.value ?? null;
  const stateParam = request.nextUrl.searchParams.get("state");
  // Single-use: clear the cookie regardless of outcome.
  cookieStore.delete(STATE_COOKIE_NAME);

  const admin = createAdminSupabase();
  let handoffRow: { id: string; status: string; expires_at: string } | null = null;
  if (stateParam && (!stateCookie || stateCookie !== stateParam)) {
    const { data } = await admin
      .from("login_handoffs")
      .select("id, status, expires_at")
      .eq("state", stateParam)
      .maybeSingle();
    handoffRow = data;
  }

  const flow = resolveCallbackFlow({ stateParam, stateCookie, handoffRow, nowMs: Date.now() });
  if (flow.kind === "invalid") {
    console.error("[auth/line/callback] state mismatch (no cookie, no handoff row)");
    return redirectToLogin(request, "oauth_failed");
  }

  // ---- 2. Read code / error from LINE ----
  const oauthError = request.nextUrl.searchParams.get("error");
  if (oauthError) {
    console.error("[auth/line/callback] LINE returned error", {
      error: oauthError,
      description: request.nextUrl.searchParams.get("error_description"),
    });
    return redirectToLogin(request, "oauth_failed");
  }
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    console.error("[auth/line/callback] missing ?code in callback URL");
    return redirectToLogin(request, "oauth_failed");
  }

  // ---- 3. Exchange code + verify id_token (shared lib, ADR 0012 §2–3) ----
  const exchange = await exchangeLineCode({
    code,
    redirectUri: `${request.nextUrl.origin}/auth/line/callback`,
    channelId: serverEnv.LINE_CHANNEL_ID,
    channelSecret: serverEnv.LINE_CHANNEL_SECRET,
  });
  if (!exchange.ok) {
    console.error("[auth/line/callback] code exchange failed", {
      reason: exchange.reason,
      detail: exchange.detail,
    });
    return redirectToLogin(request, "oauth_failed");
  }
  const claims = exchange.claims;

  // ---- 4. Provision or locate auth.users (idempotent on synthetic email) ----
  const syntheticEmail = `line_${claims.sub}@line.local`;
  const createResult = await admin.auth.admin.createUser({
    email: syntheticEmail,
    email_confirm: true,
    user_metadata: {
      provider: "line",
      line_sub: claims.sub,
      name: claims.name,
    },
  });
  if (createResult.error) {
    const errorCode = createResult.error.code ?? "";
    const isDuplicate =
      errorCode === "email_exists" ||
      errorCode === "user_already_exists" ||
      createResult.error.message.toLowerCase().includes("already");
    if (!isDuplicate) {
      console.error("[auth/line/callback] admin.createUser failed", {
        code: errorCode,
        message: createResult.error.message,
      });
      return redirectToLogin(request, "unknown");
    }
    // Duplicate → user already provisioned from a prior login. Continue.
  }

  // ---- HANDOFF: bind identity to the row for the PWA's poll ----
  if (flow.kind === "handoff") {
    const { data: bound } = await admin
      .from("login_handoffs")
      .update({
        status: "approved",
        user_email: syntheticEmail,
        line_claims: { sub: claims.sub, name: claims.name, picture: claims.picture },
      })
      .eq("id", flow.rowId)
      .eq("status", "pending")
      .gt("expires_at", new Date().toISOString())
      .select("id");
    if (!bound || bound.length === 0) {
      console.error("[auth/line/callback] handoff bind lost (expired or replayed)", {
        rowId: flow.rowId,
      });
      return redirectToLogin(request, "oauth_failed");
    }
    // ADR 0041 amendment (Android incident 2026-07-02): FALL THROUGH and
    // mint the session in the landing context too, via the same steps
    // 5–8 as the browser flow. Android link-captures the callback back
    // into the installed PWA, so the landing jar IS the PWA's jar —
    // minting here signs the user in regardless of client JS version,
    // localStorage readability, or whether the initiating document
    // survived the LINE round-trip. The approved row stays for iOS,
    // where the landing context is Safari and the PWA still collects
    // its own session through /auth/handoff/poll.
  }

  // ---- 5. Mint session (generateLink → verifyOtp) ----
  const linkResult = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: syntheticEmail,
  });
  if (linkResult.error || !linkResult.data.properties?.hashed_token) {
    console.error("[auth/line/callback] admin.generateLink failed", {
      code: linkResult.error?.code,
      message: linkResult.error?.message,
    });
    return redirectToLogin(request, "session_failed");
  }
  const hashedToken = linkResult.data.properties.hashed_token;

  const supabase = await createServerSupabase();
  const verifyResult = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: hashedToken,
  });
  if (verifyResult.error || !verifyResult.data.user) {
    console.error("[auth/line/callback] verifyOtp failed", {
      message: verifyResult.error?.message,
    });
    return redirectToLogin(request, "session_failed");
  }
  const user = verifyResult.data.user;

  // ---- 6. Read public.users.role (retry for trigger-race) ----
  let row: {
    role: string;
    line_user_id: string | null;
    full_name: string | null;
    line_avatar_url: string | null;
  } | null = null;
  for (let attempt = 0; attempt < PROFILE_READ_MAX_ATTEMPTS; attempt++) {
    const { data } = await supabase
      .from("users")
      .select("role, line_user_id, full_name, line_avatar_url")
      .eq("id", user.id)
      .maybeSingle();
    if (data) {
      row = data;
      break;
    }
    if (attempt < PROFILE_READ_MAX_ATTEMPTS - 1) {
      await new Promise((resolve) => setTimeout(resolve, PROFILE_READ_RETRY_DELAY_MS));
    }
  }
  if (!row) {
    console.error("[auth/line/callback] users row missing after retries", {
      userId: user.id,
    });
    return redirectToLogin(request, "unknown");
  }

  // ---- 7. Profile write (admin client) ----
  // line_user_id / full_name: NULL-only (set once at first login, never overwritten).
  // line_avatar_url: REFRESH-on-login (update whenever claims.picture differs from
  //   stored value, including clearing to null if the user removed their LINE picture).
  //   LINE owns this field; the user owns full_name. See ADR 0020.
  const updates: { line_user_id?: string; full_name?: string; line_avatar_url?: string | null } =
    {};
  if (row.line_user_id === null) updates.line_user_id = claims.sub;
  if (row.full_name === null && claims.name) updates.full_name = claims.name;
  if (claims.picture !== row.line_avatar_url) updates.line_avatar_url = claims.picture;
  if (Object.keys(updates).length > 0) {
    const { error: updateError } = await admin.from("users").update(updates).eq("id", user.id);
    if (updateError) {
      console.error("[auth/line/callback] profile update failed", {
        userId: user.id,
        message: updateError.message,
      });
      // Non-fatal — the user is signed in, just continue with the redirect.
    }
  }

  // ---- 8. Redirect by role ----
  // Admin client: a deterministic, RLS-independent membership lookup by id.
  return redirectByRole(request, admin, row.role as UserRole, user.id);
}
