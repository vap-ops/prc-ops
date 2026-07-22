// src/lib/register/office-roles.ts
// Spec 342 U1.2 — the field/office partition of STAFF_ONBOARDABLE_ROLES,
// lifted from registration-decision.tsx (where both consts were module-private
// inside a "use client" component) so /settings/roles can mint invite links
// from the same SSOT. Pure — no DB, no client directive.
//
// invitedRoleFromHint: spec 342 D6 — declared_role_hint carries a role KEY for
// invited office applicants ("procurement") and free prose for legacy rows
// ("จัดซื้อ"). Anything that parses as an onboardable role is prefill-able;
// everything else is display-only prose. The DB-side approve guard admits 13
// roles (a superset) — this parse must use the NARROW onboardable set, never
// that list, or a hand-tampered link could prefill e.g. project_director.

import {
  STAFF_ONBOARDABLE_ROLES,
  isStaffOnboardableRole,
  type UserRole,
} from "@/lib/auth/role-home";

/** Spec 333 U2a grouping: the two roles approved for on-site work. */
export const FIELD_ROLE_OPTIONS: readonly UserRole[] = ["technician", "site_admin"];

/** The office group = every other onboardable role (operator-tunable via the
 * STAFF_ONBOARDABLE_ROLES SSOT — this derives, never restates). */
export const OFFICE_ROLE_OPTIONS: readonly UserRole[] = STAFF_ONBOARDABLE_ROLES.filter(
  (r) => !FIELD_ROLE_OPTIONS.includes(r),
);

/** Parse a declared_role_hint (or a ?role URL param — same trust level) into an
 * onboardable role, or null for prose/blank/garbage. */
export function invitedRoleFromHint(hint: string | null | undefined): UserRole | null {
  const trimmed = hint?.trim() ?? "";
  if (!trimmed) return null;
  return isStaffOnboardableRole(trimmed as UserRole) ? (trimmed as UserRole) : null;
}
