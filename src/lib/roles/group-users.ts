// Feedback d00c3d0e — the role-admin list groups by ROLE instead of one long
// flat list. Visitors lead (the promotion queue is the screen's common task),
// then internal roles in tier order, external audiences (DC / client) last.
// Pure: the page maps DB rows to RoleUserVM and renders one section per group.

import { USER_ROLE_LABEL } from "@/lib/i18n/labels";
import type { UserRole } from "@/lib/db/enums";

/**
 * Canonical group order for the role-admin screen. Typed as a Record-backed
 * tuple over every user_role so adding an enum value without placing it here
 * is a TYPE error (and the paired test fails on drift).
 */
export const ROLE_GROUP_ORDER: readonly UserRole[] = [
  "visitor", // รอกำหนดสิทธิ์ — the promotion queue leads
  "super_admin",
  "project_director",
  "project_manager",
  "project_coordinator",
  "site_admin",
  "procurement",
  // Spec 261 / ADR 0070: the procurement dept manager, grouped next to procurement.
  "procurement_manager",
  "technician",
  // Spec 263 / ADR 0071: behavior-free forward-compat field roles, grouped with
  // the other not-yet-built internal roles.
  "site_owner",
  "auditor",
  "hr",
  "subcon_manager",
  "accounting",
  "contractor", // external — DC workforce
  "client", // external — read-only customer logins
];

export interface RoleGroup<T extends { name: string; role: UserRole }> {
  role: UserRole;
  label: string;
  users: T[];
}

export function groupUsersByRole<T extends { name: string; role: UserRole }>(
  users: readonly T[],
): RoleGroup<T>[] {
  return ROLE_GROUP_ORDER.map((role) => ({
    role,
    label: USER_ROLE_LABEL[role],
    users: users.filter((u) => u.role === role).sort((a, b) => a.name.localeCompare(b.name, "th")),
  })).filter((g) => g.users.length > 0);
}
