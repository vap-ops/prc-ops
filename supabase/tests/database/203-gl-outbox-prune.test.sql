begin;
select plan(7);

-- ============================================================================
-- gl_posting_outbox retention — prune_gl_posting_outbox(days).
-- Mirrors prune_notification_outbox (20260625000300): the drainer only flips
-- status and never deletes, so the GL posting queue grows forever. Prune only
-- TERMINAL rows ('posted', 'skipped') older than the window; keep 'pending' /
-- 'posting' (in flight) and 'failed' (retryable). Age keyed on created_at.
-- Zero user access (worker/cron only) — anon + authenticated cannot execute.
-- ============================================================================

-- Fixtures (owner context; the table is zero-grant). Fixed ids to assert on.
insert into public.gl_posting_outbox (id, source_table, source_id, source_event, status, created_at) values
  ('d0000000-0000-4000-8000-000000000203', 'test_prune', 'a0000000-0000-4000-8000-000000000203',
   'test', 'posted',  now() - interval '40 days'),  -- old terminal  -> REMOVED
  ('d1000000-0000-4000-8000-000000000203', 'test_prune', 'a0000000-0000-4000-8000-000000000203',
   'test', 'skipped', now() - interval '40 days'),  -- old terminal  -> REMOVED
  ('d2000000-0000-4000-8000-000000000203', 'test_prune', 'a0000000-0000-4000-8000-000000000203',
   'test', 'posted',  now() - interval '1 day'),    -- recent terminal -> KEPT
  ('d3000000-0000-4000-8000-000000000203', 'test_prune', 'a0000000-0000-4000-8000-000000000203',
   'test', 'pending', now() - interval '40 days'),  -- in flight     -> KEPT
  ('d4000000-0000-4000-8000-000000000203', 'test_prune', 'a0000000-0000-4000-8000-000000000203',
   'test', 'failed',  now() - interval '40 days'),  -- retryable     -> KEPT
  ('d5000000-0000-4000-8000-000000000203', 'test_prune', 'a0000000-0000-4000-8000-000000000203',
   'test', 'posting', now() - interval '40 days');  -- in flight     -> KEPT

select has_function('public', 'prune_gl_posting_outbox', 'prune_gl_posting_outbox exists');
select is(has_function_privilege('anon', 'public.prune_gl_posting_outbox(integer)', 'EXECUTE'),
  false, 'anon cannot execute prune_gl_posting_outbox');
select is(has_function_privilege('authenticated', 'public.prune_gl_posting_outbox(integer)', 'EXECUTE'),
  false, 'authenticated cannot execute prune_gl_posting_outbox');

-- Isolate the fixtures. prune_gl_posting_outbox() operates on the WHOLE table and
-- returns a GLOBAL delete count, so asserting that count == 2 silently breaks the
-- moment any REAL terminal row ages past the window: a 'posted' row created
-- 2026-06-23 did exactly that on 2026-07-24 (prune returned 3), and because pgTAP
-- runs on the merge ref this unpinned red ejected every code-only lane from the
-- merge queue rather than showing as a failing PR check. Drop the non-fixture rows
-- in-txn (rolled back with the test, no trigger side effects on this queue table)
-- so the count assertions below assert on the SEEDED rows, never a global count of
-- a table the app writes to.
delete from public.gl_posting_outbox where source_table <> 'test_prune';

-- Prune the 30-day window: only the two OLD terminal rows go.
select is((select public.prune_gl_posting_outbox(30)), 2,
  'prune removes the two old terminal (posted/skipped) rows');
select is(
  (select count(*)::int from public.gl_posting_outbox
     where id in ('d0000000-0000-4000-8000-000000000203','d1000000-0000-4000-8000-000000000203')),
  0, 'the old posted + skipped rows are gone');
select is(
  (select count(*)::int from public.gl_posting_outbox
     where id in ('d2000000-0000-4000-8000-000000000203','d3000000-0000-4000-8000-000000000203',
                  'd4000000-0000-4000-8000-000000000203','d5000000-0000-4000-8000-000000000203')),
  4, 'recent posted + pending + failed + posting are kept');
select is((select public.prune_gl_posting_outbox(30)), 0,
  'a second prune removes nothing (idempotent)');

select * from finish();
rollback;
