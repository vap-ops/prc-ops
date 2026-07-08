begin;
select plan(27);

-- ============================================================================
-- Spec 283 U1 / System Integrity Console (ตรวจระบบ) — the infra + GL money checks.
--   integrity_check_runs         : per-run history (super_admin-only RLS SELECT)
--   run_integrity_checks()       : setof, super_admin-gated reader (console board + "run now" display)
--   run_and_record_integrity()   : super_admin-gated; computes + persists one run, returns run_id (manual "run now")
--   integrity_scan()             : cron-only (revoked from anon+authenticated); records a run, trigger='cron'
--   _integrity_check_results()   : internal compute (revoked from all; invoked only by the definers above / postgres)
-- Registry lists EVERY check across all domains (board = roadmap); U1 implements the GL
-- money checks (tb_global_balanced, entry_balanced_each, source_doc_posted_complete,
-- control_tie_single_feeder, posting_backlog_zero — wrapping gl_reconciliation + 2 NEW),
-- everything else is a metadata-only 'na' (greyed) row until its unit ships.
-- RED before the migration (no table, no functions).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('75000000-0283-0283-0283-750000000283', 'super@s283.local',   '{}'::jsonb),
  ('76000000-0283-0283-0283-760000000283', 'pm@s283.local',      '{}'::jsonb),
  ('72000000-0283-0283-0283-720000000283', 'visitor@s283.local', '{}'::jsonb);
update public.users set role = 'super_admin'     where id = '75000000-0283-0283-0283-750000000283';
update public.users set role = 'project_manager' where id = '76000000-0283-0283-0283-760000000283';
-- visitor keeps the default 'visitor' role.

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ----------------------------------------------------------------------------
-- A. Structure: the history table + its shape + RLS enabled.
-- ----------------------------------------------------------------------------
select has_table('public', 'integrity_check_runs', 'integrity_check_runs table exists');
select has_column('public', 'integrity_check_runs', 'run_id', 'integrity_check_runs.run_id');
select has_column('public', 'integrity_check_runs', 'key', 'integrity_check_runs.key');
select has_column('public', 'integrity_check_runs', 'status', 'integrity_check_runs.status');
select has_column('public', 'integrity_check_runs', 'drift', 'integrity_check_runs.drift');
select has_column('public', 'integrity_check_runs', 'sample', 'integrity_check_runs.sample');
select is(
  (select relrowsecurity from pg_class where relname = 'integrity_check_runs' and relnamespace = 'public'::regnamespace),
  true, 'integrity_check_runs has RLS enabled');

-- ----------------------------------------------------------------------------
-- B. Functions exist + are SECURITY DEFINER.
-- ----------------------------------------------------------------------------
select has_function('public', 'run_integrity_checks', 'run_integrity_checks() exists');
select is((select prosecdef from pg_proc where proname = 'run_integrity_checks'
  and pronamespace = 'public'::regnamespace), true, 'run_integrity_checks is SECURITY DEFINER');
select has_function('public', 'run_and_record_integrity', 'run_and_record_integrity() exists');
select is((select prosecdef from pg_proc where proname = 'run_and_record_integrity'
  and pronamespace = 'public'::regnamespace), true, 'run_and_record_integrity is SECURITY DEFINER');

-- ----------------------------------------------------------------------------
-- C. Privilege lockdown. Reader + manual-record: anon revoked, authenticated kept.
--    integrity_scan (the cron entry) is revoked from anon AND authenticated.
-- ----------------------------------------------------------------------------
select is(has_function_privilege('anon', 'public.run_integrity_checks()', 'EXECUTE'), false, 'anon cannot execute run_integrity_checks');
select is(has_function_privilege('authenticated', 'public.run_integrity_checks()', 'EXECUTE'), true, 'authenticated can execute run_integrity_checks');
select is(has_function_privilege('anon', 'public.run_and_record_integrity()', 'EXECUTE'), false, 'anon cannot execute run_and_record_integrity');
select is(has_function_privilege('authenticated', 'public.run_and_record_integrity()', 'EXECUTE'), true, 'authenticated can execute run_and_record_integrity');
select is(has_function_privilege('anon', 'public.integrity_scan()', 'EXECUTE'), false, 'anon cannot execute integrity_scan (cron-only)');
select is(has_function_privilege('authenticated', 'public.integrity_scan()', 'EXECUTE'), false, 'authenticated cannot execute integrity_scan (cron-only)');

-- ----------------------------------------------------------------------------
-- D. Null-safe gate: a roleless JWT is refused (42501), never falls open.
-- ----------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{}';
select throws_ok($$ select * from public.run_integrity_checks() $$, '42501', null, 'null-role refused: run_integrity_checks');
select throws_ok($$ select public.run_and_record_integrity() $$, '42501', null, 'null-role refused: run_and_record_integrity');

-- ----------------------------------------------------------------------------
-- E. Role gate: super_admin ONLY — project_manager and visitor are refused.
-- ----------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "76000000-0283-0283-0283-760000000283"}';
select throws_ok($$ select * from public.run_integrity_checks() $$, '42501', null, 'project_manager refused: run_integrity_checks (super_admin only)');
set local "request.jwt.claims" = '{"sub": "72000000-0283-0283-0283-720000000283"}';
select throws_ok($$ select * from public.run_integrity_checks() $$, '42501', null, 'visitor refused: run_integrity_checks');

-- ----------------------------------------------------------------------------
-- F. Behavioral (super_admin): the registry lists every check; GL ones are live,
--    the rest are greyed 'na'.
-- ----------------------------------------------------------------------------
set local "request.jwt.claims" = '{"sub": "75000000-0283-0283-0283-750000000283"}';
select cmp_ok((select count(*)::int from public.run_integrity_checks()), '>=', 30, 'registry returns the full board (>= 30 checks)');
select ok(exists(select 1 from public.run_integrity_checks() where key = 'tb_global_balanced'),
  'tb_global_balanced is in the registry');
select isnt((select status from public.run_integrity_checks() where key = 'tb_global_balanced'),
  'na', 'tb_global_balanced is implemented (not greyed)');
select is((select status from public.run_integrity_checks() where key = 'no_double_post'),
  'na', 'no_double_post is greyed (na) until U2');

-- ----------------------------------------------------------------------------
-- G. Runner persists a run.
-- ----------------------------------------------------------------------------
select ok((select public.run_and_record_integrity()) is not null, 'run_and_record_integrity returns a run_id');
select cmp_ok((select count(*)::int from public.integrity_check_runs), '>', 0, 'a recorded run persisted rows into integrity_check_runs');

reset role;

select * from finish();
rollback;
