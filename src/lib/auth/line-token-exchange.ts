// LINE code → verified id_token claims (ADR 0012 steps 2–3, extracted
// by spec 43 so the browser and handoff callback paths verify
// identically). The HS256 verifier itself is unchanged — see
// verify-line-id-token.ts and ADR 0012's safety section.

import { verifyLineIdToken, type LineIdTokenClaims } from "./verify-line-id-token";

const LINE_TOKEN_URL = "https://api.line.me/oauth2/v2.1/token";

export type LineExchangeResult =
  // accessToken (spec 318 U1): the USER's login access token, used by the
  // callback for the OA-friendship probe. null when LINE omits it — the
  // probe is skipped, login proceeds.
  | { ok: true; claims: LineIdTokenClaims; accessToken: string | null }
  | { ok: false; reason: string; detail?: string };

export async function exchangeLineCode(args: {
  code: string;
  redirectUri: string;
  channelId: string;
  channelSecret: string;
}): Promise<LineExchangeResult> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: args.code,
    redirect_uri: args.redirectUri,
    client_id: args.channelId,
    client_secret: args.channelSecret,
  });

  let response: Response;
  try {
    response = await fetch(LINE_TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (err) {
    return {
      ok: false,
      reason: "token_fetch_failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  if (!response.ok) {
    return {
      ok: false,
      reason: "token_exchange_failed",
      detail: `status ${response.status}: ${await response.text()}`,
    };
  }

  const json = (await response.json()) as { id_token?: unknown; access_token?: unknown };
  if (typeof json.id_token !== "string") {
    return { ok: false, reason: "missing_id_token" };
  }
  const accessToken = typeof json.access_token === "string" ? json.access_token : null;

  try {
    const claims = verifyLineIdToken(json.id_token, args.channelSecret, args.channelId);
    return { ok: true, claims, accessToken };
  } catch (err) {
    return {
      ok: false,
      reason: "id_token_invalid",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}
