// Spec 274 U2 — "is this request a super_admin viewing-as another role, and if so
// which?" Drives the global exit banner and the identity-scoped placeholder.
//
// Deliberately reads the REAL role (getClaims + users SELECT), NOT the overridden
// effective role from loadUserContext — the banner is about the real identity.
// Cheap in the common case: the assumed_role cookie is absent for everyone except
// a super_admin mid-view-as, so the DB read only happens in that rare state.

import "server-only";

import { createClient } from "@/lib/db/server";
import type { UserRole } from "@/lib/db/enums";
import { canAssume } from "./effective-role";
import { readAssumedRoleCookie } from "./assumed-role.server";

/** The role the real assumer is currently viewing-as, or null. Spec 348 U5:
 * per-assumer — super_admin viewing any served role, or procurement_manager
 * viewing site_admin. */
export async function getActiveViewAs(): Promise<UserRole | null> {
  const raw = await readAssumedRoleCookie();
  if (!raw) return null;

  // Cookie present → verify the REAL role may assume THIS value (forge-guard). A
  // forged cookie on a session whose real role can't assume it yields null (and
  // is inert at the gates anyway — resolveEffectiveRole shares canAssume).
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data) return null;
  const { data: row } = await supabase
    .from("users")
    .select("role")
    .eq("id", data.claims.sub)
    .maybeSingle();
  const realRole = row?.role as UserRole | undefined;
  if (!realRole || !canAssume(realRole, raw)) return null;

  return raw;
}
