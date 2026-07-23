// Spec 274 — super_admin "View as role" (ADR: TS-layer role override).
//
// The operator (super_admin) can render the whole app AS any other role — its
// nav, home, page gates, and (fully-active) its actions — while keeping their
// own auth identity and RLS. The mechanism is a single TS-layer override: an
// `assumed_role` cookie, re-interpreted here into the caller's *effective* role.
//
// IMPORTANT — this is a TS-layer re-interpretation only. Postgres never sees the
// cookie: RLS + SECURITY DEFINER RPCs resolve role via current_user_role() =
// `select role from users where id = auth.uid()`, and auth.uid() stays the
// super_admin. So this grants NO new privilege (super_admin is already top) and
// is a faithful *experience*, not a DB sandbox — writes execute with super_admin
// authority underneath. The audit of the assumed role is emitted in the TS layer.
//
// This module is intentionally PURE (no next/headers, not server-only) so both
// the server gates and the client role-picker can import the allowlist. The
// cookie I/O lives in ./assumed-role.server.

import type { UserRole } from "@/lib/db/enums";

/** The cookie that carries the currently-assumed role. Server-set, httpOnly. */
export const ASSUMED_ROLE_COOKIE = "assumed_role";

/**
 * The roles a super_admin may assume — the SERVED roles that have a real UI to
 * view. Deliberately EXCLUDES super_admin itself (no self-assume) and every
 * unbuilt /coming-soon role (visitor, hr, subcon_manager, site_owner, auditor):
 * assuming those would just park on the /coming-soon stub. Identity-scoped roles
 * (technician, contractor, client) ARE included — their pages render for the
 * super_admin but show a "no personal data in this view" placeholder, since the
 * self-scoped reads key on the super_admin's own (empty) records. Pinned by
 * effective-role.test.ts so any widen is a deliberate in/out decision.
 */
export const ASSUMABLE_ROLES: ReadonlyArray<UserRole> = [
  "site_admin",
  "project_manager",
  "project_director",
  "project_coordinator",
  "procurement",
  "procurement_manager",
  "accounting",
  "technician",
  "contractor",
  "client",
];

/**
 * Spec 348 U5 / ADR 0084 — the PER-ASSUMER view-as allowlist. Was a flat
 * "super_admin may assume anything in ASSUMABLE_ROLES"; now a map so a second
 * role can view-as a NARROWER role.
 *
 * SECURITY INVARIANT (load-bearing): a real role R may assume role A only if R's
 * real authority already ⊇ A's. Then assuming A grants NOTHING new — it only
 * RESTRICTS the TS experience to A's nav/home/gates — and every write still
 * executes under R's real authority at the DB (RLS + DEFINER RPCs resolve role
 * via auth.uid(), never the cookie). So the lens can never escalate; the worst a
 * bad map entry could do is show A's affordances that R's real role then refuses
 * at the DB (a broken experience, not a hole).
 *   - super_admin ⊇ every role → it keeps the full ASSUMABLE_ROLES list.
 *   - procurement_manager ⊇ site_admin (spec 348 U1–U4 made it a full site_admin
 *     superset) → it may assume site_admin, and ONLY site_admin. It is NOT ⊇
 *     project_manager / project_director / accounting / etc., so those are out.
 * Pinned by effective-role.test.ts; any new pair is a deliberate ⊇ decision.
 */
const VIEW_AS_MAP: Partial<Record<UserRole, ReadonlyArray<UserRole>>> = {
  super_admin: ASSUMABLE_ROLES,
  procurement_manager: ["site_admin"],
};

/** The roles this real role may view-as (empty for a non-assumer). Drives the picker. */
export function assumableRolesFor(realRole: UserRole): ReadonlyArray<UserRole> {
  return VIEW_AS_MAP[realRole] ?? [];
}

/** True if this real role may use view-as at all (has ≥1 assumable role). */
export function isViewAsAssumer(realRole: UserRole): boolean {
  return assumableRolesFor(realRole).length > 0;
}

/** True if this real role may assume this specific target role — a type guard, so
 * a passing `target` narrows to UserRole. The single gate the setter + resolver
 * share. */
export function canAssume(realRole: UserRole, target: string): target is UserRole {
  return (assumableRolesFor(realRole) as ReadonlyArray<string>).includes(target);
}

/**
 * The caller's EFFECTIVE role = the assumed role IFF the caller's REAL role may
 * assume that specific target (canAssume); otherwise the real role, unchanged.
 *
 * canAssume is the security boundary (the "forge-guard"): a non-assumer real role
 * has an empty allowlist, so a forged cookie gets ZERO effect; an assumer forging
 * a role OUTSIDE its allowlist (e.g. procurement_manager → project_director) also
 * gets zero effect. Re-evaluated on EVERY request that reads role — never cached
 * across identities. Pure by construction so callers can't skip it.
 */
export function resolveEffectiveRole(
  realRole: UserRole,
  assumedRaw: string | null | undefined,
): UserRole {
  if (assumedRaw && canAssume(realRole, assumedRaw)) return assumedRaw;
  return realRole;
}
