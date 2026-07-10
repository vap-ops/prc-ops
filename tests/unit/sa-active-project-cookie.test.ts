// Spec 292 U4 — the sa_active_project cookie posture. The transient view-override
// MUST be a SESSION cookie (no maxAge — it must not outlive the browser session and
// shadow the primary), httpOnly + secure + lax + path=/, mirroring assumed-role's
// cookie (spec 274). These helpers are the single source of that posture.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCookies, jarSet, jarDelete } = vi.hoisted(() => {
  const jarSet = vi.fn();
  const jarDelete = vi.fn();
  return {
    jarSet,
    jarDelete,
    mockCookies: vi.fn(async () => ({ set: jarSet, delete: jarDelete, get: vi.fn() })),
  };
});

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: mockCookies }));

import {
  setSaActiveProjectCookie,
  clearSaActiveProjectCookie,
  SA_ACTIVE_PROJECT_COOKIE,
} from "@/lib/sa/current-project.server";

beforeEach(() => vi.clearAllMocks());

describe("sa_active_project cookie helpers", () => {
  it("sets a SESSION cookie (no maxAge) with httpOnly/secure/lax/path=/", async () => {
    await setSaActiveProjectCookie("p1");
    expect(jarSet).toHaveBeenCalledTimes(1);
    const call = jarSet.mock.calls[0]!;
    expect(call[0]).toBe(SA_ACTIVE_PROJECT_COOKIE);
    expect(call[1]).toBe("p1");
    expect(call[2]).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
    });
    // A transient view must expire with the session — never a persisted lifetime.
    expect(call[2]).not.toHaveProperty("maxAge");
    expect(call[2]).not.toHaveProperty("expires");
  });

  it("clears the cookie by name", async () => {
    await clearSaActiveProjectCookie();
    expect(jarDelete).toHaveBeenCalledWith(SA_ACTIVE_PROJECT_COOKIE);
  });
});
