# Spec 281 — System Integrity Console (`ตรวจระบบ`)

**Status:** 🟡 **DESIGN — awaiting spec review.** Not started.
**ADR:** 0080 to be authored (check-registry pattern + scheduled integrity runner + super_admin console).
**Origin:** operator directive 2026-07-08 — "design the feature that must be available to superadmin."
Chosen from a ranked menu of three god-mode surfaces (① Integrity Console — recommended; ② Privileged-Action
Ledger + Undo; ③ Automation Control Center). ① picked.

Grounded in a full invariant map of the live schema (7-agent discovery, 2026-07-08). The map's central
finding **shapes this whole spec**:

> **The firm already owns nearly every integrity check it needs. They are scattered, unscheduled, or
> trapped in test fixtures.** `gl_reconciliation()` exists but nothing schedules it. The double-post
> detector lives ONLY inside pgTAP `256`/`254`. The 2026-06 GL-drain outage (~102k baht, 27 PRs stuck
> pending 2 days) was noticed only because _unrelated pgTAP tests broke_ — no monitor caught it. The
> console's job is to **unify + schedule + surface + alert**, not to invent checks.

## 1. Problem

super_admin verifies system integrity **by hand, every session** — global trial balance = 0, GL outbox not
stuck, no double-post, RLS "zero-unsafe-gate", schema drift `main`↔DB, the known-red pgTAP baseline. This
tribal, manual, anxiety-driven ritual is:

- **Unscheduled** — `gl_reconciliation()` (the shipped GL check) runs only when a pm/super/accounting user
  opens `/accounting`. A drift or a stuck `failed` outbox job can persist indefinitely with zero signal
  (this is exactly how the 2026-06 outage sat 2 days).
- **Incomplete** — the definitive double-post detector exists only in pgTAP fixtures; the highest-volume GL
  control accounts (2110 DC-clearing, 2100 AP, 1400 WIP) have **no** subledger tie-out; nothing asserts
  every postable source doc actually posted a journal entry; no identity/roster orphan sweep runs anywhere.
- **Not owned by anyone** — no single surface answers "is the machine healthy right now?" It is the purest
  super_admin capability: control over the _system itself_, which no site/manager/accountant role should hold.

## 2. Decisions (operator-confirmed 2026-07-08)

| #   | Decision                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | **Hardcoded definer check-library + persisted results + pg_cron.** Checks are keyed functions inside a `SECURITY DEFINER` library (`run_integrity_checks()`), NOT user-supplied SQL rows (injection/privilege footgun — checks need `pg_proc`/`cron.job`/`auth.users` read rights) and NOT on-demand-only (that fails to close the "drift sits unnoticed" gap, the whole point). Rejected: data-driven SQL table (B); pure on-demand (C). |
| D2  | **The board is the roadmap.** The registry lists **every** check across all domains from day one. A check whose unit has not shipped renders as a **greyed "not ready yet"** tile (with its target unit), not hidden. super_admin sees the full integrity surface immediately; units fill it in.                                                                                                                                          |
| D3  | **Alert on new-red → Telegram.** When a check flips green→red (a _new_ breakage vs the previous run), enqueue `notification_outbox` → operator Telegram. Reuses existing notification infra. Directly closes the "sat 2 days unnoticed" gap.                                                                                                                                                                                              |
| D4  | **Hourly scheduled scan.** pg_cron `integrity-scan` runs the whole registry every hour and persists a run. Balance of freshness vs DB load; integrity rarely breaks, so sub-hour churn is unwarranted. On-demand "run now" always available in the console.                                                                                                                                                                               |
| D5  | **Read-only. No auto-fix.** The console observes and alerts; it never mutates. Reversal/remediation is manual today and the subject of the phase-2 **Privileged-Action Ledger + Undo (②)**.                                                                                                                                                                                                                                               |
| D6  | **super_admin-only, null-safe, extends not replaces.** `run_integrity_checks()` is `SECURITY DEFINER`, gated `v_role is null or v_role <> 'super_admin'` → `42501`, `revoke from public, anon` + `grant to authenticated`. It **wraps** `gl_reconciliation()` rather than duplicating it. Results table is super_admin-only RLS.                                                                                                          |
| D7  | **In-DB checks compute in the RPC; CLI-only checks are externally fed.** Most checks run inside Postgres. A few (schema-drift `db push --dry-run`, `db:types` freshness, migration-order lint) **cannot** run in-DB — they are CI/CLI concerns. They appear as greyed "reported by CI" tiles until a later unit wires a reporter (U6).                                                                                                    |

## 3. Mechanism

Three pieces.

### 3.1 Check library — `run_integrity_checks()`

- `SECURITY DEFINER`, `set search_path = public`, owned by `postgres` (so it can read `auth.users`,
  `pg_proc`, `pg_policies`, `pg_class`, `cron.job`, `cron.job_run_details`).
- Gate: reads `auth.uid()` + `current_user_role()`; `if v_role is null or v_role <> 'super_admin' then
raise exception using errcode = '42501'`. Grants: `revoke execute … from public, anon; grant execute …
to authenticated;` (mirrors the anon-exec-definer-harden invariant, pgTAP `100`).
- Returns `setof integrity_check_result`:
  `(key text, domain text, title text, severity text, status text, drift numeric, offending_count int,
sample jsonb, implemented bool, unit text)`.
  `status ∈ {green, amber, red, na}` — **green** = invariant holds; **red** = a `crit`/`high` check is
  violated; **amber** = a `med`/`low` or informational check is violated (hygiene/watch, not an incident,
  e.g. `client_grant_expired_not_revoked`, `peak_queue_not_growing`); **na** = greyed/not-yet-implemented
  (metadata-only row so the board can render the full roadmap). Only green→red transitions alert (D3); amber
  never pages. Each check caps `sample` to ~20 offending ids.
- Internally a `CASE`/dispatch over the keyed check set; each keyed check is a small SQL block (or a call to
  an existing RPC). Adding a check = one keyed block + one registry metadata row + one pgTAP assertion.

### 3.2 History — `integrity_check_runs`

- `(run_id uuid, ran_at timestamptz, trigger text /* 'cron' | 'manual' */, key text, domain text,
severity text, status text, drift numeric, offending_count int, sample jsonb)`.
- Append-only in spirit; super_admin-only RLS SELECT; writes only via the runner (service-role / definer).
- Powers "last green at" per check and the flip-detection for D3 alerts (compare newest run to the prior).

### 3.3 Runner + console page + alert

- **Runner** `run_and_record_integrity(trigger)` (definer): calls `run_integrity_checks()`, inserts one row
  per result into `integrity_check_runs` under a shared `run_id`, then for every check that is `red` now and
  was not `red` in the previous run, enqueues a `notification_outbox` row (Telegram) — one digest per run.
- **Schedule** pg_cron `integrity-scan` hourly → `select run_and_record_integrity('cron')`. Idempotent
  unschedule-then-schedule (house pattern).
- **Console** `/settings/integrity` (`ตรวจระบบ`), `requireRole(["super_admin"])`. Server Component reads the
  latest `run_id`'s rows (grouped by domain). Board of domain cards → tiles `🟢/🟡/🔴/⚪(na) · title · count ·
last-run`. Click a 🔴 → detail: invariant statement, why-it-matters, capped sample offending rows, "last
  green at", **Run now** (server action → `run_and_record_integrity('manual')` → `revalidatePath`). Top bar:
  **Run full scan** + last-full-scan timestamp. Greyed ⚪ tiles show their target unit.
- **Discovery** card in the Settings `admin` section (`sections.ts`, already `super_admin`-gated).
  `<BottomTabBar role="super_admin" />` + `<DetailHeader />`, reached from the card (not a tab), per the
  `wp-grouping-import` template.

## 4. The registry (all domains — D2)

`wrap` = call an existing check · `promote` = lift a pgTAP-only detector into prod · `NEW` = a gap the
discovery found completely unmonitored. `sev` = violation severity. `unit` = when the tile goes live (greyed
until then).

### 💰 Money — GL · outbox · double-post

| key                          | check                                                                                                                                     | source                                                                     | sev  | unit |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ---- | ---- |
| `tb_global_balanced`         | Σdebit = Σcredit across all `journal_lines`                                                                                               | wrap `gl_reconciliation`                                                   | crit | U1   |
| `entry_balanced_each`        | every posted entry Σd=Σc>0 (defense-in-depth)                                                                                             | NEW                                                                        | crit | U1   |
| `source_doc_posted_complete` | every postable PR / wage_payment / labor freeze / rental batch / certified client_billing has a posted non-reversed `journal_entries` row | NEW — _the ~102k-baht gap_                                                 | high | U1   |
| `control_tie_single_feeder`  | 1210 / 2210 / 1310 / 2200 tie to subledger                                                                                                | wrap `gl_reconciliation`                                                   | high | U1   |
| `control_tie_multi_feeder`   | 2110 DC-clearing / 2100 AP / 1400 WIP tie to their feeders                                                                                | NEW — _biggest GL blind spot; needs a feeder-aggregation model_            | high | U2   |
| `posting_backlog_zero`       | outbox pending+failed = 0                                                                                                                 | wrap `gl_reconciliation`                                                   | high | U1   |
| `outbox_pending_lag`         | no `gl_posting_outbox` row pending > 5 min                                                                                                | NEW — _outage class_                                                       | crit | U2   |
| `outbox_failed_zero`         | no `gl_posting_outbox` row in `failed` (terminal, never auto-retried)                                                                     | NEW                                                                        | high | U2   |
| `drain_cron_alive`           | `gl-posting-drain` (+ prune / report-reaper / notification-drain) scheduled `active` AND last run succeeded                               | NEW — _the 2026-06 outage root cause_                                      | crit | U2   |
| `drained_equals_posted`      | `posted` outbox rows map to a live posted entry (excluding the legitimate NULL-journal no-ops: void/zero-cost)                            | NEW                                                                        | high | U2   |
| `no_double_post`             | ≤ 1 un-reversed posted entry per `(source_table, source_id, source_event)`                                                                | promote pgTAP `256`/`254`                                                  | crit | U2   |
| `superseded_posts_nothing`   | the 4 supersede tables (`wage_payments`, `client_receipts`, `subcontract_payments`, `rental_settlements`) post nothing while superseded   | promote pgTAP `256`/`254`                                                  | crit | U2   |
| `poster_guard_present`       | every drain-arm `post_*_to_gl` carries the self-reverse block                                                                             | NEW — _catches the unguarded `post_purchase_order_charge_to_gl` (1 of 18)_ | high | U2   |
| `peak_queue_not_growing`     | `peak_sync_outbox` has no drainer — surface the dead-queue pending count                                                                  | NEW (informational)                                                        | med  | U2   |

### 🔐 Access / RLS

| key                      | check                                                                                  | source                                                                         | sev  | unit |
| ------------------------ | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ | ---- | ---- |
| `definer_no_anon_exec`   | 0 callable definer functions grant anon EXECUTE (except `current_user_role`)           | wrap pgTAP `100`/`229`                                                         | crit | U3   |
| `no_null_unsafe_gate`    | 0 definer gates that fall open for a NULL role                                         | wrap pgTAP `254` (regex heuristic)                                             | crit | U3   |
| `rls_enabled_all_tables` | every `public` base table has RLS enabled (allowlist for intentional exemptions)       | NEW — _CLAUDE.md says "no exceptions" but it is not machine-enforced globally_ | crit | U3   |
| `rls_table_has_policy`   | every RLS-enabled table has ≥ 1 policy                                                 | NEW                                                                            | high | U3   |
| `gating_helper_not_null` | `can_see_project` / `can_see_wp` / role-set helpers return non-NULL for a roleless JWT | NEW                                                                            | crit | U3   |
| `audit_log_scoped`       | no `USING(true)` SELECT on `audit_log`; no authenticated/anon INSERT                   | wrap pgTAP `253`                                                               | high | U3   |
| `anon_no_table_dml`      | no unexpected anon table DML grant (allowlist)                                         | NEW                                                                            | high | U3   |

### 👷 Identity / roster

| key                                  | check                                                                          | source                                        | sev  | unit |
| ------------------------------------ | ------------------------------------------------------------------------------ | --------------------------------------------- | ---- | ---- |
| `worker_user_orphan`                 | no `workers.user_id` pointing at a missing `public.users`                      | NEW                                           | high | U4   |
| `authuser_publicuser_reconcile`      | no `auth.users` without a `public.users` row (failed `handle_new_user`)        | NEW — _needs the definer's cross-schema read_ | med  | U4   |
| `crew_member_integrity`              | crew members: one-active-per-worker, live crew + live worker                   | NEW                                           | high | U4   |
| `active_membership_deactivated_crew` | no active membership in a `crews.active = false` crew                          | NEW                                           | med  | U4   |
| `crew_lead_active`                   | no active crew whose `lead_worker_id` is now inactive (silent authority death) | NEW                                           | med  | U4   |
| `worker_project_matches_move`        | `workers.project_id` == latest `worker_project_moves` row                      | NEW                                           | med  | U4   |
| `cost_confirmed_complete`            | no `cost_confirmed_at` worker missing level/day_rate/pay_type/employment_type  | NEW                                           | med  | U4   |
| `roster_dedup`                       | no duplicate `workers.tax_id` / pending `crew_registrations.national_id`       | NEW                                           | high | U4   |
| `client_grant_expired_not_revoked`   | list expired-but-not-revoked `client_portal_access` (hygiene, not a breach)    | NEW                                           | low  | U4   |

### 🧱 Schema / drift (external — D7)

| key                         | check                                                                                        | source                                             | sev  | unit        |
| --------------------------- | -------------------------------------------------------------------------------------------- | -------------------------------------------------- | ---- | ----------- |
| `known_red_baseline`        | pgTAP known-red count == codified manifest (today `200/221` lives only in `MEMORY.md` prose) | NEW — needs a committed expected-failures manifest | med  | U5          |
| `schema_drift_clean`        | `supabase db push --dry-run --linked` == "up to date"                                        | external CI/CLI                                    | high | U6 (greyed) |
| `db_types_fresh`            | regenerated `db:types` == committed `database.types.ts`                                      | external CI/CLI                                    | med  | U6 (greyed) |
| `migration_order_monotonic` | migration timestamps strictly increasing, no duplicate prefix                                | external lint                                      | low  | U6 (greyed) |

## 5. Units

Each unit is a normal TDD loop (failing test first; `pnpm lint && typecheck && test` + `pnpm db:test`
green). Migrations are additive → danger-path guard HOLDS each for operator merge (this spec adds tables,
a definer RPC library, and a cron job).

- **U1 — infra + GL money checks + full greyed board.** `integrity_check_runs` table; `run_integrity_checks()`
  skeleton carrying **registry metadata for every check** (so the board renders the whole roadmap with
  greyed ⚪ tiles); the GL checks live (`tb_global_balanced`, `entry_balanced_each`,
  `source_doc_posted_complete`, `control_tie_single_feeder`, `posting_backlog_zero` — the first four/five via
  wrap+NEW); `run_and_record_integrity`; pg_cron `integrity-scan` hourly; `/settings/integrity` page + admin
  card. End-to-end thin slice: hourly scan writes a run, board shows GL green + everything else greyed.
- **U2 — outbox + double-post checks.** Flip the outbox and double-post tiles live, incl. `drain_cron_alive`
  (the outage root cause) and the promoted `no_double_post` / `superseded_posts_nothing` detectors. Build the
  feeder-aggregation model for `control_tie_multi_feeder` (the deferred multi-feeder tie).
- **U3 — access / RLS checks.** Flip the access tiles live, incl. the two NEW global invariants
  (`rls_enabled_all_tables`, `rls_table_has_policy`) and `gating_helper_not_null`.
- **U4 — identity / roster checks.** Flip the identity tiles live (orphan sweeps + the roster-integrity set).
- **U5 — alerting + known-red manifest.** New-red → `notification_outbox` → Telegram digest (D3); commit the
  codified pgTAP expected-failures manifest and wire `known_red_baseline`.
- **U6 (later) — external CI reporter.** A CI/dispatch job runs `db push --dry-run`, `db:types` diff, and the
  migration-order lint, and reports results into `integrity_check_runs` (a service-role write) so the greyed
  schema/drift tiles go live.

## 6. Verification (per unit)

- `run_integrity_checks()` refuses a non-super_admin caller (`42501`) and a roleless JWT — pgTAP mirroring
  `100-anon-exec-definer-harden`.
- Each live check: a pgTAP test that (a) passes clean, and (b) after injecting a synthetic violation inside
  the test transaction, the check returns `red` with the offending id in `sample` (then `rollback`).
- `no_double_post` / `superseded_posts_nothing` mirror the existing `256`/`254` attack fixtures.
- Page: `require-role.test.ts`-style redirect test (non-super → `roleHome`); `settings-sections.test.ts`
  extended to pin the new admin-card href.
- U5: a green→red transition enqueues exactly one `notification_outbox` digest; a still-red (no flip)
  enqueues none.

## 7. Out of scope (v1)

- **Auto-fix / remediation** — read-only by decision D5; reversal is the phase-2 Privileged-Action Ledger (②).
- **User-defined checks / arbitrary SQL** — checks are definer code only (D1).
- **Replacing `gl_reconciliation()`** — it is wrapped, not superseded.
- **Per-project integrity drill** beyond what a check's `sample` emits.
- **Fixing the underlying gaps the checks reveal** (e.g. adding the `post_purchase_order_charge_to_gl`
  self-reverse guard, a crew-deactivation tombstone trigger, a drain `FOR UPDATE SKIP LOCKED`). Those are
  their own follow-up specs; this console _detects_ them, it does not fix them.
