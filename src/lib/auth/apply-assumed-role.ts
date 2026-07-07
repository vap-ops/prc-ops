// Spec 274 U3 — apply the "view as role" override to a real role that an action
// site fetched inline (the ~30 server actions that read users.role directly
// instead of via requireActionRole). Each such site wraps its fetched role in
// this helper so a super_admin "viewing as" a narrower role is gated as that role
// on those writes too — the write-fidelity half of the feature.
//
// Behaviour-identical for every NON-super caller (resolveEffectiveRole returns the
// real role unless the caller is super_admin with a valid assumed_role cookie), so
// migrating a site can never change a real user's authorization. null/undefined
// (missing users row) passes through so the site's existing gate still denies.

import "server-only";

import type { UserRole } from "@/lib/db/enums";
import { resolveEffectiveRole } from "./effective-role";
import { readAssumedRoleCookie } from "./assumed-role.server";

// Overloads: a definite real role in → a definite effective role out (so call
// sites that already narrowed `me` don't re-widen to include null).
export async function applyAssumedRole(realRole: UserRole): Promise<UserRole>;
export async function applyAssumedRole(
  realRole: UserRole | null | undefined,
): Promise<UserRole | null | undefined>;
export async function applyAssumedRole(
  realRole: UserRole | null | undefined,
): Promise<UserRole | null | undefined> {
  if (!realRole) return realRole;
  return resolveEffectiveRole(realRole, await readAssumedRoleCookie());
}
