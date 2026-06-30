// Writing failing test first.
//
// Spec 233 / ADR 0067 (D6): who may ISSUE or REVOKE a temporary client portal
// login is the director tier ONLY — project_director + super_admin. It is
// deliberately NOT PM_ROLES: that set also contains project_manager, and the
// operator scoped client access away from the PM. A client login is
// customer-facing; the PM does not grant it. This pins the membership so a
// future widen of PM_ROLES can never silently widen who issues a client login.

import { describe, expect, it } from "vitest";

import { CLIENT_ISSUER_ROLES } from "@/lib/auth/role-home";

describe("CLIENT_ISSUER_ROLES", () => {
  it("is the director tier only — PD + super, never PM", () => {
    expect([...CLIENT_ISSUER_ROLES].sort()).toEqual(["project_director", "super_admin"]);
    expect(CLIENT_ISSUER_ROLES).not.toContain("project_manager");
  });
});
