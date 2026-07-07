// Spec 274 guardrail — logout must ALSO clear the assumed_role cookie, else a
// super_admin's "view as" survives sign-out onto the next (or a shared) session.

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

describe("POST /auth/logout", () => {
  it("signs out AND clears the assumed_role cookie, then 303-redirects home", async () => {
    const request = {
      nextUrl: { clone: () => new URL("https://app.example/auth/logout") },
    } as unknown as Parameters<typeof POST>[0];

    const res = await POST(request);

    expect(signOut).toHaveBeenCalledOnce();
    expect(mockClear).toHaveBeenCalledOnce();
    expect(res.status).toBe(303);
  });
});
