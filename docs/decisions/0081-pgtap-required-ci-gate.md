# ADR 0081 — pgTAP as a required CI gate

- Status: Accepted (2026-07-09).
- Supersedes the manual-only stance of **ADR 0048** (CI test-tier policy) for the
  `db-test` job. ADR 0048's Tier A/B boundaries otherwise stand.

## Context

The pgTAP suite (`supabase/tests/database/*.test.sql`, run by `scripts/run-pgtap.ts`)
encodes the invariants that make this system safe: RLS gates per role×table×op,
append-only enforcement on `audit_log` / `photo_logs` / `approvals`, and the
money/GL reconciliation checks. Under ADR 0048 it was **Tier C** — a
`workflow_dispatch`-only job, further gated on a `vars.ENABLE_DB_TEST` opt-in that
was never set. So in practice **pgTAP never ran in CI**. Those invariants were
enforced only by a developer remembering to run `pnpm db:test` locally before
pushing.

This has a concrete downstream cost. The autonomous-build danger-path guard holds
**every** migration (even purely additive ones) for operator review, and CLAUDE.md
records the reason verbatim: the guard holds additive migrations and danger-path
changes _"until pgTAP is a required CI check."_ Until CI could prove the schema
invariants hold, no schema change could safely auto-merge. Making pgTAP required is
the keystone that unblocks additive-migration auto-merge.

Two things kept pgTAP out of auto-CI (ADR 0048 "Why not the alternatives"):

1. **It hits the ONE shared remote Supabase project.** There is no Docker/local
   Postgres (ADR 0006). Running it on every PR risks concurrent runs interfering
   and adds load to the production database.
2. **Secret exposure** — it needs `SUPABASE_ACCESS_TOKEN`.

## Decision

1. **Elevate `db-test` to run on every `pull_request` and `push` to `main`**, and
   make **`Database (pgTAP)`** a required status check in branch protection.

2. **Serialize on a global concurrency group** (`group: pgtap-shared-db`,
   `cancel-in-progress: false`) rather than provisioning a per-PR preview branch.
   Only one pgTAP run touches the shared DB at a time; other runs queue.

3. **Tolerate a pinned, minimal set of pre-existing reds, each within a
   failing-assertion budget.** The runner reads `supabase/tests/known-red.json`
   (exact test-file basename + `maxFailures` + reason + since). A run passes iff
   **exactly** the allowlisted files fail and **each stays at or under its
   `maxFailures`** — any _other_ red fails the check, an allowlisted file that
   exceeds its budget fails the check (so a NEW regression landing inside a
   quarantined file is surfaced, not masked), and an allowlisted file that starts
   passing is surfaced so the list is pruned, not accumulated. A runner ERROR
   (transform/connection) counts as infinite failures so a budget can never
   swallow it. The loader is fail-closed: a missing manifest — or an entry lacking
   a valid non-negative-integer `maxFailures` — tolerates nothing. Residual (by
   design): a regression that keeps the SAME failing-assertion count in a
   quarantined file is still tolerated; the mitigation is to keep the list minimal
   and fix+remove entries. At adoption the pinned set is
   `200-store-inventory-reconciliation.test.sql` (budget 3) and
   `221-catalog-categories.test.sql` (budget 1) — both fail on live-data drift (a
   GL↔subledger reconciliation and a seeded-category count), not on a code
   regression. Each has a follow-up to re-seed its own fixtures inside the test
   transaction and be removed from the list.

4. **Add a secret-free `Build` job** (`next build` with placeholder env) and make
   it required too. CI could previously pass while the Vercel production build
   broke, because `lint`+`typecheck` do not exercise the Next build/bundling step.

## Why serialize, not per-PR preview branches

A schema-only Supabase preview branch per PR would give full isolation, but:

- **The safety it buys is already covered.** pgTAP files are transactional
  (`begin … rollback`) and the runner _refuses_ any file without a closing
  `ROLLBACK` (ADR 0006), so a run mutates nothing on the shared DB. The only
  residual ADR-0048 objection is _concurrent_ interference + load — and a
  concurrency group of size 1 eliminates concurrency and bounds load to one run.
- **Preview branches cost more and are less proven.** They are billed per branch,
  add minutes of provision/teardown latency to every PR, and our own experience is
  that the with-data clone path fails (only schema-only works) — an extra moving
  part on the critical path of every merge.
- **Serialization is reversible and cheap.** If load ever becomes the bottleneck we
  can graduate the job to preview branches without touching the runner or the
  invariants. Recorded as the follow-up, not built speculatively.

`cancel-in-progress: false` means a queued run waits rather than being killed; the
one edge case is 3+ PRs triggering simultaneously, where GitHub cancels the oldest
_pending_ run in the group (a cancelled required check, re-runnable). Acceptable at
this repo's PR volume; revisit if it bites.

## Consequences

- **Additive-migration self-merge becomes unblocked once the flip lands** — this
  workflow change satisfies the CLAUDE.md hold "until pgTAP is a required CI check".
  The danger-path guard is untouched, so it still red-flags **every** migration PR;
  "unblocked" therefore means the agent may admin-merge its own _additive_ migration
  under the standing grant (memory `autonomous-build-fence`) — NOT a GitHub
  auto-merge — with destructive/irreversible migrations still operator-held
  (break-glass). That CLAUDE.md clause and `docs/policies/change-management.md` §1
  are updated to match.
- **Two new required checks**: `Database (pgTAP)` and `Build`. The flip happens
  **after** this workflow is on `main` and the job is seen green on a real PR — a
  required check that never reports would block all PRs.
- **One new repo secret**: `SUPABASE_ACCESS_TOKEN` (Actions secret; project ref
  stays non-secret in `package.json`). The job cannot pass until the operator adds
  it.
- The pgTAP runner gains a small, unit-tested verdict layer
  (`scripts/pgtap-report.ts`) and a data-driven allowlist; the quarantine list is
  visible in-repo and guarded by a test that every entry maps to a real file.

## Follow-ups

- Re-seed `200-store-inventory-reconciliation` and `221-catalog-categories` to be
  data-independent, then remove them from `known-red.json`.
- If shared-DB load from serialized runs becomes a bottleneck, move `db-test` to a
  per-PR schema-only preview branch.
