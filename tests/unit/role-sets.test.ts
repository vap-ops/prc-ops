// Spec 65 §A — canonical role allowlists, exported from role-home.ts (the
// recorded role-doctrine home). Replaces 3 local consts + ~11 inline arrays.
import { describe, expect, it } from "vitest";

import { PM_ROLES, SITE_STAFF_ROLES, roleHome } from "@/lib/auth/role-home";

describe("role sets", () => {
  it("PM_ROLES is exactly project_manager + super_admin", () => {
    expect([...PM_ROLES]).toEqual(["project_manager", "super_admin"]);
  });

  it("SITE_STAFF_ROLES is exactly site_admin + project_manager + super_admin", () => {
    expect([...SITE_STAFF_ROLES]).toEqual(["site_admin", "project_manager", "super_admin"]);
  });

  it("every PM role lands on /pm (consistency with roleHome)", () => {
    for (const role of PM_ROLES) expect(roleHome(role)).toBe("/pm");
  });
});
