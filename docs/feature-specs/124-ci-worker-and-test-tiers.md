# Spec 124 — CI: worker job + codified test-tier policy

**Status:** PROPOSED (2026-06-16) — implements **ADR 0048**.
**Type:** CI config + docs. No app/DB/behavior change.
**Origin:** codebase-understanding review (2026-06-16). `.github/workflows/ci.yml`
runs only `lint`, `typecheck`, `test` on the **root** package. The `worker/`
package (its own `package.json`, own lockfile) is never built or tested in CI;
`test:e2e`, `db:test`, and the spike suite are local-only by design but that
policy is recorded only as CLAUDE.md prose, nowhere enforced.

## Decision (ADR 0048, summarized)

1. **CI gains a `worker` job** — no secrets needed. The worker unit tests
   (`worker/tests/unit/report.test.ts`) exercise pure PDF/report logic and do not
   touch a live Supabase. The job: `working-directory: worker`,
   `pnpm install --frozen-lockfile` → `pnpm typecheck` → `pnpm test`.
2. **The db-types drift test (spec 123) needs no new wiring** — it runs inside the
   existing app `pnpm test` job automatically once it exists.
3. **`db:test` and `test:e2e` stay OUT of auto-CI.** They need shared-remote
   credentials / a running app / LINE auth and would couple every PR to the live
   project. They remain **required local gates** (documented). A manual
   `workflow_dispatch` `db:test` job is specced but left **disabled** pending
   operator-provisioned GitHub Actions secrets.

## Test first

CI config is YAML, not app code — it has no unit test. The "test" is that the new
job runs green. The TDD obligation is satisfied by spec 123's drift test (which
this spec causes CI to run) and by the worker's existing unit suite. No new app
production code is introduced here.

## Implementation

1. Add a `worker` job to `.github/workflows/ci.yml`:
   - `actions/checkout@v4`, `pnpm/action-setup@v4`, `actions/setup-node@v4`
     (node 22, pnpm cache).
   - `working-directory: worker`: `pnpm install --frozen-lockfile`, then
     `pnpm typecheck`, then `pnpm test`.
2. Leave the existing `ci` (app) job unchanged.
3. Add a commented/disabled `workflow_dispatch` `db-test` job stub with a
   `# requires SUPABASE_ACCESS_TOKEN + project-ref secrets` note, so the operator
   can enable it after provisioning secrets (no secret is referenced until then,
   so CI stays green).

## Operator follow-up (blocks the db:test CI part — cannot be done autonomously)

- Add GitHub Actions repository secrets: `SUPABASE_ACCESS_TOKEN` (+ the project
  ref is already public in `package.json`), then enable the `db-test`
  `workflow_dispatch` job. Until then `pnpm db:test` stays a local gate.
- `test:e2e` in CI is a larger follow-up (needs a running app + Supabase + LINE
  mock) — recorded, not scoped here.

## Verification checklist

1. The `worker` job mirrors a local `cd worker && pnpm install --frozen-lockfile
&& pnpm typecheck && pnpm test` — all green.
2. `.github/workflows/ci.yml` parses (valid YAML; jobs independent).
3. The existing app job and `pnpm test` (now including the drift test) stay green.
