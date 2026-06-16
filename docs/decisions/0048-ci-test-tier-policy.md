# ADR 0048 — CI test-tier policy

- Status: Accepted (2026-06-16).
- Context: `.github/workflows/ci.yml` runs `lint`, `typecheck`, `test` on the root
  package only. Three gaps: (a) the `worker/` package — its own `package.json`,
  lockfile, typecheck and unit suite — is never exercised in CI, so a worker
  regression only surfaces at deploy; (b) `pnpm db:test` (pgTAP) and
  `pnpm test:e2e` are deliberately local-only but that boundary lives only in
  CLAUDE.md prose; (c) there is no recorded rule for _where_ each test tier runs.
  CLAUDE.md already states CI runs only lint/typecheck/test and that e2e/db/spike
  are local — this ADR makes that policy explicit and closes the worker gap.

## Decisions

1. **Tier A — always in CI, no secrets.** App `lint` + `typecheck` + `test`
   (existing), **plus a new `worker` job**: `pnpm install --frozen-lockfile` +
   `pnpm typecheck` + `pnpm test` in `worker/`. The worker unit tests cover pure
   PDF/report logic and never reach a live Supabase, so the job needs no
   credentials. The spec-123 db-types drift test is part of the app `test` job
   automatically.

2. **Tier B — required LOCAL gates, not auto-CI.** `pnpm db:test` (pgTAP against
   the linked **shared** remote) and `pnpm test:e2e` (needs a running app +
   Supabase + LINE auth). Running these on every PR would couple all CI to the
   live project and leak credentials into Actions. They stay developer-run before
   push, as CLAUDE.md already directs.

3. **Tier C — manual, secret-gated.** A `workflow_dispatch` `db-test` job is
   defined but **disabled** until the operator provisions GitHub Actions secrets
   (`SUPABASE_ACCESS_TOKEN`; project ref is already non-secret in
   `package.json`). The pgTAP runner refuses any file lacking a closing `ROLLBACK`
   (ADR 0006), so a manual run leaves no residue in the shared DB — but it still
   adds load, hence manual-only.

## Why not the alternatives

- **Run `db:test` on every PR**: couples CI to one shared remote (load + secret
  exposure + cross-session interference). Rejected for auto-CI; allowed as manual
  Tier C.
- **Run `test:e2e` in CI now**: needs a full app + Supabase + LINE mock; heavy and
  flaky before that harness exists. Deferred (recorded follow-up).
- **Leave the worker out of CI**: keeps the current blind spot where a worker
  type/logic break ships unnoticed. Rejected — the worker job is cheap and
  secret-free.

## Consequences

CI gains one secret-free `worker` job; the test-tier boundary is now a recorded
rule instead of prose. The Tier C `db:test` job is inert until the operator adds
secrets. Implemented by **spec 124**.
