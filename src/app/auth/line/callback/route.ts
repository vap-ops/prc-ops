// Custom-flow LINE auth — Step 2 of 2 (callback). See ADR 0012.
//
// Flow:
//   1. Validate CSRF state (cookie vs query param). Cookie is single-use.
//   2. Exchange ?code at LINE's token endpoint.
//   3. Verify the HS256 id_token (alg, signature via timingSafeEqual, iss,
//      aud, exp, iat, sub) — see src/lib/auth/verify-line-id-token.ts.
//   4. Provision-or-locate the auth.users row via the admin (service-role)
//      client. Synthetic email line_<sub>@line.local; email_confirm true.
//      Duplicates are idempotent.
//   5. Mint a Supabase session via admin.generateLink({type:'magiclink'})
//      then verifyOtp({type:'magiclink', token_hash}) on the SSR client so
//      the sb-* cookies are written onto the route handler's response.
//   6. Read public.users.role for the user (retried for the trigger-race
//      window; RLS recursion fixed by ADR 0011 so the read works).
//   7. NULL-only profile write (admin client): populate line_user_id /
//      full_name only if currently NULL.
//   8. Redirect by role.
//
// Security: all Supabase clients are created INSIDE this handler (no
// module-scope instances — Vercel Fluid Compute reuses warm processes
// across requests). The admin (service-role) client never reaches the
// browser; the generateLink hashed_token is consumed in the same handler.

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createAdminSupabase } from "@/lib/db/admin";
import { createClient as createServerSupabase } from "@/lib/db/server";
import { serverEnv } from "@/lib/env.server";
import { verifyLineIdToken, type LineIdTokenClaims } from "@/lib/auth/verify-line-id-token";

const LINE_TOKEN_URL = "https://api.line.me/oauth2/v2.1/token";
const STATE_COOKIE_NAME = "line_oauth_state";
const PROFILE_READ_MAX_ATTEMPTS = 3;
const PROFILE_READ_RETRY_DELAY_MS = 50;

interface TokenEndpointResponse {
  id_token?: unknown;
}

function redirectToLogin(request: NextRequest, error: string): NextResponse {
  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  url.searchParams.set("error", error);
  return NextResponse.redirect(url);
}

function redirectByRole(request: NextRequest, role: string): NextResponse {
  const url = request.nextUrl.clone();
  url.search = "";
  if (role === "site_admin") {
    url.pathname = "/sa";
  } else if (role === "project_manager") {
    url.pathname = "/pm";
  } else {
    url.pathname = "/coming-soon";
  }
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  // ---- 1. Validate state (CSRF) ----
  const cookieStore = await cookies();
  const stateCookie = cookieStore.get(STATE_COOKIE_NAME)?.value ?? null;
  const stateParam = request.nextUrl.searchParams.get("state");
  // Single-use: clear the cookie regardless of outcome.
  cookieStore.delete(STATE_COOKIE_NAME);

  if (!stateCookie || !stateParam || stateCookie !== stateParam) {
    console.error("[auth/line/callback] state mismatch");
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

  // ---- 3. Exchange code at LINE token endpoint ----
  const redirectUri = `${request.nextUrl.origin}/auth/line/callback`;
  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: redirectUri,
    client_id: serverEnv.LINE_CHANNEL_ID,
    client_secret: serverEnv.LINE_CHANNEL_SECRET,
  });

  let tokenResp: Response;
  try {
    tokenResp = await fetch(LINE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: tokenBody,
    });
  } catch (err) {
    console.error("[auth/line/callback] LINE token endpoint fetch failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return redirectToLogin(request, "oauth_failed");
  }
  if (!tokenResp.ok) {
    const responseBody = await tokenResp.text();
    console.error("[auth/line/callback] LINE token exchange failed", {
      status: tokenResp.status,
      body: responseBody,
    });
    return redirectToLogin(request, "oauth_failed");
  }
  const tokenJson = (await tokenResp.json()) as TokenEndpointResponse;
  if (typeof tokenJson.id_token !== "string") {
    console.error("[auth/line/callback] LINE token response missing id_token");
    return redirectToLogin(request, "oauth_failed");
  }

  // ---- 4. Verify HS256 id_token ----
  let claims: LineIdTokenClaims;
  try {
    claims = verifyLineIdToken(
      tokenJson.id_token,
      serverEnv.LINE_CHANNEL_SECRET,
      serverEnv.LINE_CHANNEL_ID,
    );
  } catch (err) {
    console.error("[auth/line/callback] id_token verification failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    return redirectToLogin(request, "oauth_failed");
  }

  // ---- 5. Provision or locate auth.users (idempotent on synthetic email) ----
  const syntheticEmail = `line_${claims.sub}@line.local`;
  const admin = createAdminSupabase();
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
    const code = createResult.error.code ?? "";
    const isDuplicate =
      code === "email_exists" ||
      code === "user_already_exists" ||
      createResult.error.message.toLowerCase().includes("already");
    if (!isDuplicate) {
      console.error("[auth/line/callback] admin.createUser failed", {
        code,
        message: createResult.error.message,
      });
      return redirectToLogin(request, "unknown");
    }
    // Duplicate → user already provisioned from a prior login. Continue.
  }

  // ---- 6. Mint session: generateLink(magiclink) → verifyOtp(token_hash) ----
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

  // ---- 7. Read public.users.role (retry for trigger-race) ----
  let row: {
    role: string;
    line_user_id: string | null;
    full_name: string | null;
  } | null = null;
  for (let attempt = 0; attempt < PROFILE_READ_MAX_ATTEMPTS; attempt++) {
    const { data } = await supabase
      .from("users")
      .select("role, line_user_id, full_name")
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

  // ---- 8. NULL-only profile write (admin client) ----
  const updates: { line_user_id?: string; full_name?: string } = {};
  if (row.line_user_id === null) updates.line_user_id = claims.sub;
  if (row.full_name === null && claims.name) updates.full_name = claims.name;
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

  // ---- 9. Redirect by role ----
  return redirectByRole(request, row.role);
}
