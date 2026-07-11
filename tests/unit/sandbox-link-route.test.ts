import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Spec 294 U2: /auth/sandbox-link — one-click login for minted sandbox
// magiclinks. MUST be inert (404) outside the sandbox deployment.

const envState: { NEXT_PUBLIC_APP_ENV?: string } = {};
const verifyOtp = vi.fn();

vi.mock("@/lib/env", () => ({
  get clientEnv() {
    return envState;
  },
}));

vi.mock("@/lib/db/server", () => ({
  createClient: vi.fn(async () => ({ auth: { verifyOtp } })),
}));

async function get(url: string) {
  const { GET } = await import("@/app/auth/sandbox-link/route");
  return GET(new NextRequest(url));
}

describe("GET /auth/sandbox-link (spec 294 U2)", () => {
  beforeEach(() => {
    delete envState.NEXT_PUBLIC_APP_ENV;
    verifyOtp.mockReset();
    vi.resetModules();
  });

  it("404s when NEXT_PUBLIC_APP_ENV is unset (prod-inert)", async () => {
    const res = await get("https://x.test/auth/sandbox-link?token_hash=abc");
    expect(res.status).toBe(404);
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('404s when NEXT_PUBLIC_APP_ENV is "production" (the enum accepts it)', async () => {
    envState.NEXT_PUBLIC_APP_ENV = "production";
    const res = await get("https://x.test/auth/sandbox-link?token_hash=abc");
    expect(res.status).toBe(404);
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("400s on missing token_hash", async () => {
    envState.NEXT_PUBLIC_APP_ENV = "sandbox";
    const res = await get("https://x.test/auth/sandbox-link");
    expect(res.status).toBe(400);
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("verifies the token and redirects to / on success", async () => {
    envState.NEXT_PUBLIC_APP_ENV = "sandbox";
    verifyOtp.mockResolvedValue({ error: null });
    const res = await get("https://x.test/auth/sandbox-link?token_hash=abc123");
    expect(verifyOtp).toHaveBeenCalledWith({ type: "email", token_hash: "abc123" });
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.status).toBeLessThan(400);
    expect(res.headers.get("location")).toBe("https://x.test/");
  });

  it("redirects to /login when the token is invalid/expired", async () => {
    envState.NEXT_PUBLIC_APP_ENV = "sandbox";
    verifyOtp.mockResolvedValue({ error: { message: "expired" } });
    const res = await get("https://x.test/auth/sandbox-link?token_hash=stale");
    expect(res.status).toBeGreaterThanOrEqual(300);
    expect(res.headers.get("location")).toBe("https://x.test/login");
  });
});
