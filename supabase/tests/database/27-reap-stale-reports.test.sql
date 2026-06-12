begin;
select plan(11);

-- ============================================================================
-- Spec 39 / ADR 0040 — stale-report reaper. Stale 'processing' rows flip
-- to 'failed' (freeing the duplicate guard); everything else untouched.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-3333-3333-3333-333333335bbb', 'pm@reap-test.local', '{}'::jsonb);
update public.users set role = 'project_manager' where id = '33333333-3333-3333-3333-333333335bbb';

insert into public.projects (id, code, name) values
  ('cccccccc-cccc-cccc-cccc-cccccccc5bbb', 'PRC-TEST-REAP', 'Reaper fixture project');

insert into public.reports (id, project_id, status, requested_by) values
  ('a1000000-0000-4000-8000-000000005bbb',
   'cccccccc-cccc-cccc-cccc-cccccccc5bbb', 'processing',
   '33333333-3333-3333-3333-333333335bbb'),
  ('a2000000-0000-4000-8000-000000005bbb',
   'cccccccc-cccc-cccc-cccc-cccccccc5bbb', 'processing',
   '33333333-3333-3333-3333-333333335bbb'),
  ('a3000000-0000-4000-8000-000000005bbb',
   'cccccccc-cccc-cccc-cccc-cccccccc5bbb', 'requested',
   '33333333-3333-3333-3333-333333335bbb'),
  ('a4000000-0000-4000-8000-000000005bbb',
   'cccccccc-cccc-cccc-cccc-cccccccc5bbb', 'complete',
   '33333333-3333-3333-3333-333333335bbb');

-- Backdate ONE processing row past the cutoff. The touch trigger would
-- overwrite a manual updated_at, so user triggers are disabled for the
-- backdate only (rollback transaction — nothing persists).
alter table public.reports disable trigger user;
update public.reports
   set updated_at = now() - interval '30 minutes'
 where id = 'a1000000-0000-4000-8000-000000005bbb';
alter table public.reports enable trigger user;

-- ============================================================================
-- B. Catalog + security pins.
-- ============================================================================

select has_function('public', 'reap_stale_reports', 'reap_stale_reports exists');
select ok(
  not has_function_privilege('authenticated', 'public.reap_stale_reports(integer)', 'execute'),
  'authenticated cannot execute the reaper');
select ok(
  not has_function_privilege('anon', 'public.reap_stale_reports(integer)', 'execute'),
  'anon cannot execute the reaper');
select is(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'reap_stale_reports'
      and p.prosecdef
      and array_to_string(p.proconfig, ',') like '%search_path=public%'),
  1, 'reaper is SECURITY DEFINER with pinned search_path');

-- ============================================================================
-- C. Behavior.
-- ============================================================================

select is(
  (select public.reap_stale_reports()),
  1, 'reap flips exactly the one stale processing row');

select is(
  (select status::text from public.reports
     where id = 'a1000000-0000-4000-8000-000000005bbb'),
  'failed', 'stale processing row is failed');
select ok(
  (select error like '%reaped%' from public.reports
     where id = 'a1000000-0000-4000-8000-000000005bbb'),
  'reaped row carries the reaper error message');

select is(
  (select status::text from public.reports
     where id = 'a2000000-0000-4000-8000-000000005bbb'),
  'processing', 'fresh processing row untouched');
select is(
  (select status::text from public.reports
     where id = 'a3000000-0000-4000-8000-000000005bbb'),
  'requested', 'requested row untouched (sweeper territory, not reaper)');
select is(
  (select status::text from public.reports
     where id = 'a4000000-0000-4000-8000-000000005bbb'),
  'complete', 'terminal row untouched');

-- ============================================================================
-- D. Schedule pin.
-- ============================================================================

select is(
  (select count(*)::int from cron.job
     where jobname = 'report-reaper' and schedule = '*/5 * * * *'),
  1, 'report-reaper cron job scheduled every 5 minutes');

select * from finish();
rollback;
