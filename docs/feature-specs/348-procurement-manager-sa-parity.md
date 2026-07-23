# Spec 348 — procurement_manager = site_admin superset (SA parity, see-all)

Status: 📝 SPEC — approved in chat 2026-07-23, build not started
Owner units: U1–U6 below
ADR: 0084 (this spec's companion, same PR)

## 1. The ask

Operator, 2026-07-23 (verbatim): "procurement manager needs all accesses that SA
can, she needs to explain to them how to use each feature."

The procurement manager trains and supports site admins. To teach a feature she
must reach it, see real data on it, and press its buttons herself. Today the
`procurement_manager` role is a full **procurement** superset (ADR 0070) but has
none of the SA field-capture tier.

Brainstorm 2026-07-23 locked two calls (both operator-selected):

1. **Full parity** — she can DO everything SA can, not view-as-only. A TS-layer
   lens without DB backing shows SA screens with empty lists and buttons that
   error (`can_see_project` = false for proc roles blocks every muster/team
   read) — useless for teaching, worse than nothing.
2. **See-all scope** — her SA powers cover ALL projects (like
   `project_director`'s visibility arm), not `project_members`-scoped. Matches
   her existing cross-project procurement posture; zero per-project setup before
   a training visit.

## 2. Principle (ADR 0084)

> `procurement_manager` = union(`procurement`, `site_admin`) + its existing
> manager-tier extras (destructive procurement authority, PR decide, staff
> approval), with **see-all** project visibility.

- **Role-level**, not per-user: any future procurement_manager inherits. That is
  how every grant in this app works (role sets + role arms), and it is accepted.
- **Directional**: SA gains nothing. Plain `procurement` gains nothing and stays
  the read-only WP viewer everywhere.
- **Money posture unchanged**: the SA↔money separation excludes site_admin FROM
  money surfaces; procurement_manager already holds the money side
  (payroll/PO/GL-adjacent). No new money exposure exists in this spec.
- **Widen to SA's arm, never past it**: each gate admits procurement_manager
  exactly where site_admin is admitted, under the same conditions. Where an arm
  deliberately EXCLUDES site_admin (e.g. `reopen_work_package_for_defect`'s
  `p_source='client'` arm is PM-tier-minus-SA, spec 337 U5b), parity means
  procurement_manager is excluded there too. SA parity is a ceiling, not a floor.

## 3. Live evidence (gate-checked 2026-07-23; re-verify at each build unit)

- `user_role` enum (live): visitor, site_admin, project_manager, super_admin,
  procurement, technician, hr, subcon_manager, project_coordinator, accounting,
  contractor, project_director, client, procurement_manager, site_owner,
  auditor, legal. No enum change in this spec.
- `can_see_project(p_project_id)` (live def): see-all arm =
  `('super_admin','project_coordinator','project_director')`; membership arm =
  `('project_manager','site_admin','site_owner','auditor')` via
  `project_members` or `projects.project_lead_id`. **Every other role → false**,
  including both procurement tiers.
- `is_site_staff(p_role)` (live def, IMMUTABLE):
  `('site_admin','project_manager','super_admin','project_director')`.
- Literal-gate inventory (live sweep 2026-07-23, fact-checked): **35 RLS
  policies** name `site_admin` — **30 in `public`, 5 in `storage.objects`**
  (`photos uploads by sa/pm/super`, `sa bank-capture uploads by site_admin`,
  and the expense/PO/PR attachment arms, each carrying a literal
  `'site_admin'::user_role`) — and **44 `public` functions** name `site_admin`
  in their body (42 dispositioned in §5 U3; the remaining 2 are deliberate
  no-touches recorded there). Numbers are point-in-time — the build unit
  re-runs the sweep and works from the fresh list, not this snapshot.
- TS SSOT `src/lib/auth/role-home.ts`: `SITE_STAFF_ROLES` =
  `[site_admin, project_manager, super_admin, project_director]`;
  `isReadOnlyWpViewer(role)` = true for `procurement` and
  `procurement_manager` (spec 171/261 — WP detail read-only for proc tiers;
  **this spec reverses it for procurement_manager only**, U4).
- Spec 274 view-as (`src/lib/auth/effective-role.ts`): assume is
  **super_admin-only** (`resolveEffectiveRole` forge-guard) with a single flat
  `ASSUMABLE_ROLES` list; TS-layer only — Postgres always sees the real role.
- `roleHome("procurement_manager")` = `/procurement` — unchanged by this spec.

## 4. What she gains (the SA tier, concretely)

Read/reach (U1+U2): `/sa` worklist home (as a page, not her home), `/dashboard`,
`/team` + roster + badges + poster, `/projects/:id/muster` cockpit,
team-map, site-team board, crew visibility, daily work plan, WP capture screens
in their full SA form, store screens, SA registrations surfaces, SA help hub.

Write (U3+U4): photo upload + markup, labor log, WP submit/resubmit for
approval, defect filing, contractor assign, site purchase (+use-now), store
receive/issue/return/count, muster open/scan/move/close, SA worker add
(+bank capture), site-issue report/resolve, equipment check in/out + movement,
contractor consent capture.

Teaching lens (U5): one tap flips her phone to render the app EXACTLY as a
site_admin sees it — nav, tabs, home, gates — with every button live because
the DB actually grants it (U1/U3), not a super_admin-style illusion.

## 5. Units

Sequencing: **U1 → U2 ship "see everything"** (one session). **U3 → U4 → U5
ship "do everything" + the lens.** U6 rides along. Every unit is danger-path
(auth/RLS/migrations) → operator-held merges throughout.

### U1 — DB read parity (migration)

- `can_see_project`: add `procurement_manager` to the **see-all arm**. This one
  function is the read gate for muster\_\* tables, crews/team surfaces, daily
  work plans, and every other `can_see_project`-scoped SELECT policy.
  Gate-check block (run at build): list consumers via
  `pg_policies where qual ilike '%can_see_project%'` + function bodies; confirm
  no consumer uses it as a WRITE gate that must stay narrower (spec 306 RPCs do
  their own role gates — those are U3, not U1).
- `is_site_staff()`: add `procurement_manager`. Gate-check every consumer the
  same way; any consumer where "site staff" must stay membership-scoped or
  SA-tier-exact gets an explicit carve-out DECISION in the build plan, not a
  silent inherit.
- Widen the remaining SELECT-policy literal arms that name `site_admin` but do
  not already admit `procurement_manager` (many "readable by staff" arms
  already do via procurement/back-office wording — DIFF each policy, touch only
  the ones that exclude her).
- `audit_log` reader arms: the SA-visible event allowlist policy
  (`audit_log select wp rework events`) admits procurement_manager wherever
  site_admin is admitted (memory: new-audit-event ⇒ reader-RLS rule).
- Migration hygiene: source every function/policy body from the LIVE DB, not a
  migration file; `drop policy`+`create policy` = REWRITE — preserve
  `(select …)` initplan wrappers (guard `40-rls-eval-once`); `revoke all … from
public, anon` on any touched function.
- pgTAP: RED-first per family; role-switch asserts (`_tap_buf` grant) proving
  procurement_manager NOW reads muster/team/plan rows AND plain `procurement`
  still cannot.

### U2 — TS read surfaces (code)

- `SITE_STAFF_ROLES` += `procurement_manager`, with a **consumer-by-consumer
  audit table** in the build plan: derived sets (`PROJECT_TEAM_STAFF_ROLES`,
  `WP_DETAIL_ROLES`, `RECEIVE_ROLES`, `SCHEDULE_VIEW_ROLES`,
  `DASHBOARD_VIEW_ROLES`) and every direct consumer (grep at HEAD). Sets that
  spread SITE_STAFF_ROLES and ALSO append a `procurement_manager` literal
  (WP_DETAIL / RECEIVE / SCHEDULE_VIEW) end up holding it twice — remove the
  now-redundant literal + its spec-261 comment so exact-array pins stay honest.
- Page gates with inline literals (`/sa`, `/team`\*, muster page, project store
  page, dashboard, sa/registrations, …) — sweep the full `site_admin` grep (88
  files at 2026-07-23 HEAD) and admit procurement_manager wherever the gate is
  SA-tier.
- Sets/gates that must NOT change: `CLIENT_ISSUER_ROLES`, `ACCOUNTING_ROLES`,
  `OFFICE_EXPENSE_FINANCE_ROLES`, `MONEY_VIEW_ROLES`, `PM_ROLES`,
  `STAFF_APPROVAL_ROLES` (already has her), team-add picker audience (see §6).
- Guard pins trip on purpose: `role-sets.test.ts`, nav-back-affordance buckets,
  `sa-help-honesty`, site-map — update deliberately, never by weakening.
- Prose gate-check: any help card / label describing who can do what on touched
  surfaces re-justified against the NEW behavior (doctrine §3).

### U3 — DB write parity (migration, the big one)

Widen each SA-admitting write gate to also admit `procurement_manager`, same
arm, same conditions. Inventory from the 2026-07-23 live sweep (re-sweep at
build; families grouped):

- WP lifecycle: `submit_work_package_for_approval`,
  `resubmit_work_package_evidence`, `reopen_work_package_for_defect` (SA arms
  only — the client-source arm stays PM-tier, spec 337 U5b),
  `set_work_package_contractor`. (`decide_work_package` appears in the sweep —
  expect site_admin named in a REFUSAL arm; parity must NOT admit her to
  decide beyond her existing PR_DECIDER surface. Verify at build.)
- Photos: `photo_logs` INSERT policy (`sa/pm/super`), `photo_markups` INSERT,
  `storage.objects` `photos uploads by sa/pm/super`.
- Labor: `log_labor_day`, `correct_labor_log`, `daily_work_plan_assert_writer`.
- Muster: `open_muster_team`, `muster_scan_in`, `muster_scan_out`,
  `set_muster_team_wps`, `move_muster_worker`, `close_muster_day`.
- Store/stock: `record_stock_in(_bulk)`, `issue_stock(_bulk)`,
  `return_stock_to_store`, `reverse_stock_issue`, `record_stock_count`,
  `confirm_stock_issue_on_behalf`, `divert_purchase_to_store`,
  `split_purchase_request_on_receipt` (`receive_po_lines` already admits proc).
- Site purchase: `record_site_purchase`, `site_purchase_use_now`.
- Workers/crew: `sa_add_project_worker`, `sa_add_project_worker_with_bank`,
  `sa_worker_bank_status`, `current_user_sa_visible_crew_ids`,
  `record_contractor_consent`, `contractors` INSERT/UPDATE policies,
  `storage.objects` `sa bank-capture uploads by site_admin`.
- Site issues: `report_site_issue`, `resolve_site_issue`.
- Equipment: `check_in_equipment`, `check_out_equipment`,
  `equipment_movements` INSERT policy.
- Misc from the sweep, disposition decided at build: `project_site_management`,
  `set_primary_project_for`, `can_see_staff_registration`,
  `purchase_requests`/`purchase_request_attachments` arms (mostly already
  admit proc), `approve_staff_registration` (already has her).
- Deliberate NO-TOUCHES (the other 2 of the 44, fact-checked live):
  `record_office_expense` — already admits procurement_manager (spec 310), no
  change; `record_wage_payment` — REFUSES site_admin (money surface,
  `is_back_office`-gated; she is already admitted via PAYROLL_ROLES) — SA
  parity must not touch it. Record both in the build sweep as dispositioned,
  not dropped.

Rules: membership-condition semantics — where SA's arm requires
`project_members`, procurement_manager's admission follows her see-all
visibility (mirror how `project_director` is treated in that same arm; decide
per-function at build with the live body in front of you). pgTAP RED-first per
family, BOTH directions (procurement_manager admitted · plain procurement still
refused · site_admin unchanged). Full `db:test` run (unpinned-red = queue
ejection lesson).

### U4 — WP detail full affordances (code)

- `isReadOnlyWpViewer(role)` → `role === "procurement"` only. Doc comment
  rewritten (it currently asserts proc_manager inherits the read-only view).
- Consumer audit: WP detail page + `load-detail.ts` + work-package-list
  suppressions — every affordance SA sees renders for her.
- Label/prose sweep: any copy stating "procurement sees read-only" or naming
  who can capture — re-justified (behaviour-change-labels rule). Pins both
  directions, mutation-checked.

### U5 — teaching lens (code)

- `effective-role.ts`: replace the flat super-only allowlist with a per-assumer
  map: `super_admin` → today's list (unchanged); `procurement_manager` →
  `["site_admin"]`. Forge-guard extends: any other real role → no effect;
  procurement_manager assuming anything but site_admin → no effect.
- Picker: surface the existing role-switch UI to procurement_manager (settings)
  with the one option; same audit line spec 274 emits.
- Security invariant REVERSED from spec 274's: for super_admin the lens is safe
  because real authority is TOP; for procurement_manager it is safe because
  real authority now EQUALS the SA set (U1/U3) — anything not widened fails
  closed at the DB. **U5 therefore ships strictly after U3.** Pinned by
  effective-role tests (assumer-map, forge-guard both directions).

### U6 — docs (rides with each unit)

- ADR 0084 (this PR) + `docs/decisions/README.md` row.
- Site-map + SA help cards re-audited where they name audiences (build-time,
  against components — prose-gate-check rule).
- `docs/automations.md`: n/a (no automatic behavior added).

## 6. Non-goals

- Plain `procurement` role: byte-for-byte unchanged everywhere.
- No enum change, no new role, no per-user flags.
- Team-add picker (`PROJECT_TEAM_STAFF_ROLES`) does NOT offer
  procurement_manager: under see-all, a `project_members` row for her is a
  no-op, and offering it would mislead (spec 330 doctrine). Revisit only if
  the scope call ever flips to membership.
- Her home, tabs, and procurement surfaces: unchanged (the lens provides the
  SA rendering when she wants it).
- No SA-side changes of any kind.

## 7. Accepted risks (operator-acknowledged via the two brainstorm calls)

- Cross-project field-capture write authority for the procurement_manager role
  — wider than any single SA (who is membership-scoped). Mitigations: audit
  trail attributes every write to her uid (spec 337 U1 actor attribution);
  danger-path merges keep every unit operator-held.
- Role-level grant: future procurement_manager hires inherit the full set on
  assignment. `STAFF_ONBOARDABLE_ROLES` already offers procurement_manager at
  approval — approvers should know it now carries the SA tier (ADR 0084 notes
  it; approver surface copy re-checked in U2's prose sweep).
- Sweep-completeness risk: a missed literal gate = a hole in parity that
  surfaces as a mid-demo error. Mitigation: build from FRESH live sweeps, not
  this spec's snapshot; pgTAP family coverage; final real-flow walk (§8).

## 8. Verification (final, after U5)

- pgTAP: full suite green (only tolerated pins), all 348-family files.
- Real-flow: her real account (or a role-switched probe user on prod) walks:
  `/sa` → open a WP → photo upload → labor log → muster open/scan/close on a
  test team → store receive/issue → site purchase → WP submit → lens flip to
  SA view and back. Zero 42501/empty-state surprises on SA surfaces.
- Fill-rate follow-up (~1 week): audit rows attributed to her uid on SA-tier
  actions exist ⇒ she is actually using it; zero rows ⇒ ask why (adoption
  check, doctrine fill-rate rule).

## 9. Open questions

- None blocking U1–U2. U3 per-function dispositions (the `decide_work_package`
  refusal arm, `project_site_management`, `set_primary_project_for`) are
  build-time decisions recorded in the build plan's gate-check blocks.
