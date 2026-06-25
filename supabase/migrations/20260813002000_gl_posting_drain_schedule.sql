-- Spec 203 / ADR 0057 — schedule the GL posting DRAIN (the consumer spec 149 built
-- but never scheduled).
--
-- As-built finding (2026-06-25): drain_gl_posting (20260743000200, "Called on a
-- schedule by the worker/cron") had NO scheduler in prod — cron.job carried
-- gl-posting-outbox-PRUNE (20260811000200) but not the DRAIN, and the worker
-- (worker/src/index.ts) is PDF-reports only. So gl_posting_outbox enqueued (via the
-- 20260741000100 triggers) but never drained: 27 purchase_requests jobs sat pending
-- since 2026-06-23, the in-app GL (ADR 0057) posting nothing. The fragility surfaced
-- as the pgTAP 85/86/87 "drain posts the X = 1" failures (they drain the whole queue).
--
-- Fix: a pg_cron job calling drain_gl_posting directly. Unlike notification-drain
-- (20260615000200, which needs pg_net→the app because sending hits LINE/Telegram),
-- drain_gl_posting is PURE SQL (it posts journal entries in-DB via the per-source
-- posters), so pg_cron invokes it directly — no app endpoint, no Vault secret. Same
-- idempotent unschedule-then-schedule shape as gl-posting-outbox-prune. Every minute
-- (matching notification-drain) keeps the window between a PR's 'purchased' enqueue
-- and the poster's status-gated post short.
--
-- Validated 2026-06-25: a manual `select drain_gl_posting(100)` (operator-approved
-- one-off, via the same postgres/cron execution context) posted 18 backlog jobs
-- cleanly — confirming this direct-invocation approach works.
--
-- Seams (separate follow-ups, NOT this migration):
--   * post_purchase_to_gl gates on status in ('purchased','site_purchased'); 9
--     backlog PRs advanced to 'delivered' during the outage and now fail to post
--     (~฿102k WP-bound, no entry). Relaxing the gate + re-posting those 9 is its own
--     unit.
--   * drain_gl_posting has no FOR UPDATE SKIP LOCKED; a run outliving the minute
--     could overlap. Concurrency-hardening is its own unit (reverse-and-repost makes
--     a double-post self-correcting in the meantime).

do $$
begin
  if exists (select 1 from cron.job where jobname = 'gl-posting-drain') then
    perform cron.unschedule('gl-posting-drain');
  end if;
  perform cron.schedule(
    'gl-posting-drain',
    '* * * * *',
    'select public.drain_gl_posting(100)');
end;
$$;
