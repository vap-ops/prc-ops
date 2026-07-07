// Spec 65 §A — shared server-action auth gate. Replaces the 22 copy-pasted
// getUser + Thai not-signed-in blocks. Each action keeps its own return
// shape; this pins the helper contract and the canonical message.
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getUser, single, mockReadAssumedRoleCookie } = vi.hoisted(() => ({
  getUser: vi.fn(),
  single: vi.fn(),
  mockReadAssumedRoleCookie: vi.fn(),
}));

vi.mock("@/lib/db/server", () => ({
  createClient: async () => ({
    auth: { getUser },
    from: () => ({ select: () => ({ eq: () => ({ single }) }) }),
  }),
}));

// Spec 274 — requireActionRole reads the assumed_role cookie. Mock the reader;
// the real resolveEffectiveRole (forge-guard + allowlist) runs.
vi.mock("@/lib/auth/assumed-role.server", () => ({
  readAssumedRoleCookie: mockReadAssumedRoleCookie,
}));

import {
  NOT_SIGNED_IN,
  NOT_PERMITTED,
  getActionUser,
  requireActionRole,
} from "@/lib/auth/action-gate";
import { ACCOUNTING_ROLES, PM_ROLES } from "@/lib/auth/role-home";

beforeEach(() => {
  getUser.mockReset();
  single.mockReset();
  mockReadAssumedRoleCookie.mockReset();
  mockReadAssumedRoleCookie.mockResolvedValue(null);
});

describe("getActionUser", () => {
  it("returns null when there is no session user", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await getActionUser()).toBeNull();
  });

  it("returns null on an auth error", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "bad" } });
    expect(await getActionUser()).toBeNull();
  });

  it("returns the RLS-scoped client and the user when signed in", async () => {
    const user = { id: "11111111-1111-4111-8111-111111111111" };
    getUser.mockResolvedValue({ data: { user }, error: null });
    const result = await getActionUser();
    expect(result).not.toBeNull();
    expect(result?.user).toBe(user);
    expect(result?.supabase.auth.getUser).toBeDefined();
  });
});

describe("NOT_SIGNED_IN", () => {
  it("pins the canonical Thai message used across action modules", () => {
    expect(NOT_SIGNED_IN).toBe("ยังไม่ได้เข้าสู่ระบบ");
  });
});

// Spec 274 — "fully active": the assumed role gates ACTIONS too. requireActionRole
// checks the effective role (assumed IFF real is super_admin) against `allowed`.
describe("requireActionRole — super_admin View as role (spec 274)", () => {
  const USER = { id: "11111111-1111-4111-8111-111111111111" };

  function asRealRole(role: string) {
    getUser.mockResolvedValue({ data: { user: USER }, error: null });
    single.mockResolvedValue({ data: { role }, error: null });
  }

  it("without a cookie, a super_admin passes a PM-gated action normally", async () => {
    asRealRole("super_admin");
    const res = await requireActionRole(PM_ROLES);
    expect("auth" in res).toBe(true);
  });

  it("a super_admin assuming accounting PASSES an accounting-gated action", async () => {
    asRealRole("super_admin");
    mockReadAssumedRoleCookie.mockResolvedValue("accounting");
    const res = await requireActionRole(ACCOUNTING_ROLES);
    expect("auth" in res).toBe(true);
  });

  it("a super_admin assuming technician is DENIED a PM-gated action (loses access at the TS gate)", async () => {
    asRealRole("super_admin");
    mockReadAssumedRoleCookie.mockResolvedValue("technician");
    const res = await requireActionRole(PM_ROLES);
    expect(res).toEqual({ error: NOT_PERMITTED });
  });

  it("FORGE-GUARD: a non-super caller's forged cookie is inert (real role still gates)", async () => {
    asRealRole("procurement");
    mockReadAssumedRoleCookie.mockResolvedValue("super_admin"); // forged
    // procurement is not in PM_ROLES, and the forged super_admin cookie must not help.
    const res = await requireActionRole(PM_ROLES);
    expect(res).toEqual({ error: NOT_PERMITTED });
  });
});
