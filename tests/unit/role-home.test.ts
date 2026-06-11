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

import { roleHome } from "@/lib/auth/role-home";

describe("roleHome", () => {
  it("sends each served role to its real surface", () => {
    expect(roleHome("site_admin")).toBe("/sa");
    expect(roleHome("project_manager")).toBe("/pm");
    expect(roleHome("super_admin")).toBe("/pm");
  });

  it("sends unserved roles to /coming-soon", () => {
    expect(roleHome("visitor")).toBe("/coming-soon");
    expect(roleHome("procurement")).toBe("/coming-soon");
    expect(roleHome("technician")).toBe("/coming-soon");
  });
});
