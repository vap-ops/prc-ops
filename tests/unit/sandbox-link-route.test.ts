import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

// Spec 294 U2/U4: /auth/sandbox-link — sandbox-only login. MUST be inert (404)
// outside the sandbox deployment. U4 adds a preview-safe, reusable path: a bare
// GET renders a role picker (mints nothing), and a POST mints a session for the
// chosen persona — so a forwarded link survives chat-app link-preview crawlers
// that would otherwise consume a one-time token before the human clicks.

const envState: { NEXT_PUBLIC_APP_ENV?: string } = {};
const verifyOtp = vi.fn();
const generateLink = vi.fn();

vi.mock("@/lib/env", () => ({
  get clientEnv() {
    return envState;
  },
}));

vi.mock("@/lib/db/server", () => ({
  createClient: vi.fn(async () => ({ auth: { verifyOtp } })),
}));

vi.mock("@/lib/db/admin", () => ({
  createClient: () => ({ auth: { admin: { generateLink } } }),
}));

async function get(url: string) {
  const { GET } = await import("@/app/auth/sandbox-link/route");
  return GET(new NextRequest(url));
}

async function post(url: string, form: Record<string, string>) {
  const { POST } = await import("@/app/auth/sandbox-link/route");
  const body = new URLSearchParams(form);
  return POST(
    new NextRequest(url, {
      method: "POST",
      body,
      headers: { "content-type": "application/x-www-form-urlencoded" },
    }),
  );
}

beforeEach(() => {
  delete envState.NEXT_PUBLIC_APP_ENV;
  verifyOtp.mockReset();
  generateLink.mockReset();
  vi.resetModules();
});

describe("GET /auth/sandbox-link — token path (spec 294 U2)", () => {
  it("404s when NEXT_PUBLIC_APP_ENV is unset (prod-inert)", async () => {
    const res = await get("https://x.test/auth/sandbox-link?token_hash=abc");
    expect(res.status).toBe(404);
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it('404s when NEXT_PUBLIC_APP_ENV is "production"', async () => {
    envState.NEXT_PUBLIC_APP_ENV = "production";
    const res = await get("https://x.test/auth/sandbox-link?token_hash=abc");
    expect(res.status).toBe(404);
  });

  it("verifies the token and redirects to / on success", async () => {
    envState.NEXT_PUBLIC_APP_ENV = "sandbox";
    verifyOtp.mockResolvedValue({ error: null });
    const res = await get("https://x.test/auth/sandbox-link?token_hash=abc123");
    expect(verifyOtp).toHaveBeenCalledWith({ type: "email", token_hash: "abc123" });
    expect(res.headers.get("location")).toBe("https://x.test/");
  });

  it("redirects to /login when the token is invalid/expired", async () => {
    envState.NEXT_PUBLIC_APP_ENV = "sandbox";
    verifyOtp.mockResolvedValue({ error: { message: "expired" } });
    const res = await get("https://x.test/auth/sandbox-link?token_hash=stale");
    expect(res.headers.get("location")).toBe("https://x.test/login");
  });
});

describe("GET /auth/sandbox-link — picker (spec 294 U4, preview-safe)", () => {
  it("404s outside sandbox", async () => {
    const res = await get("https://x.test/auth/sandbox-link");
    expect(res.status).toBe(404);
  });

  it("bare GET renders an HTML role picker and mints NOTHING", async () => {
    envState.NEXT_PUBLIC_APP_ENV = "sandbox";
    const res = await get("https://x.test/auth/sandbox-link");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    // a button per known persona role
    expect(html).toContain("sa1");
    expect(html).toContain("admin");
    // crucially: a preview crawler hitting GET consumes no token
    expect(generateLink).not.toHaveBeenCalled();
    expect(verifyOtp).not.toHaveBeenCalled();
  });

  it("?as=<persona> renders a single-button confirm page, mints nothing", async () => {
    envState.NEXT_PUBLIC_APP_ENV = "sandbox";
    const res = await get("https://x.test/auth/sandbox-link?as=pm");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('value="pm"');
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("?as=<unknown> is 400 (not an allowlisted persona)", async () => {
    envState.NEXT_PUBLIC_APP_ENV = "sandbox";
    const res = await get("https://x.test/auth/sandbox-link?as=hacker");
    expect(res.status).toBe(400);
  });
});

describe("POST /auth/sandbox-link — mint on click (spec 294 U4)", () => {
  it("404s outside sandbox and mints nothing", async () => {
    const res = await post("https://x.test/auth/sandbox-link", { as: "sa1" });
    expect(res.status).toBe(404);
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("mints a magiclink for the persona then verifies it and redirects to /", async () => {
    envState.NEXT_PUBLIC_APP_ENV = "sandbox";
    generateLink.mockResolvedValue({
      data: { properties: { hashed_token: "MINTED" } },
      error: null,
    });
    verifyOtp.mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
    const res = await post("https://x.test/auth/sandbox-link", { as: "sa1" });
    // minted for the persona's real seed email, not an attacker-supplied one
    expect(generateLink).toHaveBeenCalledWith(
      expect.objectContaining({ type: "magiclink", email: "sandbox-sa1@prc-ops.test" }),
    );
    expect(verifyOtp).toHaveBeenCalledWith({ type: "magiclink", token_hash: "MINTED" });
    expect(res.headers.get("location")).toBe("https://x.test/");
  });

  it("rejects an unknown persona with 400 and never mints", async () => {
    envState.NEXT_PUBLIC_APP_ENV = "sandbox";
    const res = await post("https://x.test/auth/sandbox-link", { as: "root@evil.test" });
    expect(res.status).toBe(400);
    expect(generateLink).not.toHaveBeenCalled();
  });

  it("redirects to /login if minting fails", async () => {
    envState.NEXT_PUBLIC_APP_ENV = "sandbox";
    generateLink.mockResolvedValue({ data: { properties: null }, error: { message: "boom" } });
    const res = await post("https://x.test/auth/sandbox-link", { as: "sa1" });
    expect(res.headers.get("location")).toBe("https://x.test/login");
    expect(verifyOtp).not.toHaveBeenCalled();
  });
});
