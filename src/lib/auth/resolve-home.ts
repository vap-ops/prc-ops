// Landing resolver — where a freshly-authed user goes. roleHome() is the pure,
// role-only home (the fallback). This adds the one DB-aware refinement the
// operator asked for: a site_admin "can't normally work on more than 1 project at
// a time", so a site_admin who belongs to exactly ONE project lands on that
// project (/projects/[id]) instead of the /sa daily home. 0 or many → /sa.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import type { UserRole } from "@/lib/db/enums";
import { roleHome } from "@/lib/auth/role-home";
import { projectHref } from "@/lib/nav/project-paths";

/** Pure: given the user's project ids, the landing path. */
export function resolveHomePath(role: UserRole, projectIds: string[]): string {
  if (role === "site_admin" && projectIds.length === 1) {
    return projectHref(projectIds[0]!);
  }
  return roleHome(role);
}

/**
 * Resolve the landing path for a user. Only a site_admin needs the membership
 * lookup (member ∪ project_lead = can_see_project's site_admin arm); every other
 * role short-circuits to roleHome with no query. Pass a client that can read the
 * user's memberships (the admin client, filtered by userId, is RLS-independent).
 */
export async function homePathForUser(
  client: SupabaseClient<Database>,
  role: UserRole,
  userId: string,
): Promise<string> {
  if (role !== "site_admin") return roleHome(role);
  const [{ data: mem }, { data: led }] = await Promise.all([
    client.from("project_members").select("project_id").eq("user_id", userId),
    client.from("projects").select("id").eq("project_lead_id", userId),
  ]);
  const ids = new Set<string>();
  for (const m of mem ?? []) ids.add(m.project_id);
  for (const l of led ?? []) ids.add(l.id);
  return resolveHomePath(role, [...ids]);
}
