// src/lib/nav/projects-landing.ts — spec 313 U4 (D3): the SA's โครงการ tab keeps its
// static /projects href; the hub itself sends a site_admin straight to the current
// project's WP list. An SA belongs to one project at a time, so the hub was a
// guaranteed extra tap on the way to the only row that could matter.
// Spec 376 U5 (D2): the same holds for site_owner, so the predicate is now the
// named PROJECT_LANDING_ROLES set rather than a role literal.
//
// ?view=all is the explicit hub escape — every SA-facing link back INTO the hub must
// carry it or the redirect re-fires (loop-proofing, spec §6). Note the comparison is
// STRICT: any other value, including "" or "ALL", means "no escape requested" and the
// redirect still fires. A loose check here would turn a typo'd or truncated query
// string into a silent, unreachable hub.
import { projectHref } from "@/lib/nav/project-paths";
import type { UserRole } from "@/lib/db/enums";

/**
 * Spec 376 U5 (D2): who gets the direct-landing redirect at `/projects`. Was the
 * inline `role !== "site_admin"` literal; site_owner homes on the project world
 * and, like the SA, belongs to ONE site — so the hub is the same guaranteed extra
 * tap for it. Naming the set (rather than adding a second literal) is what makes
 * the ?view=all loop-proofing inheritable: the hub's chip/search hrefs and the
 * project-detail back chip all key off THIS array, so a member can never be added
 * to the redirect without also getting the escape.
 *
 * Deliberately NOT a role-home.ts export: this is nav BEHAVIOUR ("does /projects
 * redirect you"), not a privilege gate — membership here grants nothing. Page
 * admission is PROJECT_VIEW_ROLES, and projects-landing.test.ts pins that every
 * member of this set is in it (a redirect away from a hub you cannot open would
 * strand the ?view=all escape).
 */
export const PROJECT_LANDING_ROLES: ReadonlyArray<UserRole> = ["site_admin", "site_owner"];

export function saProjectsLandingTarget(args: {
  role: string;
  view: string | undefined;
  currentProjectId: string | null;
}): string | null {
  if (!(PROJECT_LANDING_ROLES as ReadonlyArray<string>).includes(args.role)) return null;
  if (args.view === "all") return null;
  if (!args.currentProjectId) return null;
  return projectHref(args.currentProjectId);
}
