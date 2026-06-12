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

export function roleHome(role: UserRole): string {
  if (role === "site_admin") return "/sa";
  // super_admin is admitted to every v1 surface (requireRole lists it
  // everywhere) and the bottom tab bar gives it the PM set (spec 19) —
  // so it lands on /pm, never /coming-soon.
  if (role === "project_manager" || role === "super_admin") return "/pm";
  return "/coming-soon";
}

// Spec 59: where "back" from a project page (the WP list) returns —
// the project hub the role entered from. Before this, the back chip
// was hardcoded to /sa, so a PM arriving via /pm/projects bounced to
// the SA home (the operator's "different page" report).
export function projectHubHref(role: UserRole): string {
  if (role === "site_admin") return "/sa";
  if (role === "project_manager" || role === "super_admin") return "/pm/projects";
  return roleHome(role);
}
