// Spec 318 U1 — OA friendship probe. Called from the OAuth callback with
// the user's login access token; null = unknown (probe must never break
// login or degrade a stored flag).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchLineFriendFlag } from "@/lib/auth/line-friendship";

const fetchMock = vi.fn();

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

describe("fetchLineFriendFlag", () => {
  it("returns true when LINE reports friendFlag true", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ friendFlag: true }), { status: 200 }),
    );
    await expect(fetchLineFriendFlag("tok")).resolves.toBe(true);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.line.me/friendship/v1/status");
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    // Login hot path: the probe must carry a timeout so a hanging LINE API
    // degrades to null instead of stalling sign-in.
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns false when LINE reports friendFlag false", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ friendFlag: false }), { status: 200 }),
    );
    await expect(fetchLineFriendFlag("tok")).resolves.toBe(false);
  });

  it("returns null on a non-2xx response (never throws into login)", async () => {
    fetchMock.mockResolvedValue(new Response("unauthorized", { status: 401 }));
    await expect(fetchLineFriendFlag("tok")).resolves.toBeNull();
  });

  it("returns null on a network error", async () => {
    fetchMock.mockRejectedValue(new Error("network down"));
    await expect(fetchLineFriendFlag("tok")).resolves.toBeNull();
  });

  it("returns null on a malformed body", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ friendFlag: "yes" }), { status: 200 }),
    );
    await expect(fetchLineFriendFlag("tok")).resolves.toBeNull();
  });
});
