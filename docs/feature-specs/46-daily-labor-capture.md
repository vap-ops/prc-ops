# Spec 46 — Daily labor capture per Work Package

**Status:** in progress — 2026-06-12. Operator brief: Head Tech
surplus-share pilot launches on labor cost per WP; the system captures
zero labor data today and labor cannot be reconstructed after the
fact. DC (outsourced) workers' logged days are also their payroll
source. Billing status follows as spec 47.

Stress-test resolutions (operator-confirmed 2026-06-12):

- **C1** — no "variance at done" view exists; P2 builds it.
- **C2** — supersede pattern forbids a unique index on "one entry per
  person per day per WP" (anti-join semantics); uniqueness lives in a
  SECURITY DEFINER RPC under an advisory lock.
- **C3** — all app users share the `authenticated` DB role, so money
  separation is privilege-layer: rate columns get **no authenticated
  grant at all**; only the service-role client (inside
  `requireRole(pm/super)`-gated server code) can read them.
- **C4** — technicians get **no app access change**. They report
  verbally; SA or back office enters. Entry roles: `site_admin`,
  `project_manager`, `super_admin`. The `technician_entry` flag is
  dropped; `self_logged` stays (worker↔user link).
- **C5** — >1.0 total day per worker per date across WPs is allowed
  but surfaced in the PM cost view (P2). Never blocked.
- **C6** — labor cost freezes at `pending_approval → complete` into a
  snapshot row; later corrections never recompute it silently — PM
  re-freezes explicitly, audited (P2).
- **C7** — all day-bucketing (variance, defaults) uses Asia/Bangkok
  dates, never UTC.

## Principles

- Field UI is **presence-only**. No rates, costs, or totals on any
  screen a site_admin can reach. Cost = server-side join via the admin
  client behind `requireRole(pm/super)`.
- `labor_logs` is append-only with the photo_logs supersede pattern
  (ADR 0004/0009/0015): corrections supersede, removals are tombstone
  rows, current state is an anti-join + tombstone filter. Reasons
  required on both.
- Half-day is the finest granularity (`day_fraction` enum
  `full|half`). No hours, by design.
- Tenant-clean (ADR 0035): no company literals in src/.

## P1 — capture (this unit)

### Migration A: `workers` master

- Enum `worker_type` (`own`, `dc`).
- Table `workers`: `id` uuid PK, `name` text NOT NULL (CHECK ≤ 120
  chars), `worker_type` NOT NULL, `contractor_id` FK → contractors
  (CHECK: required when `dc`, NULL when `own`), `user_id` FK →
  users NULL (own tech with an app login — powers self-log
  detection), `day_rate` numeric(10,2) NOT NULL DEFAULT 0 CHECK ≥ 0,
  `active` boolean NOT NULL DEFAULT true, `created_by` FK users,
  `created_at`. **No DELETE ever** (suppliers posture); deactivate via
  `active`.
- Grants: `authenticated` SELECT **column-scoped** — everything
  except `day_rate`. Zero write grants: all writes via RPCs below.
  RLS: SELECT policy for sa/pm/super/procurement via
  `current_user_role()`.
- RPCs (SECURITY DEFINER, role-gated):
  - `create_worker(p_name, p_type, p_contractor, p_user, p_day_rate)`
    → uuid — pm/super only (rate is money).
  - `update_worker(p_id, p_name, p_active, p_contractor)` — pm/super.
  - `set_worker_day_rate(p_id, p_rate)` — pm/super; writes an
    audit_log row (`worker_change`, payload old/new rate).
- New `audit_action` value: `worker_change`.

### Migration B: `labor_logs`

- Enum `day_fraction` (`full`, `half`).
- Table `labor_logs`: `id` uuid PK, `work_package_id` FK NOT NULL,
  `worker_id` FK workers NOT NULL, `work_date` date NOT NULL,
  `day_fraction` day_fraction NULL (NULL = tombstone only — CHECK
  `day_fraction IS NOT NULL OR superseded_by IS NOT NULL`),
  `day_rate_snapshot` numeric(10,2) NOT NULL,
  `worker_name_snapshot` text NOT NULL, `worker_type_snapshot`
  worker_type NOT NULL, `contractor_id_snapshot` uuid NULL,
  `entered_by` FK users NOT NULL, `self_logged` boolean NOT NULL
  DEFAULT false, `superseded_by` uuid FK labor_logs NULL,
  `correction_reason` text NULL (CHECK: set iff `superseded_by` set),
  `created_at`.
- Append-only enforced three-layer (audit_log posture): REVOKE
  UPDATE/DELETE, RLS with no UPDATE/DELETE policies, BEFORE
  UPDATE/DELETE trigger raising P0001.
- Grants: `authenticated` SELECT **column-scoped** — everything
  except `day_rate_snapshot`. Zero INSERT grant — writes via RPCs.
- Indexes: `(work_package_id, work_date)`, `(worker_id, work_date)`
  (payroll-period queries).
- RPCs (SECURITY DEFINER; caller must be sa/pm/super; both take
  `pg_advisory_xact_lock(hashtext(wp||worker||date))`):
  - `log_labor_day(p_wp, p_worker, p_date, p_fraction)` → uuid.
    Refuses (P0001) when a current (non-superseded, non-tombstone)
    entry exists for the triple, when the worker is inactive, or when
    the WP is `complete`. Snapshots rate/name/type/contractor from
    `workers`; sets `entered_by = auth.uid()`; computes `self_logged`
    = (workers.user_id = auth.uid()).
  - `correct_labor_log(p_log, p_fraction, p_reason, p_tombstone)` →
    uuid. Inserts the superseding row (same triple + snapshots carried
    from the original; fresh `entered_by`/`self_logged`); tombstone =
    NULL fraction. Refuses if the target is already superseded
    (current-state check under the same lock).
- `work_date` default on the client = today in Asia/Bangkok.

### UI (P1)

- **WP detail zone บันทึกแรงงานรายวัน** (after the photo zone), visible
  to sa/pm/super, hidden for WPs in `complete`:
  - Date control (default today), roster picker (active workers;
    own + DC grouped, DC shows contractor name), full/half segment per
    selected worker, one submit → server action loops `log_labor_day`.
  - Recent-days list (current-state read, last 7 work dates): worker
    name, fraction, self-log badge (PM/super only), correction
    affordance → dialog (new fraction or remove + required reason) →
    `correct_labor_log`.
  - Presence-only: the components never receive rate fields (the
    column grant makes overreach a 42501, and explicit column lists
    are test-pinned).
- **`/workers` roster page** (pm/super; PAGE_MAX_W; AppHeader):
  list (own + DC sections, active toggle, day rate shown — this page
  is requireRole-gated and server-rendered), add-worker form, edit
  name/active, set rate. All writes through the RPCs.
- Server actions in `src/lib/labor/actions.ts` with requireRole +
  zod-style validation (length caps, date sanity: not in the future,
  not older than 14 days without pm/super role).

### Out of P1 (recorded)

Offline queueing (simple retry + form-state-preserving error only —
operator-approved; `QueuedUpload` union gains a `labor_log` kind later
if the field shows pain), payroll export, any cost rendering.

## P2 — money & close (next unit, same spec)

- `wp_labor_costs` snapshot table (zero authenticated grant): wp PK,
  own_cost, dc_cost, computed_at, frozen_by. Written by
  `freeze_wp_labor_cost(p_wp)` (pm/super RPC) invoked by the approve
  action on `pending_approval → complete`; explicit re-freeze allowed,
  audited (`labor_cost_freeze`).
- PM cost view on WP detail (admin-client join): own/DC subtotals,
  per-worker day counts, >1.0 worker-date surfacing (C5), self-log
  flags.
- Variance strip at close: photo-activity days (Asia/Bangkok dates of
  all non-tombstone photo_logs, `captured_at_client` falling back to
  `created_at`) vs logged labor days; surfaces when the symmetric
  difference ≥ 2 days OR photos exist with zero labor. Threshold is a
  named constant.

## Verification checklist (P1)

- [ ] pgTAP file 29: shapes, append-only triple-layer, column-grant
      posture (authenticated SELECT lacks rate columns; no writes),
      RPC behavior — happy path, duplicate refusal, inactive-worker
      refusal, complete-WP refusal, self_logged computation,
      correction + tombstone semantics, already-superseded refusal,
      role gating (sa can log, visitor cannot; rate RPCs refuse sa).
- [ ] Unit: server actions (role gates, validation, RPC args),
      current-state read helper (anti-join + tombstone), roster
      grouping helper, labor zone + roster page components (explicit
      column lists pinned).
- [ ] `pnpm lint && pnpm typecheck && pnpm test`; e2e auth spec;
      prod build.
- [ ] Operator: log a real crew day on a live WP from the phone;
      verify a correction; verify SA screens show no money anywhere.
