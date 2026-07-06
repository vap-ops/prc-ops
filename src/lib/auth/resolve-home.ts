// Landing resolver — where a freshly-authed user goes. Pure role-only:
// resolveHomePath === roleHome.
//
// History: an earlier refinement sent a single-project site_admin to that project
// (/projects/[id]) instead of /sa. Operator REVERTED it 2026-07-06 — /sa is now
// the SA daily home (งานของฉัน + แผนวันนี้ + the แผนพรุ่งนี้ board + one-tap มาทำ),
// so a single-project SA who landed on the bare project hub never discovered the
// board (spec 273). Landing no longer depends on membership, so no query is run.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/db/database.types";
import type { UserRole } from "@/lib/db/enums";
import { roleHome } from "@/lib/auth/role-home";

/** Pure: the landing path for a role (role-only since 2026-07-06). */
export function resolveHomePath(role: UserRole): string {
  return roleHome(role);
}

/**
 * Resolve the landing path for a user. Kept async + client-shaped for its callers
 * (the root dispatcher + the LINE callback) even though the membership lookup is
 * no longer needed — landing is role-only, so `client`/`userId` are unused.
 */
export async function homePathForUser(
  _client: SupabaseClient<Database>,
  role: UserRole,
  _userId: string,
): Promise<string> {
  return resolveHomePath(role);
}
