// Spec 327 U1 — the procurement selection Server Actions (fresh-eyes finding:
// the forge-guard branch is security-relevant and must be covered). Mirrors
// current-project-actions.test.ts: the cookie I/O helpers are mocked; this file
// tests the ACTION logic — UUID gate → auth gate → RLS visibility re-check →
// cookie write → redirect targets. redirect() throws in Next, so the mock
// throws a sentinel carrying its target.

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockGetActionUser, mockSetCookie, mockClearCookie, mockRedirect, mockMaybeSingle } =
  vi.hoisted(() => ({
    mockGetActionUser: vi.fn(),
    mockSetCookie: vi.fn(),
    mockClearCookie: vi.fn(),
    mockRedirect: vi.fn((to: string) => {
      throw new Error(`REDIRECT:${to}`);
    }),
    mockMaybeSingle: vi.fn(),
  }));

vi.mock("@/lib/auth/action-gate", () => ({ getActionUser: mockGetActionUser }));
vi.mock("@/lib/purchasing/procurement-project.server", () => ({
  setProcurementProjectCookie: mockSetCookie,
  clearProcurementProjectCookie: mockClearCookie,
}));
vi.mock("next/navigation", () => ({ redirect: mockRedirect }));
vi.mock("server-only", () => ({}));

import { setProcurementProject, clearProcurementProject } from "@/app/procurement/actions";

const P1 = "11111111-1111-4111-8111-111111111111";

async function redirectTarget(run: () => Promise<void>): Promise<string> {
  try {
    await run();
  } catch (e) {
    const m = e instanceof Error ? /^REDIRECT:(.*)$/.exec(e.message) : null;
    if (m) return m[1]!;
    throw e;
  }
  throw new Error("expected a redirect");
}

function signedIn(visible: boolean) {
  mockMaybeSingle.mockResolvedValue({ data: visible ? { id: P1 } : null });
  const from = vi.fn(() => ({
    select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: mockMaybeSingle })) })),
  }));
  mockGetActionUser.mockResolvedValue({ user: { id: "u1" }, supabase: { from } });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("setProcurementProject", () => {
  it("sets the cookie and lands on ขอบเขต for a visible project", async () => {
    signedIn(true);
    const to = await redirectTarget(() => setProcurementProject(P1));
    expect(to).toBe("/procurement/scope");
    expect(mockSetCookie).toHaveBeenCalledWith(P1);
  });

  it("refuses a project outside the caller's RLS-visible list — forge guard, no cookie", async () => {
    signedIn(false);
    const to = await redirectTarget(() => setProcurementProject(P1));
    expect(to).toBe("/procurement");
    expect(mockSetCookie).not.toHaveBeenCalled();
  });

  it("rejects a malformed uuid before any read or auth call", async () => {
    const to = await redirectTarget(() => setProcurementProject("<script>"));
    expect(to).toBe("/procurement");
    expect(mockGetActionUser).not.toHaveBeenCalled();
    expect(mockSetCookie).not.toHaveBeenCalled();
  });

  it("bounces to the dashboard when not signed in, cookie untouched", async () => {
    mockGetActionUser.mockResolvedValue(null);
    const to = await redirectTarget(() => setProcurementProject(P1));
    expect(to).toBe("/procurement");
    expect(mockSetCookie).not.toHaveBeenCalled();
  });
});

describe("clearProcurementProject", () => {
  it("clears the cookie and lands on the dashboard", async () => {
    const to = await redirectTarget(() => clearProcurementProject());
    expect(to).toBe("/procurement");
    expect(mockClearCookie).toHaveBeenCalledTimes(1);
  });
});
