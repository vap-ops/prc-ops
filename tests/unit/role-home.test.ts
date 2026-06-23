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

import { PROJECT_VIEW_ROLES, PURCHASING_ROLES, roleHome } from "@/lib/auth/role-home";

describe("roleHome", () => {
  it("sends each served role to its real surface", () => {
    // Spec 82 Unit 3: site_admin lands on the folded content-named project
    // hub /projects (was the role-named /sa hub).
    expect(roleHome("site_admin")).toBe("/projects");
    // Spec 183 U2: the PM tier lands on ภาพรวม (/dashboard) — the review queue
    // moved off the tab bar into a dashboard card (was /review, was /pm).
    expect(roleHome("project_manager")).toBe("/dashboard");
    expect(roleHome("super_admin")).toBe("/dashboard");
    // Spec 143 U2 / ADR 0056: project_coordinator is a see-all oversight role —
    // its home is the project hub (was /coming-soon before it was enabled).
    expect(roleHome("project_coordinator")).toBe("/projects");
    // Spec 152 / ADR 0058: project_director is a see-all project_manager — it
    // shares the PM dashboard home.
    expect(roleHome("project_director")).toBe("/dashboard");
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

  // Spec 130 / ADR 0051: external direct-contractor accounts land on the
  // self-service portal segment, never an internal surface.
  it("sends an external contractor to the portal", () => {
    expect(roleHome("contractor")).toBe("/portal");
  });
});

// Spec 70: the canonical allowlist for the purchasing surface (/requests
// + /requests/[id]). The v1 requester base PLUS procurement, which reads
// and processes the worklist but is NOT site-staff (no SA photo/WP screens).
describe("PURCHASING_ROLES", () => {
  it("admits the requester base, procurement, and the director", () => {
    // Spec 152 / ADR 0058: project_director joins every PM-tier set.
    expect([...PURCHASING_ROLES].sort()).toEqual(
      ["procurement", "project_director", "project_manager", "site_admin", "super_admin"].sort(),
    );
  });
});

// Spec 143 U2 / ADR 0056: project browsing now admits project_coordinator (the
// see-all oversight role) alongside the existing site staff + procurement.
describe("PROJECT_VIEW_ROLES", () => {
  it("admits site staff, procurement, the coordinator, and the director", () => {
    // Spec 152 / ADR 0058: project_director browses every project (see-all).
    expect([...PROJECT_VIEW_ROLES].sort()).toEqual(
      [
        "procurement",
        "project_coordinator",
        "project_director",
        "project_manager",
        "site_admin",
        "super_admin",
      ].sort(),
    );
  });
});

// Spec 82 Unit 3: projectHubHref is RETIRED. The two project hubs (/sa,
// /pm/projects) folded into one /projects hub, so the WP-list back chip is
// a constant "/projects" for every role — the role-aware helper (spec 59)
// is no longer needed and the bug it patched (PM bounced to /sa) is
// structurally impossible.
