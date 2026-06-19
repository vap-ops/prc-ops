// Spec 65 §A — canonical role allowlists, exported from role-home.ts (the
// recorded role-doctrine home). Replaces 3 local consts + ~11 inline arrays.
import { describe, expect, it } from "vitest";

import { PM_ROLES, SITE_STAFF_ROLES, isManagerRole, roleHome } from "@/lib/auth/role-home";

describe("role sets", () => {
  // Spec 152 / ADR 0058: project_director is a see-all project_manager — it
  // joins PM_ROLES (and every set built on it). Appended last so existing
  // order is preserved.
  it("PM_ROLES is project_manager + super_admin + project_director", () => {
    expect([...PM_ROLES]).toEqual(["project_manager", "super_admin", "project_director"]);
  });

  it("SITE_STAFF_ROLES is site_admin + the PM set", () => {
    expect([...SITE_STAFF_ROLES]).toEqual([
      "site_admin",
      "project_manager",
      "super_admin",
      "project_director",
    ]);
  });

  it("every PM role lands on /review (consistency with roleHome)", () => {
    // Spec 82 Unit 4: the review queue is content-named /review (was /pm).
    for (const role of PM_ROLES) expect(roleHome(role)).toBe("/review");
  });
});

// Spec 152 follow-up: isManagerRole is the single predicate for "manager-tier"
// (PM_ROLES membership). It replaces the inline `role === "project_manager" ||
// …` disjunctions scattered across page gates — one place to update when the
// manager set changes (kills the drift surface).
describe("isManagerRole", () => {
  it("is true for exactly the PM_ROLES set", () => {
    for (const role of PM_ROLES) expect(isManagerRole(role)).toBe(true);
  });

  it("is false for non-manager roles", () => {
    for (const role of [
      "site_admin",
      "procurement",
      "project_coordinator",
      "accounting",
      "visitor",
      "contractor",
    ] as const) {
      expect(isManagerRole(role)).toBe(false);
    }
  });
});
