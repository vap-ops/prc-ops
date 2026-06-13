// Single source of truth for "where does this role go after login".
// Used by the LINE callback, /login, the homepage, and requireRole's
// not-allowed branch. Keep all role-based landing logic routed through here.

import type { UserRole } from "@/lib/db/enums";

export type { UserRole };

// Spec 65: canonical role allowlists — the arrays every gate previously
// inlined. role-home.ts is the recorded role-doctrine home.

/** Review/back-office surfaces: PM and super_admin. */
export const PM_ROLES: ReadonlyArray<UserRole> = ["project_manager", "super_admin"];

/** All site staff: SA plus the PM set. */
export const SITE_STAFF_ROLES: ReadonlyArray<UserRole> = [
  "site_admin",
  "project_manager",
  "super_admin",
];

/**
 * Spec 70: who can reach the purchasing surface (/requests + /requests/[id]).
 * The v1 requester base (SITE_STAFF_ROLES) PLUS procurement — the back-office
 * processor onboarded onto the worklist. Deliberately NOT folded into
 * SITE_STAFF_ROLES: that set gates SA photo/WP screens procurement must not
 * reach. The record/ship RPCs and the suppliers/purchase_requests SELECT
 * policies already admit procurement; this is the page-gate counterpart.
 */
export const PURCHASING_ROLES: ReadonlyArray<UserRole> = [
  "site_admin",
  "project_manager",
  "super_admin",
  "procurement",
];

export function roleHome(role: UserRole): string {
  // Spec 82 Unit 3: site_admin lands on the folded content-named project hub
  // /projects (was /sa, before the two hubs merged).
  if (role === "site_admin") return "/projects";
  // super_admin is admitted to every v1 surface (requireRole lists it
  // everywhere) and the bottom tab bar gives it the PM set (spec 19) —
  // so it lands on /pm, never /coming-soon.
  if (role === "project_manager" || role === "super_admin") return "/pm";
  // Spec 70: procurement is onboarded onto the purchasing worklist.
  if (role === "procurement") return "/requests";
  return "/coming-soon";
}

// Spec 82 Unit 3: projectHubHref retired. The two project hubs folded into
// one /projects hub, so the WP-list back chip is the constant "/projects"
// for every role (used directly at the call site). The spec-59 role-aware
// helper — and the bug it patched (PM bounced to /sa) — are gone.
