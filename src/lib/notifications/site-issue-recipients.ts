// Spec 277 P1a — recipient resolution for the serious-site-issue alert (ADR 0037).
//
// Operator-locked recipient set (2026-07-11): the issue's PROJECT PM (resolved
// project-scoped from the project lead + PM-tier members) PLUS the role-wide
// project_director + procurement_manager pools. resolveRecipients dedupes the
// two together and excludes the reporter; this module owns the PROJECT-PM half
// (the pure lead+member → PM filter) and names the role-wide pool.

import { PM_ROLES } from "@/lib/auth/role-home";
import type { UserRole } from "@/lib/db/enums";

// Role-wide alert pool: every project_director + procurement_manager receives a
// serious-issue alert regardless of project (no per-project PD/proc binding
// exists). The drainer reads users by these roles; resolveRecipients merges the
// result with the project PMs.
export const SITE_ISSUE_ALERT_ROLE_POOL: ReadonlyArray<UserRole> = [
  "project_director",
  "procurement_manager",
];

export interface ProjectPmInput {
  /** The project's single person-in-charge (projects.project_lead_id), or null. */
  leadId: string | null;
  /** project_members user ids for the issue's project. */
  memberIds: ReadonlyArray<string>;
  /** Resolved role for every lead/member id (absent id → treated as non-PM). */
  roleById: ReadonlyMap<string, UserRole>;
}

/**
 * The issue's project PMs: the lead and any members whose role is PM-tier
 * (PM_ROLES — project_manager / super_admin / project_director). A non-PM lead
 * or member (e.g. a site_admin on the team) is not a project PM. Deduped, order
 * stable (lead first, then members). Empty when the project has no PM at all —
 * the zero-PM case where only the role-wide pool is alerted.
 */
export function projectPmRecipients(input: ProjectPmInput): string[] {
  const isPm = (id: string): boolean => {
    const role = input.roleById.get(id);
    return role !== undefined && PM_ROLES.includes(role);
  };
  const ids: string[] = [];
  if (input.leadId !== null && isPm(input.leadId)) ids.push(input.leadId);
  for (const id of input.memberIds) {
    if (isPm(id)) ids.push(id);
  }
  return [...new Set(ids)];
}
