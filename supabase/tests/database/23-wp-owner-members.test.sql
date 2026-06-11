begin;
select plan(15);

-- ============================================================================
-- Spec 28 Part A / ADR 0032 — work_packages.owner_id + work_package_members.
-- Membership is display metadata, never an access gate.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-11111111cccc', 'super@wpm-test.local',   '{}'::jsonb),
  ('22222222-2222-2222-2222-22222222cccc', 'sa@wpm-test.local',      '{}'::jsonb),
  ('33333333-3333-3333-3333-33333333cccc', 'pm@wpm-test.local',      '{}'::jsonb),
  ('44444444-4444-4444-4444-44444444cccc', 'visitor@wpm-test.local', '{}'::jsonb);

update public.users set role = 'super_admin'     where id = '11111111-1111-1111-1111-11111111cccc';
update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-22222222cccc';
update public.users set role = 'project_manager' where id = '33333333-3333-3333-3333-33333333cccc';

insert into public.projects (id, code, name) values
  ('cccccccc-cccc-cccc-cccc-cccccccc1111', 'PRC-TEST-WPM', 'WPM fixture project');
insert into public.work_packages (id, project_id, code, name) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeee1111',
   'cccccccc-cccc-cccc-cccc-cccccccc1111', 'WP-WPM-1', 'WPM fixture WP');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- B. Catalog.
-- ============================================================================

select has_column('public', 'work_packages', 'owner_id', 'work_packages.owner_id exists');
select has_table('public', 'work_package_members', 'work_package_members exists');
select col_is_pk('public', 'work_package_members',
  array['work_package_id', 'user_id'], 'composite PK pins one row per (wp, user)');
select is((select relrowsecurity from pg_class
            where oid = 'public.work_package_members'::regclass),
  true, 'RLS enabled on work_package_members');
select policies_are('public', 'work_package_members',
  array['members readable by privileged roles',
        'members insert by pm or super_admin',
        'members delete by pm or super_admin'],
  'exactly the three assignment policies — no UPDATE policy');
select is(has_table_privilege('anon', 'public.work_package_members', 'SELECT'),
  false, 'anon has nothing on work_package_members');
select is(has_table_privilege('appsheet_writer', 'public.work_package_members', 'SELECT'),
  false, 'appsheet_writer has nothing on work_package_members (ADR 0032)');

-- ============================================================================
-- C. Role-sim.
-- ============================================================================

set local role authenticated;

-- C.1 PM assigns the SA to the WP.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-33333333cccc"}';
select lives_ok(
  $$ insert into public.work_package_members (work_package_id, user_id, added_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeee1111',
             '22222222-2222-2222-2222-22222222cccc',
             '33333333-3333-3333-3333-33333333cccc') $$,
  'PM assigns a member');

-- C.2 added_by must be the caller.
select throws_ok(
  $$ insert into public.work_package_members (work_package_id, user_id, added_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeee1111',
             '11111111-1111-1111-1111-11111111cccc',
             '22222222-2222-2222-2222-22222222cccc') $$,
  '42501', null, 'INSERT with foreign added_by is denied (caller pin)');

-- C.3 SA cannot assign.
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-22222222cccc"}';
select throws_ok(
  $$ insert into public.work_package_members (work_package_id, user_id, added_by)
     values ('eeeeeeee-eeee-eeee-eeee-eeeeeeee1111',
             '22222222-2222-2222-2222-22222222cccc',
             '22222222-2222-2222-2222-22222222cccc') $$,
  '42501', null, 'SA cannot assign members (PM/super only)');

-- C.4 SA reads the crew.
select is(
  (select count(*)::int from public.work_package_members
     where work_package_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee1111'),
  1, 'SA reads the assignment row');

-- C.5 PM sets the owner through the existing WP UPDATE policy.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-33333333cccc"}';
select lives_ok(
  $$ update public.work_packages
       set owner_id = '22222222-2222-2222-2222-22222222cccc'
     where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee1111' $$,
  'PM sets owner_id via the existing WP UPDATE policy');

-- C.6 SA cannot set the owner (statement affects 0 rows).
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-22222222cccc"}';
select lives_ok(
  $$ update public.work_packages
       set owner_id = '22222222-2222-2222-2222-22222222cccc'
     where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee1111' $$,
  'SA owner-set statement runs (RLS filters to 0 rows)');

-- C.7 PM removes the member (real DELETE — mutable by design, ADR 0032).
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-33333333cccc"}';
select lives_ok(
  $$ delete from public.work_package_members
     where work_package_id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee1111'
       and user_id = '22222222-2222-2222-2222-22222222cccc' $$,
  'PM removes a member (real DELETE)');

reset role;

select is(
  (select owner_id from public.work_packages
     where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee1111'),
  '22222222-2222-2222-2222-22222222cccc'::uuid,
  'owner_id = SA (PM write landed; SA write was filtered)');

select * from finish();
rollback;
