# Spec 203 — Schedule the GL posting drain (the consumer spec 149 never scheduled)

**Status:** U1 built — 2026-06-25 (schema — flag before `db:push`). **Driver:** a
2026-06-25 dig into three "pre-existing" pgTAP failures (`85-client-billing` /
`86-retention-release` / `87-wht-certificates`, all the `is(drain_gl_posting(100), 1)`
assert) found a **production gap**: `drain_gl_posting` (spec 149 / ADR 0057, mig
`20260743000200`, comment _"Called on a schedule by the worker/cron"_) was **never
scheduled**. Live `cron.job` carried `gl-posting-outbox-**prune**` but no
`gl-posting-**drain**`; the worker (`worker/src/index.ts`) is PDF-reports only. So
`gl_posting_outbox` enqueued (the `20260741000100` triggers) but never drained — **27
`purchase_requests` jobs sat `pending` since 2026-06-23, the in-app GL posting nothing.**
The failing tests are the canary (they drain the whole queue → return ≫1).

## U1 — the drain cron (built)

**Migration `20260813002000_gl_posting_drain_schedule.sql`** — a `pg_cron` job, same
idempotent unschedule-then-schedule shape as `gl-posting-outbox-prune` (`20260811000200`):
`cron.schedule('gl-posting-drain', '* * * * *', 'select public.drain_gl_posting(100)')`.
Unlike `notification-drain` (which needs `pg_net`→the app because sending hits
LINE/Telegram), `drain_gl_posting` is **pure SQL** — pg_cron invokes it directly, no app
endpoint or Vault secret. Every minute (matching `notification-drain`) keeps the window
between a PR's `purchased` enqueue and the poster's status-gated post short.

**Validated 2026-06-25:** an operator-approved one-off `select drain_gl_posting(100)` (same
postgres/cron execution context) posted **18** backlog jobs cleanly → the direct-invocation
approach works. That manual drain also re-greened `85/86/87` (the `pending` backlog is gone),
so this cron makes that durable (the outbox stays drained instead of re-accumulating).

- **pgTAP `224-gl-posting-drain-schedule.test.sql`** (plan 3): an active `gl-posting-drain`
  cron exists, its command is `select public.drain_gl_posting(100)`, and the scheduled
  `drain_gl_posting(integer)` exists. RED pre-apply (no such cron), GREEN post-apply.

### Verification

`db:push` (after operator OK — schema) → `db:test`: `224` green AND `85/86/87` now green (the
backlog was drained). No app/code change → no lint/typecheck/vitest impact.

## Discovered follow-ups (NOT this unit — own decisions)

1. **The 9 unposted `delivered` purchases (~฿102k).** During the outage, 9 WP-bound PRs
   advanced `purchased → delivered`; `post_purchase_to_gl` gates on
   `status in ('purchased','site_purchased')` and now refuses them (`failed`, no journal
   entry). The cron does **not** rescue them (it drains `pending`, not `failed`, and the
   poster would still refuse `delivered`). Fix = relax the poster's status gate to post a
   purchase that has progressed past `purchased` (purchased/shipped/delivered — but not
   requested/approved/rejected/cancelled), then re-enqueue/re-post the 9. A poster-logic
   migration + careful double-book check (these are WP-bound with no receipt path, so safe).
2. **Drain concurrency.** `drain_gl_posting` has no `FOR UPDATE SKIP LOCKED`; an every-minute
   cron could overlap if a run outlives the minute. Reverse-and-repost makes a double-post
   self-correcting for now; adding `SKIP LOCKED` is a small hardening unit.
3. **Test hardening.** `85/86/87` assert the _total_ drain count, so they only pass against an
   empty outbox. They should assert their _own_ job posted (its outbox row → `posted` / its
   journal entry exists) — backlog-immune.
