// Single source of truth for "where does this role go after login".
// Used by the LINE callback, /login, the homepage, and requireRole's
// not-allowed branch. Keep all role-based landing logic routed through here.

import type { Database } from "@/lib/db/database.types";

export type UserRole = Database["public"]["Enums"]["user_role"];

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
