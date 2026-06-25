begin;
select plan(3);

-- ============================================================================
-- Spec 203 / ADR 0057 — the GL posting drain must be SCHEDULED. drain_gl_posting
-- was built (20260743000200) but never put on a cron; the outbox enqueued and
-- never drained (27 pending purchase_requests since 2026-06-23). This pins the
-- schedule so the regression can't silently recur. Read-only against cron.job.
-- ============================================================================

select is(
  (select count(*)::int from cron.job where jobname = 'gl-posting-drain' and active),
  1, 'an active gl-posting-drain cron job exists');

select is(
  (select command from cron.job where jobname = 'gl-posting-drain'),
  'select public.drain_gl_posting(100)', 'it invokes drain_gl_posting(100)');

-- The drain it schedules still exists with the expected signature.
select has_function('public', 'drain_gl_posting', ARRAY['integer'],
  'drain_gl_posting(integer) exists (the scheduled consumer)');

select * from finish();
rollback;
