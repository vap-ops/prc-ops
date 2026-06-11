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
