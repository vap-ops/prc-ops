begin;
select plan(17);

-- ============================================================================
-- Spec 58 / ADR 0042 — update_project_settings RPC: back-office (pm/super)
-- edits project name + status; code immutable; column-scoped by definition.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('22222222-2222-2222-2222-22222222eeee', 'sa@ps-test.local',      '{}'::jsonb),
  ('33333333-3333-3333-3333-33333333eeee', 'pm@ps-test.local',      '{}'::jsonb),
  ('44444444-4444-4444-4444-44444444eeee', 'visitor@ps-test.local', '{}'::jsonb);

update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-22222222eeee';
update public.users set role = 'project_manager' where id = '33333333-3333-3333-3333-33333333eeee';
-- 4444…eeee keeps default 'visitor'.

insert into public.projects (id, code, name, status) values
  ('cccccccc-cccc-cccc-cccc-cccccccc3333', 'PRC-TEST-PS', 'PS fixture project', 'active');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- B. Catalog pins.
select has_function('public', 'update_project_settings',
  'update_project_settings RPC exists');
select is(
  (select prosecdef from pg_proc
    where proname = 'update_project_settings'
      and pronamespace = 'public'::regnamespace),
  true, 'RPC is SECURITY DEFINER');
select ok(
  (select 'search_path=public' = any(proconfig) from pg_proc
    where proname = 'update_project_settings'
      and pronamespace = 'public'::regnamespace),
  'RPC pins search_path = public (ADR 0011 checklist)');
-- Spec 72: signature is now 4-arg (p_notes text default null).
select is(
  has_function_privilege('authenticated',
    'public.update_project_settings(uuid, text, public.project_status, text)', 'EXECUTE'),
  true, 'authenticated may execute the RPC');
select is(
  has_function_privilege('anon',
    'public.update_project_settings(uuid, text, public.project_status, text)', 'EXECUTE'),
  false, 'anon may NOT execute the RPC');

-- C. Role-sim.
set local role authenticated;

-- C.1 PM edits name + status.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-33333333eeee"}';
select lives_ok(
  $$ select public.update_project_settings(
       'cccccccc-cccc-cccc-cccc-cccccccc3333', '  PS renamed  ', 'on_hold') $$,
  'PM updates name + status via the RPC');

-- Spec 72: PM writes a project note via the 4-arg RPC (same name/status, so
-- section D's outcome checks still hold). Then a blank note clears it.
select is(
  public.update_project_settings(
    'cccccccc-cccc-cccc-cccc-cccccccc3333', 'PS renamed', 'on_hold', 'จดบันทึกโครงการ'),
  true, 'PM sets a project note via the RPC');
select is(
  (select notes from public.projects where id = 'cccccccc-cccc-cccc-cccc-cccccccc3333'),
  'จดบันทึกโครงการ', 'the project note landed');
select is(
  public.update_project_settings(
    'cccccccc-cccc-cccc-cccc-cccccccc3333', 'PS renamed', 'on_hold', '   '),
  true, 'PM clears the note with a blank value (returns true)');
select is(
  (select notes from public.projects where id = 'cccccccc-cccc-cccc-cccc-cccccccc3333'),
  null::text, 'a blank note clears the column to null');

-- C.2 Unknown project id returns false (no row leak, no exception).
select is(
  public.update_project_settings(
    'cccccccc-cccc-cccc-cccc-cccccccc9999', 'whatever', 'active'),
  false, 'unknown project id returns false');

-- C.3 Blank name rejected in the function (defense in depth).
select throws_ok(
  $$ select public.update_project_settings(
       'cccccccc-cccc-cccc-cccc-cccccccc3333', '   ', 'active') $$,
  '22023', null, 'blank name raises 22023');

-- C.4 SA refused — back office only (ADR 0042 §2).
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-22222222eeee"}';
select throws_ok(
  $$ select public.update_project_settings(
       'cccccccc-cccc-cccc-cccc-cccccccc3333', 'SA rename', 'active') $$,
  '42501', null, 'site_admin cannot call the RPC');

-- C.5 Visitor refused.
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-44444444eeee"}';
select throws_ok(
  $$ select public.update_project_settings(
       'cccccccc-cccc-cccc-cccc-cccccccc3333', 'visitor rename', 'active') $$,
  '42501', null, 'visitor cannot call the RPC');

reset role;

-- D. Outcomes: PM write landed trimmed; code untouched.
select is(
  (select name from public.projects where id = 'cccccccc-cccc-cccc-cccc-cccccccc3333'),
  'PS renamed', 'name landed TRIMMED; later refused calls changed nothing');
select is(
  (select status from public.projects where id = 'cccccccc-cccc-cccc-cccc-cccccccc3333'),
  'on_hold'::public.project_status, 'status landed');
select is(
  (select code from public.projects where id = 'cccccccc-cccc-cccc-cccc-cccccccc3333'),
  'PRC-TEST-PS', 'code is untouched — immutable from the app (ADR 0042 §3)');

select * from finish();
rollback;
