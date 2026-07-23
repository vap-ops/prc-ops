// Spec 274 — super_admin "View as role": the enter/exit server actions.
//
// These deliberately resolve the REAL role (getActionUser + a direct users
// SELECT), NOT the overridden effective role from requireActionRole. If they
// went through the override, a super_admin who had already assumed a narrower
// role would fail the super_admin check and be STUCK — unable to switch or exit.
// The real-role check is also the forge-guard: a non-super caller gets no effect.

"use server";

import { redirect } from "next/navigation";
import type { UserRole } from "@/lib/db/enums";
import { getActionUser } from "@/lib/auth/action-gate";
import { roleHome } from "@/lib/auth/role-home";
import { canAssume, isViewAsAssumer } from "@/lib/auth/effective-role";
import { setAssumedRoleCookie, clearAssumedRoleCookie } from "@/lib/auth/assumed-role.server";

/** The CURRENT session's REAL role (ignores any assumed_role cookie), or null.
 * Spec 274/348: resolved directly, NOT via requireActionRole's effective role —
 * an assumer who has already assumed a narrower role must still be able to switch
 * or exit. This real-role read is also the forge-guard (canAssume below rejects a
 * non-assumer). */
async function getRealRole(): Promise<UserRole | null> {
  const auth = await getActionUser();
  if (!auth) return null;
  const { data } = await auth.supabase.from("users").select("role").eq("id", auth.user.id).single();
  return (data?.role as UserRole | undefined) ?? null;
}

/** Enter "view as": persist the assumed role and land on its home. Silent no-op
 * unless the caller's REAL role may assume that specific target (canAssume —
 * super_admin → any served role; procurement_manager → site_admin only). The
 * optional FormData arg lets this bind directly as a `<form action>`. */
export async function setAssumedRole(role: string, _formData?: FormData): Promise<void> {
  const realRole = await getRealRole();
  if (!realRole || !canAssume(realRole, role)) return;
  await setAssumedRoleCookie(role);
  redirect(roleHome(role));
}

/** Exit "view as": clear the cookie and return to the caller's OWN home. Works
 * for any real assumer regardless of the currently-assumed role. Takes the
 * optional FormData so it binds directly as a `<form action>`. */
export async function clearAssumedRole(_formData?: FormData): Promise<void> {
  const realRole = await getRealRole();
  if (!realRole || !isViewAsAssumer(realRole)) return;
  await clearAssumedRoleCookie();
  redirect(roleHome(realRole));
}
