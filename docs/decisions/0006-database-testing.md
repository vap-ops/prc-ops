# ADR 0006: Database testing via pgTAP against linked remote project

Date: 2026-05-05
Status: Accepted

## Context

We do not run Docker locally (multi-machine workflow, remote-first). The local Supabase stack is therefore unavailable, so we cannot rely on `supabase start` plus a local `pg_prove` runner to drive database tests during day-to-day development.

`supabase test db --linked` would run pgTAP against the linked remote DB, but its implementation pulls a Dockerised `pg_prove` image even when `--linked` is used. With Docker absent, that runner is unworkable.

## Decision

Database tests are pgTAP SQL files under `supabase/tests/database/`, executed against the linked remote project via `supabase db query --linked` (Supabase Management API — no Docker required). The runner is `scripts/run-pgtap.ts`, invoked as `pnpm db:test`.

Each test file is authored in standard pgTAP form (`begin; select plan(N); ... ; select * from finish(); rollback;`). The runner transforms each file at load time, redirecting every assertion `select` into a temp collector table and emitting the final TAP stream as a single result set (a workaround for the Management API returning only the last result set in a multi-statement script). The transaction is still wrapped in `BEGIN; … ROLLBACK;` so no rows commit.

The runner ensures the `pgtap` extension is enabled (`create extension if not exists pgtap with schema extensions`) before running tests.

## Consequences

- Tests require network access and a linked CLI session; CI must `supabase login` and `supabase link` before running them.
- Tests are slower than local pgTAP (~50–200ms per assertion vs ~5ms local).
- The transform layer is a small dependency: any new pgTAP idiom (e.g. `$tag$` dollar-quoting beyond plain `$$`, multi-line DO blocks at the top level) must be considered when extending the runner.
- When Docker becomes available on a workstation, switching to local `pg_prove` is straightforward — the test files themselves are unchanged.
