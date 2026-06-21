begin;
select plan(20);

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

-- Spec 143 / ADR 0056: visibility is now membership-scoped — enrol the PM so
-- the post-write `select notes …` reads under the PM session stay visible.
insert into public.project_members (project_id, user_id, added_by)
  select p.id, u.id, u.id from public.projects p, public.users u
   where p.code in ('PRC-TEST-PS')
     and u.id in (select au.id from auth.users au where au.email like '%@ps-test.local')
     and u.role in ('project_manager', 'site_admin')
on conflict (project_id, user_id) do nothing;

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
-- Spec 79 + 174: signature is now 11-arg (added site_address,
-- planned_completion_date, budget, start_date, project_lead_id, project_type, and
-- gmap_url). 3-/4-arg calls below still resolve via defaults; the privilege pin
-- tracks the current full signature.
select is(
  has_function_privilege('authenticated',
    'public.update_project_settings(uuid, text, public.project_status, text, text, date, numeric, date, uuid, public.project_type, text)', 'EXECUTE'),
  true, 'authenticated may execute the RPC');
select is(
  has_function_privilege('anon',
    'public.update_project_settings(uuid, text, public.project_status, text, text, date, numeric, date, uuid, public.project_type, text)', 'EXECUTE'),
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

-- C.1b Spec 174: PM attaches a Google-Maps link (named arg); it lands. A
-- non-https value is rejected by the column CHECK (23514).
select is(
  public.update_project_settings(
    'cccccccc-cccc-cccc-cccc-cccccccc3333', 'PS renamed', 'on_hold',
    p_gmap_url => 'https://maps.app.goo.gl/AbCdEf123'),
  true, 'PM sets the project Google-Maps link via the RPC');
select is(
  (select gmap_url from public.projects where id = 'cccccccc-cccc-cccc-cccc-cccccccc3333'),
  'https://maps.app.goo.gl/AbCdEf123', 'the gmap_url landed');
select throws_ok(
  $$ select public.update_project_settings(
       'cccccccc-cccc-cccc-cccc-cccccccc3333', 'PS renamed', 'on_hold',
       p_gmap_url => 'http://not-https.example') $$,
  '23514', null, 'a non-https gmap_url is rejected by the column CHECK');

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
