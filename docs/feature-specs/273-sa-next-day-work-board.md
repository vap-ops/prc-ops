# Spec 273 — แผนพรุ่งนี้: the SA next-day work board

**Status:** 🎨 **DESIGN — approved by operator 2026-07-06; build not started.** Units U1–U3 each need
their own session per the one-PR-per-unit loop.
**ADR:** [0076-daily-work-plan-layer.md](../decisions/0076-daily-work-plan-layer.md)
**Origin:** operator directive 2026-07-06 — "Site Admin wants to be able to design next day's WPs."
Clarified through brainstorming to: a structured, crew-bound tomorrow list SA authors at end of day —
a **separate operational layer**, not an edit of the master schedule (which SA cannot and should not
touch — spec 271 owns those dates as accountability anchors).

## 1. Problem

SA (ผู้ดูแลหน้างาน) has no surface to plan the day. The routine act — "tomorrow the crew works these
งานย่อย, with these people" — has no home:

- The **master schedule** (`planned_start`/`planned_end` on every leaf) is the committed plan and the
  spec-271 variance/baseline substrate. Editable only by PM/super/`site_owner`
  (`set_work_package_schedule`; direct column grant revoked). SA is correctly locked out; rewriting
  those dates nightly to mean "we'll work this tomorrow" would wreck plan-vs-actual.
- The **spec-212 daily report** has a free-text `next_day_plan` — prose, not an actionable list, and
  nothing downstream consumes it.
- **No per-day crew.** Labor is logged per (WP, worker, date) after the fact; WP crew is a static
  user-level list. There's no "who's on this leaf tomorrow."

## 2. Decisions (operator-confirmed 2026-07-06, via brainstorming)

| #   | Decision                                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **"Design next day's WPs" = a structured, actionable tomorrow board**, not a free-text note and not brand-new WP authoring. SA selects from **existing** not-complete งานย่อย.                                                                                                            |
| D2  | **The board is a separate daily layer.** A new object keyed by (project, date). The master schedule (`planned_*`) and spec-271 baselines are **never written** by this feature. No baseline/variance impact. (ADR 0076 D1.)                                                               |
| D3  | **Crew is a flexible per-leaf set of workers**, one optionally marked **หัวหน้า**. Variable crew size (2 for tile, 8 for a pour) = row count. **No team entity in v1** — the operator is not yet settled on team structure; saved ทีม presets are a future seed-only layer (ADR 0076 D3). |
| D4  | **The board seeds tomorrow's labor entry.** Next morning `/sa` shows today's board as the worklist; each leaf's planned crew pre-loads a one-tap **มาทำ** that calls the existing append-only `log_labor_day`. The board does not replace labor/photos as source of truth.                |
| D5  | **SA gains write on the daily plan only** (plus PM-tier + `site_owner`), scoped to project membership. **No** master-schedule date authority (stays PM/super/`site_owner`). (ADR 0076 D2.)                                                                                                |
| D6  | **Spec-212 integration is additive.** The report **renders** the structured plan; its free-text `next_day_plan` field **stays** for extra notes. No change to the daily-report schema.                                                                                                    |
| D7  | **Writes via SECURITY DEFINER RPCs; reads via membership RLS.** No broad DML grant. Plan rows are **mutable** (not append-only) and **not** money/PII — no `audit_log` write. (ADR 0076 D5.)                                                                                              |
| D8  | **Deferred to v1 defaults (operator-confirmed):** no PM approval of the board · manual carry-over of unfinished items (no auto-roll) · no saved team presets · no งาน-level dates.                                                                                                        |

## 3. Data model (additive; build claims schema numbers `073600+`)

All three tables carry `id uuid pk default gen_random_uuid()` + `created_at timestamptz not null
default now()`. RLS enabled on all; SELECT policy = `can_see_project(project_id)` for SA/PM-tier/
super/`site_owner`. No table-wide INSERT/UPDATE/DELETE grant to `authenticated` — mutation is
RPC-only (§5).

1. **`daily_work_plans`** — `project_id uuid not null references projects(id)` · `plan_date date not
null` · `created_by uuid not null references users(id)` · `updated_at timestamptz not null default
now()` (set_updated_at trigger). **UNIQUE(project_id, plan_date)** — exactly one board per project
   per day. (A plan row is created lazily by the first add-item RPC call; see §5.)

2. **`daily_work_plan_items`** — `plan_id uuid not null references daily_work_plans(id) on delete
cascade` · `work_package_id uuid not null references work_packages(id)` · `note text null` ·
   `sort_order int not null default 0` · `updated_at`. **UNIQUE(plan_id, work_package_id)** — a leaf
   appears once per board. **Guards** (trigger, mirrors `wp_reject_group_binding`): the WP must be a
   **leaf** (`is_group = false`) and belong to the **same project** as the plan.

3. **`daily_work_plan_crew`** — `item_id uuid not null references daily_work_plan_items(id) on delete
cascade` · `worker_id uuid not null references workers(id)` · `is_lead boolean not null default
false`. **UNIQUE(item_id, worker_id)**. **Partial unique index** `where is_lead` on `item_id` — at
   most one หัวหน้า per item. (Optional guard: `worker_id` is assigned to the plan's project — deferred
   as a soft check; workers move, and a planned worker may not yet be reassigned. Decided at U1.)

No changes to `work_packages`, `labor_logs`, `daily_reports`, `plan_baselines`, or the schedule.

## 4. Surfaces & flow

- **`/sa` → แผนพรุ่งนี้ board** (new). Defaults to พรุ่งนี้ (Bangkok tz) on the SA's membership project
  (if SA holds multiple projects, pick project first — reuse the existing project picker). SA:
  - adds tomorrow's งานย่อย from the project's **not-complete leaves** (grouped by งาน; searchable);
  - per leaf: taps workers (any number) from the project roster, stars one **หัวหน้า**, adds a note,
    reorders (`sort_order`);
  - removes items/workers freely (mutable). No submit/approval step (D8).
- **`/sa` morning worklist.** On plan_date, `/sa` surfaces today's board as the day's worklist. Each
  leaf lists its planned crew with a one-tap **มาทำ** per worker (and a bulk "ทั้งหมดมาทำ") → calls the
  existing `log_labor_day(wp, worker, date, fraction)`. Photos/status via the existing WP flow. Labor
  rows are the source of truth; the board only pre-fills the tap targets.
- **Spec-212 daily report** for that project+date **renders** the structured plan (read-only list) next
  to the retained free-text `next_day_plan`.

## 5. Authority & RPCs (SECURITY DEFINER, house-pattern gates)

Gate for all mutations: `current_user_role() ∈ {site_admin, project_manager, project_director,
super_admin, site_owner}` **AND** `can_see_project(project_id)`. errcode-pinned (`42501` role,
`P0001` guard failures), matching `log_labor_day`/`set_work_package_schedule`.

- `add_daily_plan_item(p_project, p_date, p_wp)` → upserts the (project,date) plan row if absent, then
  inserts the item (enforces leaf + same-project). Returns item id.
- `remove_daily_plan_item(p_item)` · `set_daily_plan_item_note(p_item, p_note)` ·
  `reorder_daily_plan_items(p_plan, p_item_ids uuid[])`.
- `set_daily_plan_item_crew(p_item, p_worker_ids uuid[], p_lead uuid null)` — replaces the item's crew
  set in one call (delete-then-insert inside the definer), enforcing ≤1 lead. Idempotent.

Reads (board render, report render) go through the SELECT RLS via the normal server client — no RPC.

## 6. Labels (labels.ts SSOT — operator-confirms Thai terms before U1 merges)

`แผนพรุ่งนี้` (board title / next-day plan) · `หัวหน้า` (crew lead marker — or reuse an existing term if
one fits) · `มาทำ` / `ทั้งหมดมาทำ` (present → log labor) · `เพิ่มงานย่อย` (add leaf) · `แผนงานประจำวัน`
(daily work plan, entity name). Any new role-set constant lives beside the RPC gates in `role-home.ts`
(mirroring the gate exactly), consistent with spec 271 §6.

## 7. Units (one PR each; TDD; schema lane single-writer)

| Unit   | Lane   | Contents                                                                                                                                                                                                                  | Depends on |
| ------ | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **U1** | schema | 3 tables + RLS SELECT + leaf/same-project + one-lead guards + the 5 definer RPCs (§5) + labels.ts terms (operator-confirm pre-merge). pgTAP first (gates, guards, unique constraints). Claims `073600+` in `../LANES.md`. | —          |
| **U2** | code   | `/sa` แผนพรุ่งนี้ builder: add/remove leaves, crew multiselect + หัวหน้า star, note, reorder; project picker reuse; Bangkok-tz "พรุ่งนี้" default. vitest first (component + RPC-call wiring).                            | U1         |
| **U3** | code   | Morning worklist on `/sa` (today's board) + one-tap มาทำ pre-fill via `log_labor_day` + spec-212 report render of the structured plan. vitest first.                                                                      | U1 (, U2)  |

Every schema unit: pgTAP red first, migration applied via `db:push` (additive tier), danger-path guard
**HELD** for operator merge as designed. Every code unit: failing vitest first. All units re-check
`../LANES.md` before touching the schema lane.

## 8. Out of scope v1

Saved ทีม (crew) presets — future seed-only layer over `daily_work_plan_crew`, no data rework (ADR 0076)
· auto carry-over of unfinished board items to the next day (manual re-add in v1) · PM approval/sign-off
of the board · SA editing master-schedule dates (stays PM/super/`site_owner`, spec 271) · งาน-level
(parent) planned dates (270 §7 / 271 §9) · brand-new งานย่อย authoring from the board (leaf creation
stays in the WP flow) · equipment/material planning per day.

## 9. Open items

1. Thai label set §6 — operator confirmation gate before U1 merges.
2. `daily_work_plan_crew.worker_id` project-membership soft-guard — confirm at U1 whether to enforce
   (workers move; a planned worker may not be reassigned yet). Default: no hard guard v1.
3. Multi-project SA project-picker reuse — confirm the existing component fits the board header.
