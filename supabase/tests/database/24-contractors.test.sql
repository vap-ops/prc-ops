begin;
select plan(12);

-- ============================================================================
-- Spec 31 / ADR 0033 — contractors master + work_packages.contractor_id.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('22222222-2222-2222-2222-22222222dddd', 'sa@ctr-test.local', '{}'::jsonb),
  ('33333333-3333-3333-3333-33333333dddd', 'pm@ctr-test.local', '{}'::jsonb);

update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-22222222dddd';
update public.users set role = 'project_manager' where id = '33333333-3333-3333-3333-33333333dddd';

insert into public.projects (id, code, name) values
  ('cccccccc-cccc-cccc-cccc-cccccccc2222', 'PRC-TEST-CTR', 'CTR fixture project');
insert into public.work_packages (id, project_id, code, name) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeee2222',
   'cccccccc-cccc-cccc-cccc-cccccccc2222', 'WP-CTR-1', 'CTR fixture WP');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- B. Catalog.
select has_table('public', 'contractors', 'contractors exists');
select has_column('public', 'work_packages', 'contractor_id', 'work_packages.contractor_id exists');
select is((select relrowsecurity from pg_class where oid = 'public.contractors'::regclass),
  true, 'RLS enabled on contractors');
select policies_are('public', 'contractors',
  array['contractors readable by privileged roles',
        'contractors insert by pm or super_admin',
        'contractors update by pm or super_admin'],
  'exactly the three contractor policies — NO delete policy');
select is(has_table_privilege('authenticated', 'public.contractors', 'DELETE'),
  false, 'authenticated has NO DELETE on contractors');
select throws_ok(
  $$ insert into public.contractors (name, created_by)
     values ('   ', '33333333-3333-3333-3333-33333333dddd') $$,
  '23514', null, 'blank contractor name violates contractors_name_nonblank');

-- C. Role-sim.
set local role authenticated;

set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-33333333dddd"}';
select lives_ok(
  $$ insert into public.contractors (id, name, phone, created_by)
     values ('d1000000-dddd-dddd-dddd-dddddddd2222', 'ทีมช่างสมชาย', '081-000-0000',
             '33333333-3333-3333-3333-33333333dddd') $$,
  'PM creates a contractor');

select lives_ok(
  $$ update public.work_packages
       set contractor_id = 'd1000000-dddd-dddd-dddd-dddddddd2222'
     where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee2222' $$,
  'PM assigns the contractor to the WP');

set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-22222222dddd"}';
select throws_ok(
  $$ insert into public.contractors (name, created_by)
     values ('SA crew', '22222222-2222-2222-2222-22222222dddd') $$,
  '42501', null, 'SA cannot create contractors (PM/super only)');

select is(
  (select count(*)::int from public.contractors
     where id = 'd1000000-dddd-dddd-dddd-dddddddd2222'),
  1, 'SA reads the contractor row');

reset role;

select is(
  (select contractor_id from public.work_packages
     where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee2222'),
  'd1000000-dddd-dddd-dddd-dddddddd2222'::uuid,
  'WP carries the contractor assignment');

select is(
  (select created_by from public.contractors
     where id = 'd1000000-dddd-dddd-dddd-dddddddd2222'),
  '33333333-3333-3333-3333-33333333dddd'::uuid,
  'created_by pinned to the creating PM');

select * from finish();
rollback;
