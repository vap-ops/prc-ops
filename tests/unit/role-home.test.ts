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

import { projectHubHref, PURCHASING_ROLES, roleHome } from "@/lib/auth/role-home";

describe("roleHome", () => {
  it("sends each served role to its real surface", () => {
    expect(roleHome("site_admin")).toBe("/sa");
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

// Spec 59: the WP-list back-chip target — the round-trip "enter a
// project from your hub, back returns to THAT hub" (the operator's
// "pressing back takes user to a different page" defect).
describe("projectHubHref", () => {
  it("SA returns to the SA project list", () => {
    expect(projectHubHref("site_admin")).toBe("/sa");
  });

  it("PM and super_admin return to the PM project list", () => {
    expect(projectHubHref("project_manager")).toBe("/pm/projects");
    expect(projectHubHref("super_admin")).toBe("/pm/projects");
  });

  it("non-project roles fall back to their role home", () => {
    expect(projectHubHref("visitor")).toBe(roleHome("visitor"));
    expect(projectHubHref("technician")).toBe(roleHome("technician"));
  });
});
