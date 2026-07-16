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
import type { UserRole } from "@/lib/db/enums";

describe("roleHome", () => {
  it("sends each served role to its real surface", () => {
    // Spec 192 U4: site_admin lands on the daily home /sa (revived as the
    // action-forward worklist home; the project hub stays a bottom tab).
    expect(roleHome("site_admin")).toBe("/sa");
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

  // Spec 264 G3 / ADR 0072 §8: the technician arm repoints from /coming-soon to
  // the new minimal /technician home (the anti-dead-end landing: e-card + status
  // + assigned-WPs placeholder). This is the ONLY arm G3 changes.
  it("sends a technician to the /technician home (spec 264 G3)", () => {
    expect(roleHome("technician")).toBe("/technician");
  });

  // Spec 264 G3 — the rest-unchanged guard. G3 touches ONLY the technician arm;
  // every other role's destination must be BYTE-IDENTICAL to before. This pins the
  // full roleHome table so any future edit to role-home.ts that moves ANOTHER
  // role's home fails here (the auth-surface protection this unit is careful of:
  // roleHome routes EVERY user, so a slip must not silently reroute anyone else).
  it("leaves every non-technician role's home byte-identical (rest-unchanged table)", () => {
    const EXPECTED: Record<UserRole, string> = {
      site_admin: "/sa",
      project_manager: "/dashboard",
      super_admin: "/dashboard",
      project_director: "/dashboard",
      project_coordinator: "/projects",
      // Spec 323 U3b: the procurement tiers land on the /procurement STR hub
      // (U3a built the surface; U3b flips the home + tabs).
      procurement: "/procurement",
      procurement_manager: "/procurement",
      contractor: "/portal",
      accounting: "/accounting",
      client: "/client",
      // The one arm G3 changes:
      technician: "/technician",
      // Still genuinely-unbuilt → the static /coming-soon page.
      visitor: "/coming-soon",
      hr: "/coming-soon",
      subcon_manager: "/coming-soon",
      site_owner: "/coming-soon",
      auditor: "/coming-soon",
      // Spec 284 U5 / ADR 0080: the `legal` role now lands on its own /legal home
      // (contracts + document-approval queue). U1 added the role but deferred the
      // landing (fell through to /coming-soon); U5 flips it now the surfaces exist.
      legal: "/legal",
    };
    for (const [role, home] of Object.entries(EXPECTED)) {
      expect(roleHome(role as UserRole)).toBe(home);
    }
  });

  // Spec 323 U3b (was spec 70's /requests worklist): procurement lands on the
  // /procurement STR hub — the U3a portfolio home (status strip + Scope/Time/
  // Resources doors). /requests stays a live route, one tap in via ขอบเขต.
  it("sends procurement to the /procurement STR hub", () => {
    expect(roleHome("procurement")).toBe("/procurement");
  });

  // Spec 261 / ADR 0070: procurement_manager shares procurement's home.
  it("sends procurement_manager to the /procurement STR hub", () => {
    expect(roleHome("procurement_manager")).toBe("/procurement");
  });

  it("sends still-unserved roles to /coming-soon", () => {
    expect(roleHome("visitor")).toBe("/coming-soon");
    // Spec 264 G3: technician is NO LONGER unserved — it lands on /technician
    // (asserted above). hr / subcon_manager remain genuinely-unbuilt.
    expect(roleHome("hr")).toBe("/coming-soon");
    expect(roleHome("subcon_manager")).toBe("/coming-soon");
    // Spec 263 / ADR 0071: site_owner + auditor ship behavior-free — no route,
    // no gate. They fall through roleHome to /coming-soon until their own specs.
    expect(roleHome("site_owner")).toBe("/coming-soon");
    expect(roleHome("auditor")).toBe("/coming-soon");
  });

  // Spec 130 / ADR 0051: external direct-contractor accounts land on the
  // self-service portal segment, never an internal surface.
  it("sends an external contractor to the portal", () => {
    expect(roleHome("contractor")).toBe("/portal");
  });

  // Spec 233 / ADR 0067: the external client lands on the read-only progress
  // portal. An expired/revoked client still has role 'client'; the /client page
  // gate forwards it to /client/access-ended — roleHome stays /client.
  it("routes client to /client", () => {
    expect(roleHome("client")).toBe("/client");
  });
});

// Spec 70: the canonical allowlist for the purchasing surface (/requests
// + /requests/[id]). The v1 requester base PLUS procurement, which reads
// and processes the worklist but is NOT site-staff (no SA photo/WP screens).
describe("PURCHASING_ROLES", () => {
  it("admits the requester base, procurement, and the director", () => {
    // Spec 152 / ADR 0058: project_director joins every PM-tier set.
    expect([...PURCHASING_ROLES].sort()).toEqual(
      [
        "procurement",
        // Spec 261 / ADR 0070: procurement_manager works the worklist like procurement.
        "procurement_manager",
        "project_director",
        "project_manager",
        "site_admin",
        "super_admin",
      ].sort(),
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
        "procurement_manager",
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
