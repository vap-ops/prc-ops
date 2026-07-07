// Spec 274 — super_admin "View as role": the enter/exit server actions.
//
// These deliberately resolve the REAL role (getActionUser + a direct users
// SELECT), NOT the overridden effective role from requireActionRole. If they
// went through the override, a super_admin who had already assumed a narrower
// role would fail the super_admin check and be STUCK — unable to switch or exit.
// The real-role check is also the forge-guard: a non-super caller gets no effect.

"use server";

import { redirect } from "next/navigation";
import { getActionUser } from "@/lib/auth/action-gate";
import { roleHome } from "@/lib/auth/role-home";
import { isAssumableRole } from "@/lib/auth/effective-role";
import { setAssumedRoleCookie, clearAssumedRoleCookie } from "@/lib/auth/assumed-role.server";

/** True only when the CURRENT session's REAL role is super_admin (ignores any
 * assumed_role cookie). */
async function isRealSuperAdmin(): Promise<boolean> {
  const auth = await getActionUser();
  if (!auth) return false;
  const { data } = await auth.supabase.from("users").select("role").eq("id", auth.user.id).single();
  return data?.role === "super_admin";
}

/** Enter "view as": persist the assumed role and land on its home. Silent no-op
 * for a non-super caller or an unassumable role value. The optional FormData arg
 * lets this bind directly as a `<form action>` (via setAssumedRole.bind(null, r)). */
export async function setAssumedRole(role: string, _formData?: FormData): Promise<void> {
  if (!(await isRealSuperAdmin())) return;
  if (!isAssumableRole(role)) return;
  await setAssumedRoleCookie(role);
  redirect(roleHome(role));
}

/** Exit "view as": clear the cookie and return to the super_admin home. Must
 * always work for a real super_admin regardless of the currently-assumed role.
 * Takes the optional FormData so it binds directly as a `<form action>`. */
export async function clearAssumedRole(_formData?: FormData): Promise<void> {
  if (!(await isRealSuperAdmin())) return;
  await clearAssumedRoleCookie();
  redirect(roleHome("super_admin"));
}
