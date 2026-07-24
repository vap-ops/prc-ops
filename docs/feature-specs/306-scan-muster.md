# Spec 306 — Morning-talk scan check-in + team forming (muster v2)

**Status:** 🎨 DESIGN (brainstormed + approved by operator 2026-07-12; spec-doc-only PR — no build started).
**Type:** field attendance + team formation — the daily record of _which team worked on which WPs, with who in the team_, captured by QR scan at the physical morning talk.
**Class:** mixed — U1/U3/U4/U6 code-only; **U2 (new schema + RLS + RPCs) and U5 (labor_logs money derive) are danger-path ⇒ operator-merged**.
**Parent:** spec 279 self-gov onboarding (roster + badges' subjects) · spec 273 daily plan (`daily_work_plan_crew` pre-fill) · spec 271 plan-vs-actual (variance feed, U0 engine-bug fixes ride along) · supersedes the spec 277 P0 `MusterStrip` shape.

## The operator's idea (verbatim intent, 2026-07-12)

1. Tomorrow's plan already exists → **assign the team in the plan** as well.
2. Daily **morning talk**: all technicians line up behind their **WP Owner** (the หัวหน้า they work under). The **Site Owner announces which WPs each team works on today**.
3. **SA logs technicians in by scanning** — scan the lead's badge first (presence + opens the team), then scan each member's badge into the team. Each scan = timestamp + team membership + registration onto the team's cost.
4. One team on multiple WPs → **cost split evenly as a temporary fix** (per-WP precision wanted later, mechanism unknown yet).

Why this design is strong (and why we build it as stated):

- **Team forming = the lineup itself.** No crew-CRUD admin UI to adopt; membership is observed reality each morning, never stale config.
- **One gesture captures three facts:** presence (timestamped), team membership, team→WP assignment.
- **The SA holds the phone** — matches telemetry (SAs are the only real field app users; workers are largely phoneless).
- **Plan pre-fill gives spec 271 its variance feed for free** and finally gives the near-unused daily plan a reason to exist.

## Decisions locked during brainstorm (operator answers)

| Question                    | Decision                                                                                                                                                                                                                        |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Purpose                     | Team→WP + membership record; presence flows immediately; money is the destination (both presence-first AND money selected)                                                                                                      |
| What does SA scan?          | **Printed QR badge** per worker (laminated card; app prints)                                                                                                                                                                    |
| Check-out                   | **Evening scan too** (symmetric muster; in/out both timestamped; OT computable from hours)                                                                                                                                      |
| Plan coupling               | **Plan = pre-fill, scan = truth.** No plan → scan works standalone. Deviation recorded as variance, never blocks                                                                                                                |
| Architecture                | **A: scan layer (raw truth) + derived money** — chosen over writing `labor_logs` directly at scan time                                                                                                                          |
| Multi-WP cost               | Even-split 1/N at derive (already the documented 279 money model); per-WP precision = later upgrade                                                                                                                             |
| WP grain (added 2026-07-12) | **Main WPs only** for the first two projects — teams assign per main WP (`parent_id IS NULL`), sub WPs inherit the team; labor cost lands at main-WP grain; main→sub distribution estimated from man-days later (mechanism TBD) |

## What already exists (verified LIVE 2026-07-12)

**DB:**

- `daily_work_plans` (project, plan_date) + `daily_work_plan_items` (plan → WP) + **`daily_work_plan_crew` (item_id, worker_id, `is_lead`)** — spec 273 already supports assigning a per-WP team with a lead in the plan. Near-unused (1 plan ever) but the schema for idea-point-1 is DONE.
- `labor_logs` — day-grain money rows: (work_package_id, worker_id, work_date, `day_fraction` enum **`full|half` only**, day_rate_snapshot, worker_name_snapshot, pay_type_snapshot, entered_by, self_logged, superseded_by/correction_reason append-only pattern). **No timestamps, no team reference.** 0 rows all-time. An even 3-way split (⅓) cannot be represented in the current enum.
- `crews` / `crew_members` (spec 279 U1/U2) — persistent crew entity + lead predicate machinery. **0 rows ever; no UI creates a crew.** NOT used by this flow (see Non-goals).
- `workers` — 2 active (roster pipeline live since 279 U4 + QR + 298); `cost_confirmed_at` gate present; `employee_id` mints `PRC-YY-NNNN`.
- `work_packages.owner_id → users` — the DB "WP owner" is an app **user**, a different axis from the lineup's หัวหน้า (a **worker**). This spec does NOT touch `owner_id`.
- `site_owner` (spec 271 / ADR 0075) — project-member role; the morning announcement authority. **0 appointed yet (271 U0 owed)** — not a blocker: the SA records what is announced.
- Known engine debt (271 U0 / ADR 0060): `labor_logs` has **no level snapshot** and **day_rate=0 leaks** into cost. The derive unit here fixes both.

**Code:**

- `src/components/features/sa/muster-strip.tsx` + `src/lib/sa/muster.ts` + `use-mark-present.ts` — spec 277 P0 tap-muster on `/sa` ("X/Y มาทำ", one-tap `ทั้งหมดมาทำ` → `log_labor_day`). Per-WP chip shape, no timestamps, no teams, rides the near-dead `/sa` home. **Superseded by this spec** (retire/repoint decision at U5 build time).
- `log_labor_day` RPC — flagged HIGH in the 2026-07 misalignment audit; this spec does NOT extend it. New RPCs instead.
- QR self-onboard scan flow (279 F-series) — QR mechanics precedent; `/sa/crew` = badge-print home.

## Design

### Concept

Morning talk. Teams line up behind their หัวหน้า. Site Owner announces team→WP assignments. The SA walks the line with their phone:

1. **Scan lead badge** → opens/creates today's team for that lead (pre-filled from plan if one exists, else from yesterday's muster).
2. **Scan member badges** → each turns green: `in_at` timestamp + membership in this team today.
3. **Set team WPs** — chips pre-filled from the plan; SA edits to match the Site Owner's announcement. Editable during the day (team picks up another WP midday).
4. Next lead → next team. Repeat.
5. **Evening:** out-mode — scan badges for `out_at`. **ปิดวัน** (close-day) finalizes and triggers the money derive.

Presence is never blocked by money state. A scanned worker without `cost_confirmed_at` logs presence normally; they simply produce no cost rows until a PM confirms their rate (then backfill).

### U1 — Badge print (code-only)

- Print view off `/sa/crew`: one card per worker — name, `employee_id` (PRC-YY-NNNN), QR encoding the worker `id` (uuid). Batch-per-project + single reprint.
- Browser print CSS (no PDF pipeline). Operator ops: print + laminate.
- QR payload is opaque and grants nothing — a scan only has meaning inside an authenticated SA session on a project the SA can see. A photographed/cloned badge lets a _SA_ mark that worker present; it does not authenticate anyone.

### U2 — Muster schema + RPCs (danger-path, operator-merged)

New tables (all RLS-on; reads/writes scoped `can_see_project`; role gate `site_admin`/`super_admin` for writes — PM/PD/back-office get read):

- `muster_teams` — id, project_id, work_date, lead_worker_id, created_by, created_at. Unique (project_id, work_date, lead_worker_id).
- `muster_team_wps` — team_id, work_package_id. Unique pair. WP must belong to the same project and be a **main WP** (`parent_id IS NULL`); sub WPs inherit the team from their parent (computed at read, never stored). A sub-WP row is permitted only as an explicit **override** for special cases (e.g. rejected work redone by a different team) and excludes that sub WP from parent inheritance.
- `muster_attendance` — id, team_id, worker_id, work_date (denormalized), in_at, in_method (`qr|manual`), out_at, out_method, ot_hours numeric null, scanned_by, note. **Unique (worker_id, work_date)** — one attendance row per worker per day; moving teams updates team_id (audit-logged), not a second row.

SECURITY DEFINER RPCs (229/279 lessons baked in: `revoke execute … from anon` on every one; helper predicates wrapped `(select …)` for eval-once; gates `is distinct from` style null-safe):

- `open_muster_team(p_project, p_date, p_lead_worker)` → team id (idempotent upsert).
- `muster_scan_in(p_team, p_worker, p_method)` — stamps in_at; if the worker already has today's row in another team → error carrying the other team's name; UI confirms → `move_muster_worker`.
- `muster_scan_out(p_team, p_worker, p_method)` — stamps out_at; computes ot_hours (see U4).
- `set_muster_team_wps(p_team, p_wp_ids uuid[])` — replaces the team's WP set (the Site Owner announcement record).
- `move_muster_worker(p_worker, p_date, p_to_team)` — explicit confirmed move; audit_log row.
- `close_muster_day(p_project, p_date)` — records the closure in `muster_day_closures` (project_id, work_date, closed_at, closed_by; unique pair); the derive (U5) keys off this + a nightly cron backstop.

pgTAP suite: role gates (SA yes / visitor+technician no / anon revoked), project scoping both directions, dup-scan conflict, move semantics, unique constraints, WP-project match.

### U3 — Scan UI (code-only)

- Route `/projects/:id/muster` + CTA on the project cockpit (where SAs actually live per telemetry — NOT the dead `/sa`).
- Camera scan: `BarcodeDetector` API with jsQR fallback (SA fleet = Android PWA). **Must be device-verified** — LINE in-app browser camera behavior is a known risk class (see android-pwa memory); the fallback below covers total failure.
- **Manual tap-add always available** (roster list with search) — a lost badge is not an absence. Rows record `in_method='manual'`.
- Team card: lead header, member rows (name + scan time), WP chips, pre-fill sources in priority order: today's plan (`daily_work_plan_crew` where that lead `is_lead`) → yesterday's muster team for that lead → empty. Pre-filled members render grey ("expected") until scanned/tapped.

### U4 — Out-scan + close-day + OT capture (code-only)

- Same screen, เข้า/ออก mode toggle. Out-scan stamps `out_at`.
- `ot_hours` = hours past the project standard day-end, rounded to 0.5h. v1: standard day = constant 08:00–17:00 (Bangkok); per-project config only if reality demands it (YAGNI).
- ปิดวัน: SA-confirmed close; workers with in_at but no out_at get out_at = standard day-end and a flag (no phantom OT).
- **OT is captured + displayed only in v1. OT costing is deferred** — needs the operator's OT rate rule (×1.5? flat? per pay-class?). Open decision, does not block anything.

### U5 — Money derive (danger-path money, operator-merged)

> **Scoped 2026-07-24 (operator + live evidence). Split into U5a (this) + U5b + OT-follow-up.**
> Live at build time: `labor_logs`=0, `muster_team_wps`=**0 assignments across all 3 teams**,
> **0/26 workers cost-confirmed** → the derive produces ZERO rows on real data until SAs adopt
> the team→WP announcement AND PMs confirm rates (both at 0% adoption — the real gate to labor
> money, upstream of the derive). Verified by synthetic pgTAP, not prod fill.
>
> **U5a (MINIMAL engine — enum-only, low-ripple):** the operator chose the minimal path over the
> full precision path. Even-split 1/N is representable in the existing `day_fraction` enum for
> **N≤2** (1 WP→`full`, 2 WP→`half`); N≥3 needs a non-enum fraction. Since `day_fraction_num`
> would ripple through **7 money RPCs** (`freeze_wp_labor_cost`, `record_wage_payment`,
> `distribute_project_coins`, `dashboard_portfolio_spend`, `wp_labor_sell`, …) + ~16 TS readers —
> any of which reading a fractional row as the old enum posts wrong GL/pay — and NO team is on
> even one WP (let alone 3+), `day_fraction_num` is **deferred**. U5a derives with the enum only
> (a derived row is indistinguishable from a manual `log_labor_day` row → cost engine untouched);
> a team on **3+ WPs is SKIPPED** (no rows, close-day never breaks) pending the follow-up.
>
> **⚠️ GRAIN CONSTRAINT (build discovery 2026-07-24) — the "labor at main-WP grain"
> premise below is INCOMPATIBLE with the DB.** `labor_logs` cannot bind to a group
> (งาน) WP — `wp_reject_group_binding` rejects it; labor is **leaf (งานย่อย) grained**,
> always. The muster picker offers `parent_id IS NULL` WPs, of which **47 of 65 live
> top-level WPs are groups (72%)**. So the derive anchors labor only when the team's
> WP is a **leaf**; a team on a group WP (or group+leaf mix) is **SKIPPED** (same
> bucket as 3+-WP, so close-day never crashes). **U5a covers only leaf-WP teams — a
> minority today.** Real coverage needs an operator call: (a) the muster picker offer
> งานย่อย (leaves) instead of/alongside groups, or (b) the group→child man-day split.
> Flagged, not resolved here.
> Adds only `level_snapshot` (`worker_level`) + `source_muster_id` (idempotency). NEW RPC
> `derive_muster_labor(project, date)`; `close_muster_day` calls it inline (same txn).
>
> **U5b (deferred, code-only):** the PM "pending cost" queue surface (which workers are held);
> backfill-on-confirm is AUTOMATIC — the derive is re-runnable, so re-closing (or a re-derive on
> cost-confirm) picks up newly-confirmed workers. The **nightly cron backstop is a worker deploy
> (operator-held)**. MusterStrip retire/repoint also here.
>
> **OT costing (deferred follow-up):** operator set the rule **×1.5 of hourly** (day_rate /
> standard-day-hours × 1.5 × `ot_hours`). Built as its own unit; `session='ot'` rows are the input.

On `close_muster_day` (+ nightly cron backstop for unclosed days, integrity-console pattern):

- Per present worker-day: one `labor_logs` row **per MAIN WP of their team that day**, fraction = 1/N over the team's main WPs (even-split — the documented 279 money model; the operator's stated temporary fix). Labor cost lands at **main-WP grain** for the first two projects; distribution down to sub WPs is a later estimate from man-days (mechanism TBD — operator).
- ⚠️ **Build-time verify:** `labor_logs` anchored on an `is_group` WP is new territory — the cost engine, WP-detail cost views, and the dashboard spend model (group-vs-children **disjointness invariant**, see dashboard-spend-model memory) must count a group-anchored row exactly once. Also check `daily_work_plan_items` / plan board for group-WP handling before wiring pre-fill.
- `labor_logs` additive columns: `day_fraction_num numeric` (enum `full|half` can't hold 1/3; existing rows map full→1.0, half→0.5; cost engine reads `coalesce(day_fraction_num, enum-mapped)`), `level_snapshot` (fixes 271-U0 bug #1), `source_muster_id` (idempotency key — the GL re-drain lesson: derive is an upsert keyed on the attendance row; re-running a close never double-posts).
- **Cost gate:** no `cost_confirmed_at` → NO labor_logs rows; the worker lands in a PM "pending cost" queue (extends the U7-tracker รอยืนยัน state); on confirm, derive backfills their held days. Also refuses day_rate=0 into cost (fixes 271-U0 bug #2).
- Corrections: muster edits after close re-run the derive; replaced rows use the existing supersede pattern (`superseded_by` + `correction_reason='muster_rederive'`).
- The 277 P0 `MusterStrip`/`log_labor_day` path is retired or repointed at this unit (decision at build: likely repoint the strip to read muster_attendance).

### U6 — Plan pre-fill + variance (code-only)

- Plan pre-assignment follows the same grain: **teams are planned per main WP**; sub WPs inherit the planned team (display-level, unless a special-case override exists).
- Pre-fill is already wired in U3; this unit adds the **variance surface**: planned-vs-scanned per main WP/day — planned-not-present, present-not-planned, team-changed — as a chip on the plan board + a feed row for spec 271 snapshots.
- Computed (view or query), no new tables.

### Finer cost precision — the upgrade path (not built now)

Operator direction (2026-07-12): first two projects cost at **main-WP grain only**; distribution from main WP down to sub WPs will be **estimated from man-days later** — mechanism not yet decided. The scan layer already holds team + main WPs + hours, so any future rule (man-day weights per sub WP, % allocation at ปิดวัน, or lead-entered splits) is a derive-rule change only; the scan flow never changes.

## Non-goals / boundaries

- **`crews` table is not in this flow.** The muster team is self-sufficient (lead + date + members). The persistent crew entity stays for the 279 self-gov arm (lead-managed roster); if musters prove stable per lead, a later unit may auto-suggest crews from muster history. No crew-CRUD UI is built here.
- **`work_packages.owner_id` untouched** — different axis (app-user accountability, ADR 0060), not the lineup lead.
- **No OT money, no per-WP weights, no worker self-check-in** (phoneless majority; revisit when worker phone penetration is real).
- **No new plan schema** — `daily_work_plan_crew` already carries planned team+lead.

## Sequencing

| Unit | Content                                                                                                    | Class                              |
| ---- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| U1   | Badge print view                                                                                           | code-only, auto-merge              |
| U2   | Muster tables + RPCs + pgTAP                                                                               | **schema — operator-held**         |
| U3   | Scan UI + manual fallback + team WP chips                                                                  | code-only                          |
| U4   | Out-mode + ปิดวัน + OT hours                                                                               | code-only                          |
| U5   | Derive → labor_logs (+ fraction_num, level_snapshot, source_muster_id, cost gate, backfill, cron backstop) | **schema + money — operator-held** |
| U6   | Variance chip + 271 feed                                                                                   | code-only                          |

Each unit shippable alone; U1 has standalone value (badges usable for identification immediately).

## Testing

- pgTAP per schema unit (gates, scoping, constraints, idempotent derive, supersede correctness, anon revoked).
- Vitest pure functions: fraction split, OT rounding, pre-fill merge (plan → yesterday → empty), variance computation.
- Browser-verify the scan flow on a real Android device before calling U3 done (BarcodeDetector + camera permission in PWA/LINE contexts) — jsdom cannot prove this.

## Open decisions (operator, none blocking the build order)

1. OT rate rule (needed only at OT-costing, after U5).
2. Standard day window if 08:00–17:00 constant proves wrong.
3. MusterStrip retire vs repoint (decide at U5).
4. Badge physical format (card size / lamination) — ops, not code.
