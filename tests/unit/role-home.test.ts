// Writing failing test first.
//
// roleHome is the single source of "where does this role land" — LINE
// callback, /login, /, /profile back-link, and /requests bare back-link
// all route through it. super_admin is admitted to every v1 surface
// (requireRole lists it everywhere), so its home must be a REAL surface,
// not /coming-soon — that mismatch was the operator-reported "weird
// navigation" (2026-06-11). /pm is the home because the bottom tab bar
// already gives super_admin the PM tab set (spec 19).

import { describe, expect, it } from "vitest";

import { PURCHASING_ROLES, roleHome } from "@/lib/auth/role-home";

describe("roleHome", () => {
  it("sends each served role to its real surface", () => {
    // Spec 82 Unit 3: site_admin lands on the folded content-named project
    // hub /projects (was the role-named /sa hub).
    expect(roleHome("site_admin")).toBe("/projects");
    expect(roleHome("project_manager")).toBe("/pm");
    expect(roleHome("super_admin")).toBe("/pm");
  });

  // Spec 70: procurement onboarding — its first real surface is the
  // /requests purchasing worklist, so it no longer bounces to /coming-soon.
  it("sends procurement to the purchasing worklist", () => {
    expect(roleHome("procurement")).toBe("/requests");
  });

  it("sends still-unserved roles to /coming-soon", () => {
    expect(roleHome("visitor")).toBe("/coming-soon");
    expect(roleHome("technician")).toBe("/coming-soon");
  });
});

// Spec 70: the canonical allowlist for the purchasing surface (/requests
// + /requests/[id]). The v1 requester base PLUS procurement, which reads
// and processes the worklist but is NOT site-staff (no SA photo/WP screens).
describe("PURCHASING_ROLES", () => {
  it("admits the requester base and procurement", () => {
    expect([...PURCHASING_ROLES].sort()).toEqual(
      ["procurement", "project_manager", "site_admin", "super_admin"].sort(),
    );
  });
});

// Spec 82 Unit 3: projectHubHref is RETIRED. The two project hubs (/sa,
// /pm/projects) folded into one /projects hub, so the WP-list back chip is
// a constant "/projects" for every role — the role-aware helper (spec 59)
// is no longer needed and the bug it patched (PM bounced to /sa) is
// structurally impossible.
