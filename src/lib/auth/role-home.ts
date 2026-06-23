// Single source of truth for "where does this role go after login".
// Used by the LINE callback, /login, the homepage, and requireRole's
// not-allowed branch. Keep all role-based landing logic routed through here.

import type { UserRole } from "@/lib/db/enums";

export type { UserRole };

// Spec 65: canonical role allowlists — the arrays every gate previously
// inlined. role-home.ts is the recorded role-doctrine home.

/**
 * Review/back-office surfaces: PM and super_admin.
 * Spec 152 / ADR 0058: project_director is a see-all project_manager — it joins
 * PM_ROLES and every set built on it (appended last to preserve order). The only
 * place it does NOT follow PM is visibility (see-all, in can_see_project), and
 * the operator-only super_admin-alone gates (which this array is not).
 */
export const PM_ROLES: ReadonlyArray<UserRole> = [
  "project_manager",
  "super_admin",
  "project_director",
];

/**
 * The single predicate for "manager-tier role" — PM_ROLES membership. Use this
 * instead of inlining `role === "project_manager" || role === "super_admin" ||
 * …` at call sites: one place updates when the manager set changes (spec 152
 * added project_director and had to touch ~9 inline sites — this removes that
 * drift surface). Accepts the loosely-typed role string the DB hands back too.
 */
export function isManagerRole(role: UserRole): boolean {
  return PM_ROLES.includes(role);
}

/** All site staff: SA plus the PM set. */
export const SITE_STAFF_ROLES: ReadonlyArray<UserRole> = [
  "site_admin",
  "project_manager",
  "super_admin",
  "project_director",
];

/**
 * Spec 171: who may OPEN the work-package detail screen — site staff PLUS
 * procurement. The operator wants procurement to raise a purchase request from
 * that screen "instead of the site admins", seeing it like a site admin but
 * read-only everywhere except the request. SITE_STAFF_ROLES gates write-capable
 * capture; procurement is admitted here as a READ-ONLY viewer (see
 * isReadOnlyWpViewer) — the page suppresses every write affordance for it except
 * the purchase-request form, and the WP-context SELECT + PR-insert RLS arms
 * (migration 20260780000000) back that. Kept distinct from PURCHASING_ROLES
 * (which gates /requests): the membership coincides today but the meaning differs.
 */
export const WP_DETAIL_ROLES: ReadonlyArray<UserRole> = [...SITE_STAFF_ROLES, "procurement"];

/**
 * Spec 171: on the WP detail screen, procurement is the read-only viewer — it may
 * read the WP context and raise a purchase request, but every other capture
 * (photos, labour, notes, contractor assignment, defect, site purchase) is shown
 * read-only / suppressed. Site staff keep full capability. The single predicate
 * the page branches on, so the read-only treatment lives in one place.
 */
export function isReadOnlyWpViewer(role: UserRole): boolean {
  return role === "procurement";
}

/**
 * Spec 101: back-office processors — the PM set PLUS procurement. Matches the
 * suppliers RLS write posture (pm/procurement/super) and the record/ship RPC
 * isBackOfficeRole gate. Gates the suppliers-master screen + supplier writes.
 * Deliberately excludes site_admin (a field role, not a supplier curator).
 */
export const BACK_OFFICE_ROLES: ReadonlyArray<UserRole> = [
  "project_manager",
  "super_admin",
  "procurement",
  "project_director",
];

/**
 * Spec 173 U2: who may open the project SCHEDULE (ตารางงาน, the read-only Gantt) —
 * site staff PLUS procurement. The operator gave procurement read-only project
 * visibility incl. the schedule; procurement is already a cross-project reader of
 * projects/WPs (and, after spec 173 U1, deliverables + dependencies), so the
 * schedule renders fully for it. project_coordinator is deliberately EXCLUDED
 * (spec 154: it can't follow the calendar chip — was a bounce). Same membership as
 * WP_DETAIL_ROLES today, but the meaning differs ("opens the schedule" vs "opens a
 * WP detail") — keep them separate per the role-doctrine convention.
 */
export const SCHEDULE_VIEW_ROLES: ReadonlyArray<UserRole> = [...SITE_STAFF_ROLES, "procurement"];

/**
 * Spec 172 Phase C / ADR 0062: who may reach /workers AND onboard DC workers —
 * the PM set PLUS procurement. The operator gave procurement full DC-onboarding
 * ownership: create/update/assign workers, issue portal invites, AND set the pay
 * rate. The `create_worker` / `update_worker` / `assign_worker_to_project` /
 * `create_worker_invite` / `set_worker_day_rate` definer RPCs admit procurement
 * (bank/tax/phone/day_rate are written through the definer, bypassing the
 * zero column-grant; reads stay admin-client behind this page gate). Members
 * coincide with BACK_OFFICE_ROLES today, but the meaning differs ("who onboards
 * DC workers", not "who curates contact master data") — keep them separate.
 */
export const WORKER_ROSTER_ROLES: ReadonlyArray<UserRole> = [...PM_ROLES, "procurement"];

/**
 * Spec 181: who may PLAN supply for a project — the PM set PLUS procurement. The
 * operator's flow is "PM plans → procurement compares prices → PD approves →
 * procurement purchases"; for the moment procurement also does the planning in
 * the PM's stead. Gates the /supply-plan page + (via the definer RPCs) the
 * create/add/remove/submit writes — procurement's arm carries NO membership gate
 * (it is cross-project, spec 171/172). Approve/reject stay PD/super (procurement
 * never approves its own plan). Members coincide with WORKER_ROSTER_ROLES today,
 * meaning differs ("who plans supply") — kept separate per the role-doctrine.
 */
export const SUPPLY_PLAN_ROLES: ReadonlyArray<UserRole> = [...PM_ROLES, "procurement"];

/**
 * Spec 70: who can reach the purchasing surface (/requests + /requests/[id]).
 * The v1 requester base (SITE_STAFF_ROLES) PLUS procurement — the back-office
 * processor onboarded onto the worklist. Deliberately NOT folded into
 * SITE_STAFF_ROLES: that set gates SA photo/WP screens procurement must not
 * reach. The record/ship RPCs and the suppliers/purchase_requests SELECT
 * policies already admit procurement; this is the page-gate counterpart.
 */
export const PURCHASING_ROLES: ReadonlyArray<UserRole> = [
  "site_admin",
  "project_manager",
  "super_admin",
  "procurement",
  "project_director",
];

/**
 * Spec 141 U5: who can reach /equipment AND record an equipment movement —
 * the exact U3 `equipment_movements` RLS audience (site staff physically move
 * gear, so site_admin is in; procurement is back office + also moves). The
 * page-gate + recordEquipmentMovement-gate counterpart of that policy. Registry
 * EDITING (create/update items, bootstrap categories/owners) stays
 * BACK_OFFICE_ROLES — a site_admin views + moves, it does not curate the
 * registry. Members coincide with PURCHASING_ROLES today, but the meaning
 * differs — keep them separate.
 */
export const EQUIPMENT_MOVE_ROLES: ReadonlyArray<UserRole> = [
  "site_admin",
  "project_manager",
  "super_admin",
  "procurement",
  "project_director",
];

/**
 * Spec 102: who may BROWSE projects read-only — site staff PLUS procurement
 * (it processes purchases against project/WP context). Gates the /projects hub
 * + /projects/[id] only; the capture-heavy WP detail + schedule stay
 * SITE_STAFF_ROLES (procurement gets a read-only WP list, never the capture
 * screen). Members happen to match PURCHASING_ROLES today, but the meaning
 * differs — keep them separate.
 */
export const PROJECT_VIEW_ROLES: ReadonlyArray<UserRole> = [
  "site_admin",
  "project_manager",
  "super_admin",
  "procurement",
  // Spec 143 U2 / ADR 0056: project_coordinator is the see-all oversight role.
  // RLS already lets it read every project (can_see_project); this admits it to
  // the browse surfaces (/projects + /projects/[id]).
  "project_coordinator",
  // Spec 152 / ADR 0058: project_director is also a see-all role (browses all).
  "project_director",
];

/**
 * Spec 149 U9: who may reach the read-only /accounting surface (trial balance,
 * reconciliation, P&L). Field roles never reach it (money, spec 46).
 *
 * Spec 166 (beta finance gating): tightened to the dedicated `accounting` role +
 * super_admin ONLY. project_manager / project_director were temporarily REMOVED
 * (they had read access via spec 152) because the GL numbers are provisional
 * until the accountant config (COA / WHT / PEAK, spec 149 U8) is finalized —
 * showing them to beta PMs risks "wrong numbers" confusion. REVERSAL post-config:
 * re-add "project_manager" + "project_director" here; the settings link and all
 * four /accounting route guards follow automatically.
 */
export const ACCOUNTING_ROLES: ReadonlyArray<UserRole> = ["accounting", "super_admin"];

export function roleHome(role: UserRole): string {
  // Spec 82 Unit 3: site_admin lands on the folded content-named project hub
  // /projects (was /sa, before the two hubs merged).
  if (role === "site_admin") return "/projects";
  // Spec 183 U2: the PM tier (pm / super_admin / project_director) lands on
  // ภาพรวม (/dashboard). The review queue moved off the tab bar into a dashboard
  // card (the รอตรวจ awareness card), so the dashboard is the home that shows the
  // pending-approval count immediately. /review stays a live route reached from
  // that card. (Was /review since spec 82 Unit 4; was the role-named /pm before.)
  if (isManagerRole(role)) return "/dashboard";
  // Spec 70: procurement is onboarded onto the purchasing worklist.
  if (role === "procurement") return "/requests";
  // Spec 143 U2 / ADR 0056: project_coordinator oversees all projects — its home
  // is the project hub (no longer bounced to /coming-soon).
  if (role === "project_coordinator") return "/projects";
  // Spec 130 / ADR 0051: external direct contractors land on the self-service
  // portal segment (hard-bounded from internal surfaces by middleware).
  if (role === "contractor") return "/portal";
  // Spec 149 U9: the accounting role is onboarded onto the read-only ledger surface.
  if (role === "accounting") return "/accounting";
  return "/coming-soon";
}

// Spec 82 Unit 3: projectHubHref retired. The two project hubs folded into
// one /projects hub, so the WP-list back chip is the constant "/projects"
// for every role (used directly at the call site). The spec-59 role-aware
// helper — and the bug it patched (PM bounced to /sa) — are gone.
