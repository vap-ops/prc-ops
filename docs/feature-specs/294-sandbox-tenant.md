# Spec 294 — Sandbox tenant (designer/tester environment)

**Status:** U1 shipped (seed lib + seeder + sync workflow + banner)
**Date:** 2026-07-11
**Decision trail:** operator 2026-07-11 — users are employees; dedicated second
Supabase project (ADR 0035 instance-per-customer pattern); build greenlit.

## Problem

A UX/UI designer and a tester are onboarding. They must be able to see and
exercise the whole app, but must not touch production data (PDPA-sensitive
worker PII, real GL). Investigation (2026-07-11) established that no prod-side
mechanism is safe: view-as (spec 274) is a TS-layer skin with full super_admin
DB authority underneath; roles are global so a "test project" cannot contain
writes; a read-only role serves only the designer and over-exposes PII.

## Solution — a fully isolated sandbox tenant

- **Sandbox Supabase project** `mvozffwvkruzariteosf` (same org/region as prod,
  created 2026-07-11). Runs the same committed migrations; holds ONLY synthetic
  data. Full-power accounts are harmless here by construction.
- **Sandbox Vercel project** (operator step): same GitHub repo, deploys `main`,
  env points at the sandbox Supabase project + `NEXT_PUBLIC_APP_ENV=sandbox`.

### Freshness (the operator's core requirement)

| Axis   | Mechanism                                                          | Lag         |
| ------ | ------------------------------------------------------------------ | ----------- |
| Code   | sandbox Vercel project auto-deploys `main` on every merge          | ~1 build    |
| Schema | `sandbox-sync.yml` replays committed migrations on every main push | ~2 min      |
| Data   | same workflow re-runs the idempotent seeder nightly (02:30 ICT)    | ≤1 day      |
| Proof  | `SandboxBanner` (bottom bar) shows env + deployed commit sha       | at a glance |

### Pieces

- `src/lib/sandbox/seed-data.ts` — pure synthetic dataset (12 role personas,
  2 projects, 24 WPs over real taxonomy codes, 8 workers, 5 site issues, labor
  plan, photo plan). Invariants pinned by `tests/unit/sandbox-seed-data.test.ts`.
- `scripts/seed-sandbox.ts` (`pnpm seed:sandbox`) — idempotent applier: ensures
  buckets, auth users (+role promotion), projects, memberships,
  project_categories (per-project clone of work_categories — WPs bind to these,
  not the global taxonomy), WPs, workers, site issues, labor logs
  (`day_fraction` enum required by the tombstone check), and solid-colour PNG
  photos uploaded to Storage. Natural-key matched — re-runs add nothing.
  Refuses to run against the prod ref, hardcoded.
- `.github/workflows/sandbox-sync.yml` — push-to-main schema sync + nightly
  seed + manual `full_reset` dispatch (`db reset --linked` against the
  hardcoded sandbox ref, then re-seed). Cannot reach prod: the link step pins
  the sandbox ref.
- `SandboxBanner` — renders only when `NEXT_PUBLIC_APP_ENV=sandbox`.

### Reset semantics

Append-only tables (labor_logs, photo_logs, …) block UPDATE/DELETE even for
service_role, so the nightly seeder only ever tops up canonical rows. The
labor plan's 10-day window slides with the calendar, so each nightly run adds
that day's rows — the sandbox accrues realistic labor history (~40 rows/day,
daily-paid workers only) between resets. A true clean slate = run the workflow
dispatch with `full_reset=true` (sandbox-only schema drop + full migration
replay + re-seed). Tester-created rows otherwise persist until the next full
reset — acceptable by design.

## Operator runbook (one-time)

1. **GitHub secrets** (repo → Settings → Secrets → Actions):
   `SANDBOX_DB_PASSWORD` and `SANDBOX_SERVICE_ROLE_KEY` (values: operator copy
   from `D:\claude\projects\prc-ops\.sandbox.env` on the cloud PC).
   `SUPABASE_ACCESS_TOKEN` already exists (pgTAP).
2. **Vercel**: Add Project → import the same repo → name `prc-ops-sandbox` →
   env vars: `NEXT_PUBLIC_SUPABASE_URL=https://mvozffwvkruzariteosf.supabase.co`,
   `NEXT_PUBLIC_SUPABASE_ANON_KEY=<sandbox anon>`,
   `SUPABASE_SERVICE_ROLE_KEY=<sandbox service>`, `NEXT_PUBLIC_APP_ENV=sandbox`,
   LINE vars may be copied or left unset (login via magiclink below) →
   enable "Automatically expose System Environment Variables" (commit sha for
   the banner).
3. **Logins**: LINE OAuth needs a callback registration per origin (no
   wildcards). Two sandbox-only paths (both 404 unless `NEXT_PUBLIC_APP_ENV=sandbox`):
   - **U4 picker (preferred, reusable):** forward the **stable, tokenless** link
     `https://prc-ops-sandbox.vercel.app/auth/sandbox-link`. The GET renders a
     role-picker that mints nothing (so chat-app link-preview crawlers can't
     consume it — the defect U2 hit); the human's button POST mints a session
     server-side for the chosen seed persona. Reusable forever, survives
     forwarding. `?as=<personaKey>` deep-links one role.
   - **U2 token (direct):** `?token_hash=<minted>` for a CLI-minted one-time
     login (still used by the re-mint recipe). One-time — a preview crawler
     consumes it, so prefer the picker for anything forwarded.
   - Both allowlist to `SEED_PERSONAS` only (`sandbox-admin@` = super_admin,
     `sandbox-sa1@` = site_admin, …). Optional later: register the stable URL in
     a separate LINE dev channel.

   **Accepted risk (U4):** the POST is unauthenticated + CSRF-tokenless and mints
   a session for a fixed sandbox persona (incl. super_admin). Login-CSRF is
   possible but negligible — synthetic data, sandbox-only cookies, prod is 404.
   Holds ONLY while the sandbox is never pointed at a real tenant/DB.
   **Follow-up flagged:** the danger-path CI guard's deny-regex covers
   `src/lib/db/admin.ts` + `src/lib/auth/**` but NOT `src/app/auth/**`, so a
   session-minting route under `/app/auth` auto-merges without an operator gate.
   Widen the guard (own governance-file unit).

## v1 limits (deliberate)

- No GL/money seed rows (rental batches, receipts) — the outbox drainer and
  cron workers do not run against the sandbox, so money flows would sit
  half-posted. Money screens show zeros. Follow-up if testers need GL flows:
  point a second worker instance at the sandbox.
- ~~No deliverable↔WP binding, daily plans, or PR seeding~~ — **U3 (v1.1) added
  all three**: deliverables D01–D04 per project with 18 WP bindings
  (null-guarded so tester edits survive re-seeds), 10 purchase requests in
  GL-safe states (requested/approved — posting happens at receipt), and
  tomorrow's daily work plans (spec 273 board). Extend further as needs surface.
- Notifications accumulate in `notification_outbox` unsent (no drainer) —
  harmless, visible for testing.
