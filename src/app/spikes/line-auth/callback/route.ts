// Spike: LINE custom-flow auth — Step 2 of 3 (callback handler).
// See spikes/line-auth-FINDINGS.md. Throwaway exploratory code.
//
// Flow:
//   1. Verify state cookie matches ?state param (CSRF).
//   2. Exchange ?code at LINE's token endpoint.
//   3. Verify the HS256-signed id_token using LINE_CHANNEL_SECRET as the HMAC key.
//   4. Provision or locate auth.users via admin.createUser (idempotent on email).
//   5. Mint a Supabase session via admin.generateLink({type:'magiclink'}) then
//      verifyOtp({type:'magiclink', token_hash}) on the SSR client — this is the
//      canonical "admin login as user" workaround in 2026 (Supabase Discussion
//      #11854; supabase-js still has no direct admin-mints-session API).
//   6. Redirect to /spikes/line-auth/result.

import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { createClient as createAdminSupabase } from "@/lib/db/admin";
import { createClient as createServerSupabase } from "@/lib/db/server";

const LINE_TOKEN_URL = "https://api.line.me/oauth2/v2.1/token";
const LINE_ISSUER = "https://access.line.me";
const STATE_COOKIE = "line_spike_state";

interface LineIdTokenClaims {
  sub: string;
  iss: string;
  aud: string;
  exp: number;
  iat: number;
  name: string | undefined;
}

function base64UrlDecode(s: string): Buffer {
  return Buffer.from(s, "base64url");
}

function verifyLineIdToken(
  token: string,
  channelSecret: string,
  channelId: string,
): LineIdTokenClaims {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error(`malformed JWT: expected 3 parts, got ${parts.length}`);
  }
  const [headerB64, payloadB64, signatureB64] = parts;
  if (!headerB64 || !payloadB64 || !signatureB64) {
    throw new Error("malformed JWT: empty segment");
  }

  const header = JSON.parse(base64UrlDecode(headerB64).toString("utf8")) as {
    alg?: unknown;
    typ?: unknown;
  };
  if (header.alg !== "HS256") {
    throw new Error(`unexpected alg: ${String(header.alg ?? "(missing)")}, want HS256`);
  }

  const expected = createHmac("sha256", channelSecret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const actual = base64UrlDecode(signatureB64);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw new Error("signature mismatch");
  }

  const payload = JSON.parse(base64UrlDecode(payloadB64).toString("utf8")) as {
    sub?: unknown;
    iss?: unknown;
    aud?: unknown;
    exp?: unknown;
    iat?: unknown;
    name?: unknown;
  };
  if (payload.iss !== LINE_ISSUER) {
    throw new Error(`unexpected iss: ${String(payload.iss ?? "(missing)")}, want ${LINE_ISSUER}`);
  }
  if (payload.aud !== channelId) {
    throw new Error(`unexpected aud: ${String(payload.aud ?? "(missing)")}, want ${channelId}`);
  }
  const now = Math.floor(Date.now() / 1000);
  if (typeof payload.exp !== "number" || payload.exp < now) {
    throw new Error(
      `id_token expired or missing exp: exp=${String(payload.exp ?? "(missing)")}, now=${now}`,
    );
  }
  if (typeof payload.iat !== "number" || payload.iat > now + 60) {
    throw new Error(
      `id_token iat in the future: iat=${String(payload.iat ?? "(missing)")}, now=${now}`,
    );
  }
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("id_token missing sub");
  }
  return {
    sub: payload.sub,
    iss: payload.iss,
    aud: payload.aud,
    exp: payload.exp,
    iat: payload.iat,
    name: typeof payload.name === "string" ? payload.name : undefined,
  };
}

function plain(body: string, status: number): NextResponse {
  return new NextResponse(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

export async function GET(request: NextRequest) {
  // ---- 1. Validate state (CSRF) ----
  const cookieStore = await cookies();
  const stateCookie = cookieStore.get(STATE_COOKIE)?.value ?? null;
  const stateParam = request.nextUrl.searchParams.get("state");
  if (!stateCookie || !stateParam || stateCookie !== stateParam) {
    return plain(
      `State mismatch.\n  cookie=${stateCookie ?? "(none)"}\n  param=${stateParam ?? "(none)"}`,
      400,
    );
  }
  cookieStore.delete(STATE_COOKIE);

  const oauthError = request.nextUrl.searchParams.get("error");
  if (oauthError) {
    const desc = request.nextUrl.searchParams.get("error_description") ?? "";
    return plain(`LINE returned error: ${oauthError}\n${desc}`, 400);
  }
  const code = request.nextUrl.searchParams.get("code");
  if (!code) {
    return plain("Missing ?code in callback URL", 400);
  }

  const channelId = process.env.LINE_CHANNEL_ID;
  const channelSecret = process.env.LINE_CHANNEL_SECRET;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!channelId || !channelSecret || !appUrl) {
    return plain(
      "Spike misconfigured: LINE_CHANNEL_ID / LINE_CHANNEL_SECRET / NEXT_PUBLIC_APP_URL missing.",
      500,
    );
  }

  // ---- 2. Exchange code at LINE's token endpoint ----
  const tokenBody = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: `${appUrl}/spikes/line-auth/callback`,
    client_id: channelId,
    client_secret: channelSecret,
  });

  let tokenResp: Response;
  try {
    tokenResp = await fetch(LINE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: tokenBody,
    });
  } catch (err) {
    return plain(
      `LINE token endpoint fetch failed: ${err instanceof Error ? err.message : String(err)}`,
      502,
    );
  }
  if (!tokenResp.ok) {
    const body = await tokenResp.text();
    return plain(`LINE token exchange returned ${tokenResp.status}:\n${body}`, 502);
  }
  const tokenJson = (await tokenResp.json()) as {
    id_token?: unknown;
    access_token?: unknown;
  };
  if (typeof tokenJson.id_token !== "string") {
    return plain(`LINE token response missing id_token: ${JSON.stringify(tokenJson)}`, 502);
  }

  // ---- 3. Verify HS256 id_token ----
  let claims: LineIdTokenClaims;
  try {
    claims = verifyLineIdToken(tokenJson.id_token, channelSecret, channelId);
  } catch (err) {
    return plain(
      `id_token verification failed: ${err instanceof Error ? err.message : String(err)}`,
      401,
    );
  }

  // ---- 4. Provision or locate auth.users (idempotent) ----
  const syntheticEmail = `line_${claims.sub}@line.local`;
  const admin = createAdminSupabase();
  const createResult = await admin.auth.admin.createUser({
    email: syntheticEmail,
    email_confirm: true,
    user_metadata: {
      provider: "line",
      line_sub: claims.sub,
      name: claims.name ?? null,
    },
  });
  if (createResult.error) {
    const code = createResult.error.code ?? "";
    const isDuplicate =
      code === "email_exists" ||
      code === "user_already_exists" ||
      createResult.error.message.toLowerCase().includes("already");
    if (!isDuplicate) {
      return plain(
        `admin.createUser failed: code=${code} message=${createResult.error.message}`,
        500,
      );
    }
    // Duplicate → user already provisioned from a prior login. Continue.
  }

  // ---- 5. Mint session: generateLink(magiclink) → verifyOtp(token_hash) ----
  const linkResult = await admin.auth.admin.generateLink({
    type: "magiclink",
    email: syntheticEmail,
  });
  if (linkResult.error) {
    return plain(
      `admin.generateLink failed: code=${linkResult.error.code ?? ""} message=${linkResult.error.message}`,
      500,
    );
  }
  const hashedToken = linkResult.data.properties?.hashed_token;
  if (!hashedToken) {
    return plain(
      `admin.generateLink returned no hashed_token: ${JSON.stringify(linkResult.data)}`,
      500,
    );
  }

  const supabase = await createServerSupabase();
  const verifyResult = await supabase.auth.verifyOtp({
    type: "magiclink",
    token_hash: hashedToken,
  });
  if (verifyResult.error || !verifyResult.data.session) {
    return plain(
      `verifyOtp failed: ${verifyResult.error?.message ?? "no session in response"}`,
      500,
    );
  }

  // ---- 6. Redirect to result page (session cookies attached by SSR client) ----
  const resultUrl = request.nextUrl.clone();
  resultUrl.pathname = "/spikes/line-auth/result";
  resultUrl.search = "";
  return NextResponse.redirect(resultUrl, { status: 302 });
}
