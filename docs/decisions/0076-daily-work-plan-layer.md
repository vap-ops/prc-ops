# ADR 0076 — Daily work plan: a per-day operational layer distinct from the master schedule

**Status:** Proposed (design approved by operator 2026-07-06; build not started) · **Spec:**
[273](../feature-specs/273-sa-next-day-work-board.md)

## Context

The Site Admin (`site_admin`, ผู้ดูแลหน้างาน) runs the day-to-day of a project but has no surface for
the single most routine planning act in field construction: deciding, at the end of today, _what the
crew works tomorrow and who is on each task_. Everything the app offers is adjacent but wrong-shaped:

- **The master schedule.** Every งานย่อย carries `planned_start`/`planned_end` (spec 270; all 331
  leaves of PRC-2026-004 dated). But those dates are the _committed plan_ — the accountability
  substrate for spec 271 baselines/variance — and are editable **only** by PM/super/`site_owner` via
  `set_work_package_schedule` (the direct column-UPDATE grant was revoked, spec 271 U3). SA cannot
  touch them, and _should not_: churning the planned window every evening to mean "we'll work this
  tomorrow" would destroy the plan-vs-actual signal spec 271 exists to protect.
- **The spec-212 daily report** has a free-text `next_day_plan` field — prose, not an actionable,
  crew-bound list; nothing downstream consumes it.
- **Crew/assignment.** No per-day WP↔worker table exists. Labor is logged per (WP, worker, date) via
  `log_labor_day`; WP crew (`work_package_members`) is a static user-level list, not a daily,
  worker-level, task-scoped intent.

The operator wants SA to "design next day's WPs": pick tomorrow's งานย่อย, assign who's on each, as a
structured list that reduces tomorrow's data entry. During design the operator surfaced that crew
size flexes by งานย่อย (a big pour pulls many ช่าง; a tile leaf needs two) and that a fixed "team"
abstraction is not yet understood — so committing schema to a rigid team entity now would lock a model
they do not trust.

## Decision

1. **The daily work plan is its own layer, not an edit of the master schedule.** A new object keyed by
   (project, date) lists the งานย่อย intended for that day, each with a flexible crew. The master
   schedule (`planned_start`/`planned_end`) and spec-271 baselines are **never** written by this
   feature. Operational intent ("we'll push these tomorrow") and the committed plan ("these are the
   accountable dates") are separate concerns with separate authority.

2. **SA gains write authority on the daily plan only — nothing else.** SA (plus PM-tier and
   `site_owner`), scoped to project membership (`can_see_project`), may author/edit a project's daily
   plan. This grants **no** master-schedule date-editing power; that stays with PM/super/`site_owner`
   per spec 271. The separation in decision 1 is what makes the new SA authority safe: it cannot move
   an accountability anchor.

3. **Crew is a flexible per-leaf set of workers, one optionally marked หัวหน้า — not a team.** Each
   plan item holds zero-or-more `workers` rows; variable crew size is just row count. No `chang_teams`
   table is introduced in v1. Saved "ทีม" presets remain a future option that _seeds_ these crew rows,
   so adding them later requires no rework of stored data (see Consequences).

4. **The plan seeds, but does not replace, the source-of-truth records.** Next morning the plan's crew
   pre-loads the labor-logging UI so a present worker is one tap → the existing append-only
   `log_labor_day` still writes the labor row. The spec-212 report _renders_ the structured plan
   alongside its retained free-text `next_day_plan` field. The plan is disposable intent; labor,
   photos, schedule, and baselines remain the systems of record.

5. **Writes go through SECURITY DEFINER RPCs, reads via membership RLS.** Consistent with the house
   pattern for SA writes (`log_labor_day`, `set_work_package_schedule`): no broad DML grant to
   `authenticated`; RPCs centralize the role gate + guards (leaf-only, same-project, ≤1 lead per item,
   membership). This is low-stakes, non-money operational data — no `audit_log` write required, and
   plan rows are mutable (not append-only), unlike evidence tables.

## Consequences

- **Zero blast radius on spec 271.** Variance/baselines read only master-schedule dates and evidence;
  the daily plan touches neither. The plan can be built and iterated before spec 271's later units
  ship, and does not perturb the 004 calibration pilot.
- **The unsettled team model is deferred, not blocked.** Because crew is stored as per-item worker
  rows, a future ทีม preset is a UI/seed convenience over the same rows — the operator learns what a
  crew _is_ from real usage instead of guessing schema now. (Superseding this ADR is unnecessary to
  add presets; a follow-up spec suffices.)
- **A new daily surface for SA** that also becomes the structured feed for the spec-212 report and a
  data-entry accelerator for labor logging — the "actionable" payoff the operator asked for.
- **New authority to review.** SA writing a new object is a role-scope expansion; the danger-path guard
  will hold the schema PR for operator merge (RLS/new-table/gate surface), as intended.
- **Not modeled in v1** (each a deliberate deferral, listed in the spec): saved team presets,
  auto carry-over of unfinished items, PM approval/sign-off of the plan, งาน-level (parent) planned
  dates.

Extends ADR 0074 (งาน/งานย่อย hierarchy — items bind to leaves) and ADR 0056 (project membership
visibility). Complements, and is deliberately walled off from, ADR 0075 (plan-vs-actual/baselines).
