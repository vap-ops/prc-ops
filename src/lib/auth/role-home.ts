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

/**
 * Spec 261 / ADR 0070: manager-tier authority over procurement DESTRUCTIVE
 * actions — void a PO, void a PO charge, cancel an approved PR. = PM_ROLES
 * (project seniority, incl. project_director per ADR 0058) PLUS the new
 * `procurement_manager` dept role. Deliberately NOT plain `procurement`: item 1
 * tightens the void away from the whole create-audience (walks back spec 259).
 * NOTE: this is a SUPERSET of the project-manager tier (isManagerRole), not the
 * same set — it adds the procurement dept manager. Pinned so a future PM_ROLES
 * widen can't silently change who holds procurement-destructive authority.
 */
export const PROCUREMENT_MANAGER_ROLES: ReadonlyArray<UserRole> = [
  ...PM_ROLES,
  "procurement_manager",
];
export function isProcurementManagerTier(role: UserRole): boolean {
  return PROCUREMENT_MANAGER_ROLES.includes(role);
}

/**
 * Spec 286 (amends ADR 0070 item 3) — who may DECIDE a purchase request
 * (requested → approved | rejected). Was PM-tier only (isManagerRole); spec 286
 * delegates it to procurement_manager too, unconditionally in Phase 1 (a
 * super_admin-configurable amount cap is the deferred Phase 2). Kept a DISTINCT
 * named set from PROCUREMENT_MANAGER_ROLES ("members coincide, meaning differs":
 * this is "who decides a PR", that is "who holds procurement-destructive
 * authority"). Deliberately NOT a widen of isManagerRole — that gates /dashboard,
 * /review and money surfaces procurement_manager must not reach. The DB backs
 * this with the transition-scoped "purchase_requests decide by procurement_manager"
 * RLS policy (spec 286 U1); that policy gates role + old-state, while the exact
 * transition is app-enforced (the decision action pins .eq(status,'requested')).
 */
export const PR_DECIDER_ROLES: ReadonlyArray<UserRole> = [...PM_ROLES, "procurement_manager"];
export function isPurchaseDecider(role: UserRole): boolean {
  return PR_DECIDER_ROLES.includes(role);
}

/**
 * Spec 233 / ADR 0067: who may ISSUE or REVOKE a temporary client portal login —
 * project_director + super_admin ONLY. Deliberately NOT PM_ROLES: that set also
 * contains project_manager, and the operator scoped client access to the director
 * tier. A client login is customer-facing; the PM does not grant it. Pinned by
 * client-issuer-roles.test.ts so a future widen of PM_ROLES can never silently
 * widen who issues a client login.
 */
export const CLIENT_ISSUER_ROLES: ReadonlyArray<UserRole> = ["project_director", "super_admin"];

/** All site staff: SA plus the PM set. */
export const SITE_STAFF_ROLES: ReadonlyArray<UserRole> = [
  "site_admin",
  "project_manager",
  "super_admin",
  "project_director",
];

/**
 * Spec 330: the team-map staff ADD picker — every role whose project
 * visibility runs on a `project_members` row (the live `can_see_project`
 * membership arm covers project_manager, site_admin, site_owner, auditor)
 * plus the see-all seniors already in SITE_STAFF_ROLES. Adding a member of
 * these roles GRANTS project visibility — that is the feature. Roles outside
 * this set (procurement, accounting, …) stay out: membership is a no-op for
 * them (their access is per-table role arms), so offering them would only
 * mislead. Kept distinct from SITE_STAFF_ROLES ("who is site staff" vs "who
 * belongs on a project team").
 */
export const PROJECT_TEAM_STAFF_ROLES: ReadonlyArray<UserRole> = [
  ...SITE_STAFF_ROLES,
  "site_owner",
  "auditor",
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
export const WP_DETAIL_ROLES: ReadonlyArray<UserRole> = [
  ...SITE_STAFF_ROLES,
  "procurement",
  // Spec 261 / ADR 0070: procurement_manager inherits procurement's read-only WP view.
  "procurement_manager",
];

/**
 * Spec 208 Q3 (reverses spec 134 U8 / feedback 6fbcc039): who may RECEIVE a PO's
 * in-transit lines — the รับของ checklist — site staff PLUS procurement. Receiving
 * was deliberately site-only (the off-site team confirmed nothing); the operator
 * reopened it (2026-06-26) so procurement can receive on the site's behalf when
 * site staff are short. Mirrors the widened `receive_po_lines` RPC gate
 * (migration 20260813002700). Kept distinct from SITE_STAFF_ROLES, which still
 * gates field capture procurement must not reach. Members coincide with
 * WP_DETAIL_ROLES today, but the meaning differs ("who confirms PO arrival").
 */
export const RECEIVE_ROLES: ReadonlyArray<UserRole> = [
  ...SITE_STAFF_ROLES,
  "procurement",
  // Spec 261 / ADR 0070: procurement_manager receives on the site's behalf like procurement.
  "procurement_manager",
];

/**
 * Spec 171: on the WP detail screen, procurement is the read-only viewer — it may
 * read the WP context and raise a purchase request, but every other capture
 * (photos, labour, notes, contractor assignment, defect, site purchase) is shown
 * read-only / suppressed. Site staff keep full capability. The single predicate
 * the page branches on, so the read-only treatment lives in one place.
 */
export function isReadOnlyWpViewer(role: UserRole): boolean {
  // Spec 261 / ADR 0070: procurement_manager is a superset of procurement, so it
  // reaches the WP detail as the same read-only viewer (PR-raise only).
  return role === "procurement" || role === "procurement_manager";
}

/**
 * Spec 280 (ADR 0070 parity): who sees the PROCUREMENT worklist view on /requests
 * — the buyer surface (KPI hero, status-chip bands, supplier/project filters, the
 * dense grid + create-PO flow), as opposed to the requester's card list. Plain
 * procurement PLUS procurement_manager, which ADR 0070 makes a full-parity buyer.
 * The single predicate the page branches on. Deliberately distinct from
 * PROCUREMENT_MANAGER_ROLES (the DESTRUCTIVE-authority tier — PM set + procurement
 * manager, NOT plain procurement) and named for its own meaning even though its
 * membership coincides with isReadOnlyWpViewer today.
 */
export function isProcurementWorklist(role: UserRole): boolean {
  return role === "procurement" || role === "procurement_manager";
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
  // Spec 261 / ADR 0070: procurement_manager = superset of procurement (full parity).
  "procurement_manager",
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
export const SCHEDULE_VIEW_ROLES: ReadonlyArray<UserRole> = [
  ...SITE_STAFF_ROLES,
  "procurement",
  // Spec 261 / ADR 0070: procurement_manager reads the schedule like procurement.
  "procurement_manager",
];

/**
 * Spec 172 Phase C / ADR 0062: who may reach /workers AND onboard ช่าง —
 * the PM set PLUS procurement. The operator gave procurement full ช่าง-onboarding
 * ownership: create/update/assign workers, issue portal invites, AND set the pay
 * rate. The `create_worker` / `update_worker` / `assign_worker_to_project` /
 * `create_worker_invite` / `set_worker_day_rate` definer RPCs admit procurement
 * (bank/tax/phone/day_rate are written through the definer, bypassing the
 * zero column-grant; reads stay admin-client behind this page gate). Members
 * coincide with BACK_OFFICE_ROLES today, but the meaning differs ("who onboards
 * ช่าง", not "who curates contact master data") — keep them separate.
 */
export const WORKER_ROSTER_ROLES: ReadonlyArray<UserRole> = [
  ...PM_ROLES,
  "procurement",
  // Spec 261 / ADR 0070: procurement_manager owns ช่าง onboarding like procurement.
  "procurement_manager",
];

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
export const SUPPLY_PLAN_ROLES: ReadonlyArray<UserRole> = [
  ...PM_ROLES,
  "procurement",
  // Spec 261 / ADR 0070: procurement_manager plans supply like procurement (approve stays PD/super).
  "procurement_manager",
];

/**
 * Spec 187: who may reach the ค่าแรง (wage) payroll surface (/payroll) AND record wage
 * payments — the PM set PLUS procurement. The operator gave procurement
 * project-director parity here: it already owns ช่าง onboarding + the pay rate
 * (spec 172 Phase C), so it also sees the payroll roll-up and pays it. The
 * `record_wage_payment` definer admits procurement too (migration 20260811000000);
 * the page reads money via the admin client behind this gate. site_admin is
 * deliberately OUT (money surface, spec 46). Members coincide with
 * WORKER_ROSTER_ROLES / SUPPLY_PLAN_ROLES today, but the meaning differs ("who
 * sees + pays ค่าแรง payroll") — keep them separate per the role-doctrine convention.
 */
export const PAYROLL_ROLES: ReadonlyArray<UserRole> = [
  ...PM_ROLES,
  "procurement",
  // Spec 261 / ADR 0070: procurement_manager views + pays ค่าแรง payroll like procurement.
  "procurement_manager",
];

/**
 * Spec 252 — READ-scoped widenings for the accounting role (operator decision
 * 2026-07-03: Finance sees everything the PM sees, READ-ONLY). These gate pages
 * and money DISPLAY only — every write affordance and server action keeps
 * gating on the unwidened set (PAYROLL_ROLES / PM_ROLES), so membership here
 * can never open a write path.
 */
export const PAYROLL_VIEW_ROLES: ReadonlyArray<UserRole> = [...PAYROLL_ROLES, "accounting"];
export const DASHBOARD_VIEW_ROLES: ReadonlyArray<UserRole> = [...SITE_STAFF_ROLES, "accounting"];
export const MONEY_VIEW_ROLES: ReadonlyArray<UserRole> = [...PM_ROLES, "accounting"];

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
  // Spec 261 / ADR 0070: procurement_manager works the purchasing worklist like procurement.
  "procurement_manager",
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
  // Spec 261 / ADR 0070: procurement_manager records equipment movement like procurement.
  "procurement_manager",
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
  // Spec 261 / ADR 0070: procurement_manager browses projects like procurement.
  "procurement_manager",
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

/**
 * Spec 345: who VERIFIES/FLAGS money-event documents and runs the correction
 * paths (D4). Same membership as ACCOUNTING_ROLES today, but a DIFFERENT
 * meaning — review is a write authority and may diverge (e.g. a junior
 * accountant who reads registers but does not certify). New meaning → its own
 * set; never widen ACCOUNTING_ROLES for it.
 */
export const MONEY_REVIEW_ROLES: ReadonlyArray<UserRole> = ["accounting", "super_admin"];

/**
 * Spec 329: who can OPEN /settings/company-docs — read, download, and share-link
 * the firm's own papers (หนังสือรับรอง, ภ.พ.20, company profile). Wider than
 * BACK_OFFICE_ROLES on purpose (accounting + legal join); MANAGE (upload /
 * new version / retire) stays ACCOUNTING_ROLES. New meaning → its own set
 * (role doctrine), mirrored by the company_documents SELECT policy — keep in sync.
 */
export const COMPANY_DOC_VIEW_ROLES: ReadonlyArray<UserRole> = [
  ...BACK_OFFICE_ROLES,
  "accounting",
  "legal",
];

// Spec 310: non-WP office expenses. OFFICE_EXPENSE_ROLES may submit an expense +
// see their own; OFFICE_EXPENSE_FINANCE_ROLES additionally see every expense and
// mark it reimbursed. The DEFINER RPCs (record_office_expense /
// mark_expense_reimbursed) mirror these sets server-side — keep them in sync.
export const OFFICE_EXPENSE_ROLES: ReadonlyArray<UserRole> = [
  "super_admin",
  "procurement",
  "procurement_manager",
  "accounting",
  // Spec 310 U6 (operator 2026-07-13): PM/PD + site owner/admin + auditor also
  // record office expenses. They see their OWN; finance-see-all + mark stays
  // OFFICE_EXPENSE_FINANCE_ROLES. Keep the record_office_expense RPC gate in sync.
  "project_manager",
  "project_director",
  "site_owner",
  "site_admin",
  "auditor",
];
export const OFFICE_EXPENSE_FINANCE_ROLES: ReadonlyArray<UserRole> = ["super_admin", "accounting"];

// Spec 284 / ADR 0080: the Legal department's auth-role — the one new role the
// org-chart epic adds. Dept role + super_admin (mirrors ACCOUNTING_ROLES). Gates
// the Legal domain (contracts, document_approvals) in U3/U4. The Legal head is a
// field (departments.head_user_id), NOT a role — no legal_manager.
export const LEGAL_ROLES: ReadonlyArray<UserRole> = ["legal", "super_admin"];
// Who may act on document_approvals (U4). = LEGAL_ROLES in v1; named separately so
// it can widen (e.g. + a dedicated reviewer) without touching the Legal-domain gates.
export const DOC_APPROVAL_ROLES: ReadonlyArray<UserRole> = LEGAL_ROLES;

/**
 * Spec 211 U9b: who may OPEN the purchase-order detail (`/requests/orders/[poId]`).
 * = PURCHASING_ROLES PLUS `accounting`, so the accounting voucher's PO can be a
 * live link (an auditor drills from a voucher into the order behind it). Accounting
 * is read-only there — it sees the money (it is the money role) but the page's
 * write actions (manage deliveries / receive) stay gated out of it (those key on
 * isBackOfficeRole / RECEIVE_ROLES, neither of which admits accounting). Accounting
 * reads the PO via the admin client (its org-wide money posture, like the voucher),
 * so no RLS grant is needed. Kept distinct from PURCHASING_ROLES (the worklist
 * gate) per the "members coincide, meaning differs" doctrine.
 */
export const PO_DETAIL_VIEW_ROLES: ReadonlyArray<UserRole> = [...PURCHASING_ROLES, "accounting"];

/**
 * Spec 262 U2: who may reach the procurement report (`/requests/reports`) and
 * its CSV export — mirrors the `purchase_report` RPC's inline literal gate
 * (spec 262 U1 migration `20260813071100`) EXACTLY, so a future widen of
 * PURCHASING_ROLES or PM_ROLES can't silently open (or narrow) this money-read
 * surface out of step with the RPC it calls. Deliberately NOT PURCHASING_ROLES
 * (which admits site_admin, a field role with no reporting need) — a fresh set
 * per the role-doctrine convention. The by-purchaser slice within the report
 * additionally narrows to PROCUREMENT_MANAGER_ROLES (isProcurementManagerTier)
 * — enforced by the RPC itself, mirrored in the UI for defense-in-depth.
 */
export const PURCHASE_REPORT_ROLES: ReadonlyArray<UserRole> = [
  "procurement",
  "procurement_manager",
  "project_manager",
  "project_director",
  "super_admin",
  "accounting",
];

/**
 * Spec 263 U3 / spec 264 G4 / ADR 0072 §5 — who may approve/reject a staff
 * self-registration and assign the role: procurement_manager, project_director,
 * super_admin. Renamed from spec 263's `TECHNICIAN_APPROVAL_ROLES` (the flow is
 * now role-parametric staff onboarding, not technician-specific); membership is
 * UNCHANGED. Mirrors the `approve_staff_registration` / `reject_staff_registration`
 * RPCs' inline literal gate EXACTLY — a fresh explicit array, NOT PM_ROLES-derived
 * (unlike PROCUREMENT_MANAGER_ROLES), because plain `project_manager` is
 * deliberately excluded (mirrors CLIENT_ISSUER_ROLES' style: a small explicit set
 * narrower than PM_ROLES). `hr` is deliberately held out (stub role today — a
 * one-line add later, ADR 0072 §5). This is the SAME anti-drift concern
 * `isManagerRole`'s doc names: one place to update if the gate ever widens,
 * instead of the page gate and the server action drifting apart from each other
 * (the "payroll" gate/route mismatch this repo has hit before — spec 187/252, see
 * payroll-export-gate.test.ts) — the route gate here MUST equal the page gate.
 */
export const STAFF_APPROVAL_ROLES: ReadonlyArray<UserRole> = [
  "procurement_manager",
  "project_director",
  "super_admin",
];
export function isStaffApprover(role: UserRole): boolean {
  return STAFF_APPROVAL_ROLES.includes(role);
}

/**
 * Spec 264 G4 / ADR 0072 §4 — the UI-facing role-selector option list at
 * approval: the roles that genuinely make sense to self-onboard-and-approve.
 * The approver picks one of these; its value is passed as `p_role` to
 * `approve_staff_registration`, which re-guards it server-side against the DB's
 * defensive `STAFF_ASSIGNABLE_ROLES` allowlist regardless.
 *
 * This is the operator-tunable ONBOARD list, DELIBERATELY DISTINCT from (and
 * NARROWER than) the RPC's security allowlist. It excludes:
 *   - `site_owner` — a promotion path (ADR 0060), not a self-onboard target;
 *   - `auditor`, `subcon_manager` — special / external roles;
 *   - `project_manager` / `project_director` — senior appointments, assigned
 *     deliberately, not via the open self-serve queue;
 *   - and of course `visitor` / `contractor` / `client` / `super_admin`, which
 *     the RPC itself refuses.
 * `technician` is first — the common case and the current open entry link
 * (`/register/technician`) — so it is the selector's sensible default. `legal`
 * (spec 286 U2 / spec 284) is the Legal department's office role, onboardable
 * through the office door (`/register/office`) — added to the RPC's assignable
 * allowlist in the same unit's migration. This set is a starting point the
 * operator may tune; pinned by role-sets.test.ts so a widen (or a future enum
 * add) is a deliberate in/out decision, not a silent drift.
 */
export const STAFF_ONBOARDABLE_ROLES: ReadonlyArray<UserRole> = [
  "technician",
  "procurement",
  "procurement_manager",
  "accounting",
  "hr",
  "project_coordinator",
  "site_admin",
  "legal",
];
export function isStaffOnboardableRole(role: UserRole): boolean {
  return STAFF_ONBOARDABLE_ROLES.includes(role);
}

/**
 * Spec 291 U2: the external-facing / pre-role carve-out — a client viewer, a
 * contractor partner, or an unonboarded visitor. Every other role is an
 * internal employee. Kept as a small explicit set (not derived from the full
 * UserRole enum) so a future enum add defaults to "employee" rather than
 * needing an update here.
 */
export const EXTERNAL_ROLES: ReadonlyArray<UserRole> = ["client", "contractor", "visitor"];

/**
 * The single predicate for "internal employee" — the complement of
 * EXTERNAL_ROLES. Gates the /profile employee-ID card (spec 291 U2): it
 * renders only for staff, never for a client/contractor/visitor account.
 */
export function isEmployeeRole(role: UserRole): boolean {
  return !EXTERNAL_ROLES.includes(role);
}

export function roleHome(role: UserRole): string {
  // Spec 192 U4: site_admin lands on the daily home /sa — their not-done work
  // packages, one tap from the labor/photo/PR actions (the daily loop was buried
  // 3–4 taps deep under the project hub). The full project hub stays a bottom tab.
  // (Spec 82 had folded the old /sa into /projects; the field needs an
  // action-forward home, so /sa is revived as the worklist home.)
  if (role === "site_admin") return "/sa";
  // Spec 183 U2: the PM tier (pm / super_admin / project_director) lands on
  // ภาพรวม (/dashboard). The review queue moved off the tab bar into a dashboard
  // card (the รอตรวจ awareness card), so the dashboard is the home that shows the
  // pending-approval count immediately. /review stays a live route reached from
  // that card. (Was /review since spec 82 Unit 4; was the role-named /pm before.)
  if (isManagerRole(role)) return "/dashboard";
  // Spec 323 U3b (was spec 70's /requests worklist): the procurement tiers land
  // on the /procurement STR hub — the portfolio home (per-project status strip +
  // Scope/Time/Resources doors + the คำขอสมัคร nudge). /requests stays a live
  // route, one tap in via the ขอบเขต section.
  // Spec 261 / ADR 0070: procurement_manager shares procurement's home.
  if (role === "procurement" || role === "procurement_manager") return "/procurement";
  // Spec 143 U2 / ADR 0056: project_coordinator oversees all projects — its home
  // is the project hub (no longer bounced to /coming-soon).
  if (role === "project_coordinator") return "/projects";
  // Spec 130 / ADR 0051: external direct contractors land on the self-service
  // portal segment (hard-bounded from internal surfaces by middleware).
  if (role === "contractor") return "/portal";
  // Spec 149 U9: the accounting role is onboarded onto the read-only ledger surface.
  if (role === "accounting") return "/accounting";
  // Spec 284 U5 / ADR 0080: the Legal department role lands on its own /legal home
  // (contracts + the document-approval queue). U1 added the role but deferred the
  // landing (it fell through to /coming-soon); U5 flips it now the surfaces exist.
  if (role === "legal") return "/legal";
  // Spec 233 / ADR 0067: the external client lands on the read-only progress
  // portal. An expired/revoked client still has role 'client'; the /client page
  // gate sends it on to /client/access-ended (not /coming-soon).
  if (role === "client") return "/client";
  // Spec 264 G3 / ADR 0072 §8: an approved technician lands on the minimal
  // /technician home (e-card + approval status + assigned-WPs placeholder) — the
  // anti-dead-end landing that replaces the /coming-soon fall-through for the
  // technician journey. Every OTHER still-unbuilt role (hr, subcon_manager,
  // site_owner, auditor) keeps falling through to /coming-soon below.
  if (role === "technician") return "/technician";
  return "/coming-soon";
}

// Spec 82 Unit 3: projectHubHref retired. The two project hubs folded into
// one /projects hub, so the WP-list back chip is the constant "/projects"
// for every role (used directly at the call site). The spec-59 role-aware
// helper — and the bug it patched (PM bounced to /sa) — are gone.
