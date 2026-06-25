// Shared server-action auth gate (spec 65). Replaces the getUser + not-signed-in
// block that was copy-pasted at the top of every server action. getActionUser owns
// the fetch-and-check; requireActionRole (spec 204) adds the role-set check that was
// itself being copy-pasted (periods/billings/retention). Callers keep their own
// return shapes and (where they differ) their own error strings.

import "server-only";

import type { User } from "@supabase/supabase-js";

import { createClient } from "@/lib/db/server";
import type { UserRole } from "@/lib/db/enums";

/** The canonical Thai "not signed in" action error. */
export const NOT_SIGNED_IN = "ยังไม่ได้เข้าสู่ระบบ";

/** The canonical Thai "no permission" action error. */
export const NOT_PERMITTED = "ไม่มีสิทธิ์ทำรายการนี้";

export interface ActionAuth {
  supabase: Awaited<ReturnType<typeof createClient>>;
  user: User;
}

/**
 * RLS-scoped client + session user for a server action, or null when the
 * caller is not signed in (auth error or no user — both null).
 */
export async function getActionUser(): Promise<ActionAuth | null> {
  const supabase = await createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return { supabase, user };
}

export type RoleGateResult = { auth: ActionAuth } | { error: string };

/**
 * getActionUser + the caller's own role (users RLS is read-self), admitting only
 * `allowed`. Returns the RLS-scoped auth, or an error string — NOT_SIGNED_IN when
 * there is no session, else `notPermitted` (callers pass their own generic to keep
 * their message). The SECURITY DEFINER RPCs gate again server-side; this is the
 * friendly early check + defense-in-depth, never the sole guard.
 */
export async function requireActionRole(
  allowed: readonly UserRole[],
  notPermitted: string = NOT_PERMITTED,
): Promise<RoleGateResult> {
  const auth = await getActionUser();
  if (!auth) return { error: NOT_SIGNED_IN };
  const { data } = await auth.supabase.from("users").select("role").eq("id", auth.user.id).single();
  const role = data?.role as UserRole | undefined;
  if (!role || !allowed.includes(role)) return { error: notPermitted };
  return { auth };
}
