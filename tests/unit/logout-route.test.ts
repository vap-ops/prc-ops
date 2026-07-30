// Spec 274 guardrail — logout must ALSO clear the assumed_role cookie, else a
// super_admin's "view as" survives sign-out onto the next (or a shared) session.
//
// Spec 376 U4 — logout now accepts an OPTIONAL `?next` return path so the
// shared-phone register interstitial can send the borrowed session out and land
// the real applicant back on the SAME register door with its mint-once QR
// attribution params intact. `next` starts life as a query param, so it is an
// open-redirect vector: it must pass safeNextPath (the repo's single validator)
// and fall back to "/" — the historical destination — whenever it does not.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { signOut, mockClear } = vi.hoisted(() => ({
  signOut: vi.fn(),
  mockClear: vi.fn(),
}));

vi.mock("@/lib/db/server", () => ({
  createClient: async () => ({ auth: { signOut } }),
}));
vi.mock("@/lib/auth/assumed-role.server", () => ({
  clearAssumedRoleCookie: mockClear,
}));

import { POST } from "@/app/auth/logout/route";

beforeEach(() => {
  vi.clearAllMocks();
  signOut.mockResolvedValue({ error: null });
});

function requestFor(url: string): Parameters<typeof POST>[0] {
  return {
    nextUrl: { clone: () => new URL(url) },
  } as unknown as Parameters<typeof POST>[0];
}

describe("POST /auth/logout", () => {
  it("signs out AND clears the assumed_role cookie, then 303-redirects home", async () => {
    const res = await POST(requestFor("https://app.example/auth/logout"));

    expect(signOut).toHaveBeenCalledOnce();
    expect(mockClear).toHaveBeenCalledOnce();
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("https://app.example/");
  });

  it("honours a safe ?next — path AND query survive (spec 376 U4)", async () => {
    const next =
      "/register/technician?project=abc&site=%E0%B9%82%E0%B8%9E%E0%B8%98%E0%B8%B4%E0%B9%8C";
    const res = await POST(
      requestFor(`https://app.example/auth/logout?next=${encodeURIComponent(next)}`),
    );

    expect(signOut).toHaveBeenCalledOnce();
    expect(res.status).toBe(303);
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.origin).toBe("https://app.example");
    expect(location.pathname).toBe("/register/technician");
    expect(location.searchParams.get("project")).toBe("abc");
    expect(location.searchParams.get("site")).toBe("โพธิ์");
    // The `next` itself must never ride along into the destination.
    expect(location.searchParams.get("next")).toBeNull();
  });

  it("refuses an off-origin ?next and keeps the historical home landing", async () => {
    for (const hostile of ["https://evil.example/x", "//evil.example", "/\\evil.example"]) {
      signOut.mockClear();
      const res = await POST(
        requestFor(`https://app.example/auth/logout?next=${encodeURIComponent(hostile)}`),
      );
      expect(signOut).toHaveBeenCalledOnce();
      expect(res.headers.get("location")).toBe("https://app.example/");
    }
  });
});
