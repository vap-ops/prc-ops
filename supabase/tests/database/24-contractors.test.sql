begin;
select plan(14);

-- ============================================================================
-- Spec 31 / ADR 0033 (+ staff-write amendment) — contractors master,
-- work_packages.contractor_id, and the set_work_package_contractor RPC.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('22222222-2222-2222-2222-22222222dddd', 'sa@ctr-test.local',      '{}'::jsonb),
  ('33333333-3333-3333-3333-33333333dddd', 'pm@ctr-test.local',      '{}'::jsonb),
  ('44444444-4444-4444-4444-44444444dddd', 'visitor@ctr-test.local', '{}'::jsonb);

update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-22222222dddd';
update public.users set role = 'project_manager' where id = '33333333-3333-3333-3333-33333333dddd';
-- 4444…dddd keeps default 'visitor'.

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
        'contractors insert by staff',
        'contractors update by staff'],
  'exactly the three contractor policies (staff write since the spec-31 amendment) — NO delete policy');
select is(has_table_privilege('authenticated', 'public.contractors', 'DELETE'),
  false, 'authenticated has NO DELETE on contractors');
select throws_ok(
  $$ insert into public.contractors (name, created_by)
     values ('   ', '33333333-3333-3333-3333-33333333dddd') $$,
  '23514', null, 'blank contractor name violates contractors_name_nonblank');
select has_function('public', 'set_work_package_contractor',
  'assignment RPC exists (SECURITY DEFINER, contractor_id only)');

-- C. Role-sim.
set local role authenticated;

-- C.1 PM creates a contractor.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-33333333dddd"}';
select lives_ok(
  $$ insert into public.contractors (id, name, phone, created_by)
     values ('d1000000-dddd-dddd-dddd-dddddddd2222', 'ทีมช่างสมชาย', '081-000-0000',
             '33333333-3333-3333-3333-33333333dddd') $$,
  'PM creates a contractor');

-- C.2 SA creates a contractor (amendment: field staff manage crews too).
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-22222222dddd"}';
select lives_ok(
  $$ insert into public.contractors (id, name, created_by)
     values ('d2000000-dddd-dddd-dddd-dddddddd2222', 'ทีมช่าง SA',
             '22222222-2222-2222-2222-22222222dddd') $$,
  'SA creates a contractor (staff-write amendment)');

-- C.3 SA assigns via the RPC (no direct WP UPDATE path exists for SA).
select lives_ok(
  $$ select public.set_work_package_contractor(
       'eeeeeeee-eeee-eeee-eeee-eeeeeeee2222',
       'd2000000-dddd-dddd-dddd-dddddddd2222') $$,
  'SA assigns a contractor via the RPC');

-- C.4 SA direct UPDATE on work_packages stays filtered (RLS unchanged).
select lives_ok(
  $$ update public.work_packages set contractor_id = null
     where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee2222' $$,
  'SA direct WP UPDATE statement runs (RLS filters to 0 rows)');

-- C.5 Visitor is rejected by the RPC role check.
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-44444444dddd"}';
select throws_ok(
  $$ select public.set_work_package_contractor(
       'eeeeeeee-eeee-eeee-eeee-eeeeeeee2222', null) $$,
  '42501', null, 'visitor cannot call the assignment RPC');

reset role;

-- D. Outcomes.
select is(
  (select contractor_id from public.work_packages
     where id = 'eeeeeeee-eeee-eeee-eeee-eeeeeeee2222'),
  'd2000000-dddd-dddd-dddd-dddddddd2222'::uuid,
  'RPC assignment landed; SA direct UPDATE was filtered (still assigned)');
select is(
  (select created_by from public.contractors
     where id = 'd2000000-dddd-dddd-dddd-dddddddd2222'),
  '22222222-2222-2222-2222-22222222dddd'::uuid,
  'created_by pinned to the creating SA');

select * from finish();
rollback;
