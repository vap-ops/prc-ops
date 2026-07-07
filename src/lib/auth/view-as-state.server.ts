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
import { isAssumableRole } from "./effective-role";
import { readAssumedRoleCookie } from "./assumed-role.server";

/** The role a real super_admin is currently viewing-as, or null. */
export async function getActiveViewAs(): Promise<UserRole | null> {
  const raw = await readAssumedRoleCookie();
  if (!raw || !isAssumableRole(raw)) return null;

  // Cookie present → verify the REAL role is super_admin (forge-guard). A forged
  // cookie on a non-super session yields null (and is inert at the gates anyway).
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  if (!data) return null;
  const { data: row } = await supabase
    .from("users")
    .select("role")
    .eq("id", data.claims.sub)
    .maybeSingle();
  if (row?.role !== "super_admin") return null;

  return raw;
}
