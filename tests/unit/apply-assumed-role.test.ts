// Spec 274 U3 — applyAssumedRole wraps an inline-fetched role with the view-as
// override. It must be identity for every non-super caller (so migrating an
// action site can't change a real user's authorization) and pass null/undefined
// through (a missing users row still fails the site's gate).

import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockReadAssumedRoleCookie } = vi.hoisted(() => ({ mockReadAssumedRoleCookie: vi.fn() }));

vi.mock("@/lib/auth/assumed-role.server", () => ({
  readAssumedRoleCookie: mockReadAssumedRoleCookie,
}));

import { applyAssumedRole } from "@/lib/auth/apply-assumed-role";

beforeEach(() => {
  vi.clearAllMocks();
  mockReadAssumedRoleCookie.mockResolvedValue(null);
});

describe("applyAssumedRole", () => {
  it("returns the assumed role for a super_admin with a valid cookie", async () => {
    mockReadAssumedRoleCookie.mockResolvedValue("accounting");
    expect(await applyAssumedRole("super_admin")).toBe("accounting");
  });

  it("returns super_admin unchanged with no cookie", async () => {
    expect(await applyAssumedRole("super_admin")).toBe("super_admin");
  });

  it("is IDENTITY for a non-super caller even with a forged cookie", async () => {
    mockReadAssumedRoleCookie.mockResolvedValue("super_admin");
    expect(await applyAssumedRole("procurement")).toBe("procurement");
    expect(await applyAssumedRole("project_manager")).toBe("project_manager");
  });

  it("passes null/undefined through (missing users row still fails the gate)", async () => {
    expect(await applyAssumedRole(null)).toBeNull();
    expect(await applyAssumedRole(undefined)).toBeUndefined();
  });
});
