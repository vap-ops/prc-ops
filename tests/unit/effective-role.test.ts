// Spec 274 U1 — super_admin "View as role" (ADR: TS-layer role override).
//
// resolveEffectiveRole is the SECURITY-CRITICAL core of the feature: it is the
// single place that decides whether the `assumed_role` cookie takes effect. It
// is a PURE function (real role + raw cookie value → effective role) so the
// whole contract is pinned here without mocking cookies or the DB.
//
// The contract this test pins:
//   - Override applies ONLY when the REAL role is super_admin (forge-guard: a
//     non-super user with a forged cookie gets ZERO effect).
//   - The assumed value must be in the ASSUMABLE_ROLES allowlist (served roles
//     with a real UI). super_admin itself, the unbuilt /coming-soon roles, and
//     any non-enum garbage are rejected → fall back to the real role.
//   - Absent / empty cookie → the real role, unchanged.

import { describe, expect, it } from "vitest";

import { ASSUMABLE_ROLES, isAssumableRole, resolveEffectiveRole } from "@/lib/auth/effective-role";

describe("ASSUMABLE_ROLES", () => {
  it("is exactly the served roles that have a real UI to view", () => {
    expect([...ASSUMABLE_ROLES]).toEqual([
      "site_admin",
      "project_manager",
      "project_director",
      "project_coordinator",
      "procurement",
      "procurement_manager",
      "accounting",
      "technician",
      "contractor",
      "client",
    ]);
  });

  it("EXCLUDES super_admin itself (no self-assume) and every unbuilt /coming-soon role", () => {
    for (const role of [
      "super_admin",
      "visitor",
      "hr",
      "subcon_manager",
      "site_owner",
      "auditor",
    ] as const) {
      expect(ASSUMABLE_ROLES).not.toContain(role);
    }
  });
});

describe("isAssumableRole", () => {
  it("is true for exactly the ASSUMABLE_ROLES set", () => {
    for (const role of ASSUMABLE_ROLES) expect(isAssumableRole(role)).toBe(true);
  });

  it("is false for excluded roles and for arbitrary non-enum strings", () => {
    for (const raw of ["super_admin", "visitor", "hr", "", "garbage", "site_ADMIN"]) {
      expect(isAssumableRole(raw)).toBe(false);
    }
  });
});

describe("resolveEffectiveRole — super_admin caller", () => {
  it("returns the assumed role when the cookie is a valid assumable role", () => {
    for (const role of ASSUMABLE_ROLES) {
      expect(resolveEffectiveRole("super_admin", role)).toBe(role);
    }
  });

  it("falls back to super_admin when the cookie is super_admin (not self-assumable)", () => {
    expect(resolveEffectiveRole("super_admin", "super_admin")).toBe("super_admin");
  });

  it("falls back to super_admin for an unbuilt /coming-soon role", () => {
    for (const role of ["visitor", "hr", "subcon_manager", "site_owner", "auditor"]) {
      expect(resolveEffectiveRole("super_admin", role)).toBe("super_admin");
    }
  });

  it("falls back to super_admin for garbage / absent / empty cookie values", () => {
    for (const raw of ["not_a_role", "", null, undefined]) {
      expect(resolveEffectiveRole("super_admin", raw)).toBe("super_admin");
    }
  });
});

describe("resolveEffectiveRole — forge-guard (non-super caller)", () => {
  it("IGNORES a forged cookie for every non-super real role (returns the real role)", () => {
    for (const realRole of [
      "site_admin",
      "project_manager",
      "project_director",
      "procurement",
      "procurement_manager",
      "accounting",
      "technician",
      "contractor",
      "client",
      "visitor",
    ] as const) {
      // Even a perfectly valid assumable value must have no effect for a non-super caller.
      expect(resolveEffectiveRole(realRole, "project_director")).toBe(realRole);
      expect(resolveEffectiveRole(realRole, "accounting")).toBe(realRole);
    }
  });
});
