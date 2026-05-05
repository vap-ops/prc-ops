# ADR 0006: Database testing via pgTAP against linked remote project

Date: 2026-05-05
Status: Accepted

## Context

We do not run Docker locally (multi-machine workflow, remote-first). The local Supabase stack is therefore unavailable, so we cannot rely on `supabase start` plus a local pgTAP runner to drive database tests during day-to-day development.

## Decision

Database tests are pgTAP SQL files under `supabase/tests/database/`, executed via `pnpm exec supabase test db --linked` against the linked remote project. Every test file wraps its work in `BEGIN; ... ROLLBACK;` so no rows are committed. Test runs that fail to roll back are a critical bug.

## Consequences

- Tests require network access and a linked CLI session; CI must `supabase login` and `supabase link` before running them.
- Tests are slower than local pgTAP (~50–200ms per assertion vs ~5ms local).
- When Docker becomes available on a workstation, local pgTAP via `supabase start` is a strict superset and can be added without changing the test files themselves.
