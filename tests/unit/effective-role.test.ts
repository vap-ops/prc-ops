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

import {
  ASSUMABLE_ROLES,
  assumableRolesFor,
  canAssume,
  isViewAsAssumer,
  resolveEffectiveRole,
} from "@/lib/auth/effective-role";
import { USER_ROLE_LABEL } from "@/lib/i18n/labels";
import type { UserRole } from "@/lib/db/enums";

// The complete enum (USER_ROLE_LABEL is Record<UserRole> — an enum add trips its
// own exhaustiveness guard, so this stays complete without a hand-maintained list).
const ALL_ROLES = Object.keys(USER_ROLE_LABEL) as UserRole[];

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

// ── Spec 348 U5 / ADR 0084 — per-assumer view-as ──────────────────────────────
// procurement_manager is a full site_admin superset (spec 348 U1–U4), so it may
// view-as site_admin — and ONLY site_admin (it is NOT ⊇ any other role). The
// forge-guard now keys on canAssume, so a value outside a role's allowlist is
// inert even for an assumer.

describe("assumableRolesFor / isViewAsAssumer / canAssume", () => {
  it("super_admin may assume the full ASSUMABLE_ROLES list", () => {
    expect([...assumableRolesFor("super_admin")]).toEqual([...ASSUMABLE_ROLES]);
    expect(isViewAsAssumer("super_admin")).toBe(true);
  });

  it("procurement_manager may assume site_admin ONLY", () => {
    expect([...assumableRolesFor("procurement_manager")]).toEqual(["site_admin"]);
    expect(isViewAsAssumer("procurement_manager")).toBe(true);
    expect(canAssume("procurement_manager", "site_admin")).toBe(true);
    // NOT ⊇ these — she has no more authority than they do, so no view-as.
    for (const t of [
      "project_manager",
      "project_director",
      "accounting",
      "procurement",
      "super_admin",
    ]) {
      expect(canAssume("procurement_manager", t)).toBe(false);
    }
  });

  // EXHAUSTIVE over the whole user_role enum: the assumer set must be EXACTLY
  // super_admin + procurement_manager. Iterating ALL_ROLES (not a hand-typed
  // list) means adding a NEW assumer to VIEW_AS_MAP for ANY role — including the
  // easily-forgotten subcon_manager / legal — reds this test. Escalation guard:
  // a stray e.g. `legal → accounting` would surface here, not slip through.
  it("the assumer set is EXACTLY super_admin + procurement_manager (exhaustive)", () => {
    const assumers = ALL_ROLES.filter(isViewAsAssumer).sort();
    expect(assumers).toEqual(["procurement_manager", "super_admin"]);
    for (const role of ALL_ROLES) {
      if (role === "super_admin" || role === "procurement_manager") continue;
      expect(assumableRolesFor(role)).toHaveLength(0);
      expect(canAssume(role, "site_admin")).toBe(false);
      expect(canAssume(role, "accounting")).toBe(false);
    }
  });
});

describe("resolveEffectiveRole — procurement_manager assumer (spec 348 U5)", () => {
  it("resolves to site_admin when she assumes site_admin", () => {
    expect(resolveEffectiveRole("procurement_manager", "site_admin")).toBe("site_admin");
  });

  it("IGNORES any assumed value other than site_admin (forge-guard, returns her real role)", () => {
    for (const raw of [
      "project_manager",
      "project_director",
      "accounting",
      "procurement",
      "super_admin",
      "garbage",
      "",
      null,
      undefined,
    ]) {
      expect(resolveEffectiveRole("procurement_manager", raw)).toBe("procurement_manager");
    }
  });
});
