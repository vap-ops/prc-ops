// Tests for verifyLineIdToken — focuses on the `picture` claim added by
// ADR 0020, plus a minimal smoke-test for the existing sub/name parsing.

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { createHmac } from "node:crypto";
import { verifyLineIdToken } from "@/lib/auth/verify-line-id-token";

const SECRET = "test-secret";
const CHANNEL_ID = "test-channel";
const LINE_ISSUER = "https://access.line.me";

function makeToken(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", SECRET).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${sig}`;
}

const BASE_PAYLOAD = {
  iss: LINE_ISSUER,
  aud: CHANNEL_ID,
  sub: "Utest123",
  exp: 9999999999,
  iat: 0,
};

// Freeze Date.now so exp validation doesn't flake
beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
});
afterAll(() => {
  vi.useRealTimers();
});

describe("verifyLineIdToken — picture claim", () => {
  it("parses picture when present as a non-empty string", () => {
    const token = makeToken({ ...BASE_PAYLOAD, picture: "https://cdn/profile.jpg" });
    const claims = verifyLineIdToken(token, SECRET, CHANNEL_ID);
    expect(claims.picture).toBe("https://cdn/profile.jpg");
  });

  it("returns null for picture when absent from payload", () => {
    const token = makeToken({ ...BASE_PAYLOAD });
    const claims = verifyLineIdToken(token, SECRET, CHANNEL_ID);
    expect(claims.picture).toBeNull();
  });

  it("returns null for picture when it is null in payload", () => {
    const token = makeToken({ ...BASE_PAYLOAD, picture: null });
    const claims = verifyLineIdToken(token, SECRET, CHANNEL_ID);
    expect(claims.picture).toBeNull();
  });

  it("returns null for picture when it is not a string (number)", () => {
    const token = makeToken({ ...BASE_PAYLOAD, picture: 42 });
    const claims = verifyLineIdToken(token, SECRET, CHANNEL_ID);
    expect(claims.picture).toBeNull();
  });

  it("returns null for picture when it is an empty string", () => {
    const token = makeToken({ ...BASE_PAYLOAD, picture: "" });
    const claims = verifyLineIdToken(token, SECRET, CHANNEL_ID);
    expect(claims.picture).toBeNull();
  });
});

describe("verifyLineIdToken — sub and name (smoke)", () => {
  it("parses sub", () => {
    const token = makeToken({ ...BASE_PAYLOAD, name: "Alice" });
    const claims = verifyLineIdToken(token, SECRET, CHANNEL_ID);
    expect(claims.sub).toBe("Utest123");
  });

  it("parses name when present", () => {
    const token = makeToken({ ...BASE_PAYLOAD, name: "Alice" });
    const claims = verifyLineIdToken(token, SECRET, CHANNEL_ID);
    expect(claims.name).toBe("Alice");
  });

  it("returns null for name when absent", () => {
    const token = makeToken({ ...BASE_PAYLOAD });
    const claims = verifyLineIdToken(token, SECRET, CHANNEL_ID);
    expect(claims.name).toBeNull();
  });
});
