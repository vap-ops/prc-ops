# ADR 0069: As-built — migration-history drift recovery, 2026-07

## Status

Accepted (as-built, 2026-07-02). Recovery migration
`20260813056000_drift_recovery_realign_history_to_live.sql` on
`chore/recover-migration-drift-2026-07`, per
[`change-management.md`](../policies/change-management.md) §4.

## Context

The 2026-07-02 RLS-audit session ran a full from-scratch migration replay on a
Supabase preview branch (the drift detector of change-management §3) and
flagged five objects where the migration record no longer reproduces prod.
This session re-sourced the truth directly from prod
(`pg_get_functiondef`, `pg_policies`, `pg_proc.proacl`) and from
`supabase_migrations.schema_migrations.statements` (the verbatim record of
what each migration actually ran), and found the drift is of one class:

**Four applied migrations were edited in place in git after they were applied.**
An edited already-applied migration never re-runs (`db push` skips known
timestamps), so the edits reached prod separately, as out-of-band /
fix-forward changes — leaving three states that disagree textually:
the recorded statements (oldest), the live objects (truth), and the committed
files (edited to approximate the truth).

Per object — recorded (applied) statements vs prod LIVE:

| #   | Object                                                                                    | Recorded at apply                                                                                                             | Prod LIVE (truth)                                                                                                              |
| --- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 1   | `stock_issues_freeze_ledger()` (mig `20260813027000`)                                     | `to_jsonb` whole-row diff — false-positives on GENERATED STORED `total_cost`/`total_sell` (NULL in `NEW` in a BEFORE trigger) | Explicit per-column `is distinct from` checks, explanatory comments inside the body                                            |
| 2   | `claim_next_report()` (mig `20260525010000`)                                              | `REVOKE … FROM PUBLIC` only → anon/authenticated kept EXECUTE via Supabase default privileges                                 | EXECUTE = owner + `service_role` only. (Body was always FIFO — the "non-FIFO body" note in the earlier finding was inaccurate) |
| 3   | Policy `purchase_quotes readable by back office` (mig `20260809001200`)                   | 3 roles — no `project_director`                                                                                               | 4 roles incl. `project_director` (pgTAP 91 pins it)                                                                            |
| 4   | Policy `stock_receipts readable by project viewers or procurement` (mig `20260809000000`) | bare `public.current_user_role() = 'procurement'`                                                                             | `(select public.current_user_role())` eval-once wrap (pgTAP 40 pins it)                                                        |
| 5   | Policy `stock_on_hand readable by project viewers or procurement` (mig `20260809000000`)  | same as #4                                                                                                                    | same as #4                                                                                                                     |

Because the files were edited toward the live state, a replay of the current
files already lands semantically on prod for objects 2–5; the one
replay-visible residue is #1, where live `prosrc` carries comments inside the
function body and the file's version does not — a permanent
`pg_get_functiondef` diff in every future replay audit.

## Decision

One recovery migration, `20260813056000`, re-asserts all five objects
**verbatim from LIVE** (function definitions pasted from
`pg_get_functiondef`; policies re-created with the live qual; the
`claim_next_report` ACL re-asserted explicitly). Applying it to prod is a
semantic no-op; its value is that the **last recorded definition of each
object now equals prod**, so both audit modes come back clean from here on:

- replay audits (preview-branch full replay → diff vs prod), and
- history audits (`schema_migrations.statements` last-definition vs live).

No new pgTAP: the live posture of every re-asserted object is already pinned
(pgTAP 40 eval-once wraps, 91 back-office/PD role lists, 183/197 custody
handshake, the anon-EXECUTE guards). The full suite runs post-apply.

## Consequences

- Git is the source of truth again for these five objects, mechanically —
  not by trusting in-place-edited files.
- The in-place-edit anti-pattern is confirmed as the root cause and is
  already codified ("editing an APPLIED migration & re-push silently no-ops —
  always a NEW migration"); this ADR is its as-built record.
- The stale recorded statements of the four original migrations remain in
  `schema_migrations` (history is append-only); auditors must read the LAST
  definition of an object, which `20260813056000` now owns.
