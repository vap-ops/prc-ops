# Spec 203 — Schedule the GL posting drain (the consumer spec 149 never scheduled)

**Status:** U1 SHIPPED · U2 built (awaiting db:push) — 2026-06-25 (schema). **Driver:** a
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

## U2 — widen the poster gate + remediate the 9 (built)

**Status:** built — adversarially reviewed (4 lenses → migration logic ships safe; one
test-only blocker found + fixed) — awaiting `db:push` OK. **SCHEMA + data remediation.**

The drain outage stranded 9 WP-bound PRs that advanced `purchased → delivered` before any
drain ran; `post_purchase_to_gl` gated on `purchased`/`site_purchased` only, so it refuses
them (`failed`, no entry, ~฿102k). The cron can't rescue them (drains `pending`, not
`failed`, and the poster would still refuse `delivered`).

**Migration `20260813002100`** — `CREATE OR REPLACE post_purchase_to_gl` (re-sourced
verbatim from the LIVE `20260813001000`, only the gate line changed) widening the gate to
the **committed-and-not-voided** set `('purchased','site_purchased','on_route','delivered')`;
still refuses pre-purchase (`requested`/`approved`) and voided (`rejected`/`cancelled`). Plus
a scoped remediation `UPDATE` resetting the 9 `failed` purchase jobs → `pending` so the cron
posts them.

**Why no double-book (verified against ground truth by the review):** the WP-bound enqueue
trigger fires ONLY at the `purchased`/`site_purchased` transition (never `on_route`/`delivered`),
so exactly one purchase job exists per PR; WP-less PRs hit `return null` after the gate (cost
via the receipt poster); reverse-and-repost dedups any re-post; the current divert reverses
directly and no longer relies on the poster refusing `delivered`.

- **pgTAP `225-post-purchase-gate.test.sql`** (plan 14): delivered/on_route WP-bound post
  (the RED discriminators); the delivered re-post leaves exactly one current entry (the
  no-double-book dedup); `purchased` still posts; WP-less posts nothing (suppressed); the
  voided/pre-purchase/null-amount states stay refused. **Review caught a blocker — the
  original seed's `cancelled`/`rejected` rows violated `pr_cancel_shape` / `pr_reject_has_comment`
  and aborted the file before any assertion ran (a silent no-op); fixed by adding
  `cancelled_at` / `decision_comment`.**

**Apply order (the concurrency note):** after `db:push`, run a single operator-context
`drain_gl_posting(100)` to post the 9 deterministically (rather than leaning on the unguarded
every-minute cron) — same one-off path that drained the first 18 cleanly.

## Discovered follow-ups (NOT this unit — own decisions)

1. **Drain concurrency.** `drain_gl_posting` has no `FOR UPDATE SKIP LOCKED`; an every-minute
   cron could overlap if a run outlives the minute. Reverse-and-repost makes a double-post
   self-correcting for now; adding `SKIP LOCKED` is a small hardening unit.
2. **Test hardening sweep (now concrete).** Table-wide-count GL pgTAP tests break as the GL
   posts real data — the prune author flagged `82/84/88`; the B drain tripped `81-journal`
   test 28 (counts `journal_posted` audit rows table-wide → `have 20 want 2`), and U2 posting
   the 9 will trip more. Scope every such count to its own fixture (by `source_id` / entry id),
   backlog-immune. One sweep, after U2 posts the 9 so the full set is visible. (`85/86/87` were
   the same class — now green because the backlog drained, but still total-count-fragile.)
