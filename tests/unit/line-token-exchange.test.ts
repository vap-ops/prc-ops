// Spec 43 — shared LINE token exchange (extracted from the callback so
// the browser and handoff paths verify identically; ADR 0041).

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from "vitest";

import { createHmac } from "node:crypto";
import { exchangeLineCode } from "@/lib/auth/line-token-exchange";

const SECRET = "test-secret";
const CHANNEL_ID = "test-channel-id";

function makeToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

const VALID_PAYLOAD = {
  iss: "https://access.line.me",
  aud: CHANNEL_ID,
  sub: "Uhandoff1",
  name: "สมชาย",
  exp: 9999999999,
  iat: 0,
};

const PARAMS = {
  code: "auth-code",
  redirectUri: "https://app.example.com/auth/line/callback",
  channelId: CHANNEL_ID,
  channelSecret: SECRET,
};

const fetchMock = vi.fn();

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("exchangeLineCode", () => {
  it("returns verified claims on a successful exchange", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id_token: makeToken(VALID_PAYLOAD) }), { status: 200 }),
    );
    const result = await exchangeLineCode(PARAMS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.claims.sub).toBe("Uhandoff1");
      expect(result.claims.name).toBe("สมชาย");
    }
    // POSTs the grant to LINE's token endpoint.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.line.me/oauth2/v2.1/token");
    const body = new URLSearchParams(init.body as string);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("redirect_uri")).toBe(PARAMS.redirectUri);
  });

  it("reports token_fetch_failed when the endpoint is unreachable", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    const result = await exchangeLineCode(PARAMS);
    expect(result).toMatchObject({ ok: false, reason: "token_fetch_failed" });
  });

  it("reports token_exchange_failed on a non-2xx response", async () => {
    fetchMock.mockResolvedValue(new Response("nope", { status: 400 }));
    const result = await exchangeLineCode(PARAMS);
    expect(result).toMatchObject({ ok: false, reason: "token_exchange_failed" });
  });

  it("reports missing_id_token when the response lacks id_token", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({}), { status: 200 }));
    const result = await exchangeLineCode(PARAMS);
    expect(result).toMatchObject({ ok: false, reason: "missing_id_token" });
  });

  it("reports id_token_invalid on a bad signature", async () => {
    const forged = makeToken(VALID_PAYLOAD).slice(0, -4) + "AAAA";
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ id_token: forged }), { status: 200 }),
    );
    const result = await exchangeLineCode(PARAMS);
    expect(result).toMatchObject({ ok: false, reason: "id_token_invalid" });
  });
});
