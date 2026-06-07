// Verify a LINE-issued HS256 id_token. Security boundary for LINE identity:
// review changes here with the same care as RLS policies. See ADR 0012.
//
// LINE signs ID tokens with HS256 (HMAC-SHA256, channel-secret-keyed). The
// verifier asserts `alg`, recomputes the signature with constant-time
// comparison, then validates `iss`, `aud`, `exp`, `iat`, and `sub`. Throws on
// any failure.

import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

const LINE_ISSUER = "https://access.line.me";
const CLOCK_SKEW_SECONDS = 60;

export interface LineIdTokenClaims {
  sub: string;
  name: string | null;
  picture: string | null;
}

interface RawJwtHeader {
  alg?: unknown;
  typ?: unknown;
}

interface RawJwtPayload {
  iss?: unknown;
  aud?: unknown;
  sub?: unknown;
  exp?: unknown;
  iat?: unknown;
  name?: unknown;
  picture?: unknown;
}

function decodeBase64UrlToUtf8(segment: string): string {
  return Buffer.from(segment, "base64url").toString("utf8");
}

export function verifyLineIdToken(
  token: string,
  channelSecret: string,
  channelId: string,
): LineIdTokenClaims {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error(`malformed id_token: expected 3 parts, got ${parts.length}`);
  }
  const [headerB64, payloadB64, signatureB64] = parts;
  if (!headerB64 || !payloadB64 || !signatureB64) {
    throw new Error("malformed id_token: empty segment");
  }

  const header = JSON.parse(decodeBase64UrlToUtf8(headerB64)) as RawJwtHeader;
  if (header.alg !== "HS256") {
    throw new Error(`unexpected alg: ${String(header.alg ?? "(missing)")}, want HS256`);
  }

  const expectedSignature = createHmac("sha256", channelSecret)
    .update(`${headerB64}.${payloadB64}`)
    .digest();
  const actualSignature = Buffer.from(signatureB64, "base64url");
  if (
    expectedSignature.length !== actualSignature.length ||
    !timingSafeEqual(expectedSignature, actualSignature)
  ) {
    throw new Error("id_token signature mismatch");
  }

  const payload = JSON.parse(decodeBase64UrlToUtf8(payloadB64)) as RawJwtPayload;
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
  if (typeof payload.iat !== "number" || payload.iat > now + CLOCK_SKEW_SECONDS) {
    throw new Error(
      `id_token iat in the future: iat=${String(payload.iat ?? "(missing)")}, now=${now}`,
    );
  }
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new Error("id_token missing sub");
  }
  return {
    sub: payload.sub,
    name: typeof payload.name === "string" && payload.name.length > 0 ? payload.name : null,
    picture:
      typeof payload.picture === "string" && payload.picture.length > 0 ? payload.picture : null,
  };
}
