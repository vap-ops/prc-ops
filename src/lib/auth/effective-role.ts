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

/** Narrows an arbitrary string (a raw cookie value) to an assumable role. */
export function isAssumableRole(raw: string): raw is UserRole {
  return (ASSUMABLE_ROLES as ReadonlyArray<string>).includes(raw);
}

/**
 * The caller's EFFECTIVE role = the assumed role IFF the REAL role is super_admin
 * AND the cookie value is a valid assumable role; otherwise the real role,
 * unchanged.
 *
 * The `realRole === "super_admin"` check is the security boundary (the
 * "forge-guard"): a non-super user who forges an `assumed_role` cookie gets ZERO
 * effect. This must be re-evaluated on EVERY request that reads role — never
 * cached across identities. Pure by construction so callers can't skip it.
 */
export function resolveEffectiveRole(
  realRole: UserRole,
  assumedRaw: string | null | undefined,
): UserRole {
  if (realRole !== "super_admin") return realRole;
  if (assumedRaw && isAssumableRole(assumedRaw)) return assumedRaw;
  return realRole;
}
