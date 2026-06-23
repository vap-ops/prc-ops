begin;
select plan(19);

-- ============================================================================
-- Spec 176 U1 — Supply Plan foundation.
--   supply_plans (one per project) + supply_plan_lines (catalog item + qty +
--   optional WP). READ via can_see_project; WRITE via SECURITY DEFINER RPCs:
--   create_supply_plan(project) [always-create (spec 189), planner tier + member],
--   add_supply_plan_line(plan, item, wp, qty, note) [draft-only, validations].
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111176', 'pmmember@sp.local',   '{}'::jsonb),
  ('12121212-1212-1212-1212-121212121176', 'pmoutsider@sp.local', '{}'::jsonb),
  ('14141414-1414-1414-1414-141414141176', 'visitor@sp.local',    '{}'::jsonb),
  ('19191919-1919-1919-1919-191919191176', 'super@sp.local',      '{}'::jsonb);
update public.users set role='project_manager' where id='11111111-1111-1111-1111-111111111176';
update public.users set role='project_manager' where id='12121212-1212-1212-1212-121212121176';
update public.users set role='super_admin'     where id='19191919-1919-1919-1919-191919191176';
-- '1414…' stays visitor.

insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000176', 'SP-PROJ-1', 'แผนจัดหา ทดสอบ 1'),
  ('bb000000-0000-0000-0000-000000000176', 'SP-PROJ-2', 'แผนจัดหา ทดสอบ 2');
insert into public.work_packages (id, project_id, code, name) values
  ('cc000000-0000-0000-0000-000000000176', 'aa000000-0000-0000-0000-000000000176', 'WP-1', 'งานทดสอบ 1'),
  ('dd000000-0000-0000-0000-000000000176', 'bb000000-0000-0000-0000-000000000176', 'WP-2', 'งานทดสอบ 2');
insert into public.catalog_items (id, category, base_item, unit, is_active) values
  ('ee000000-0000-0000-0000-000000000176', 'electrical', 'วัสดุแผนทดสอบ', 'ชิ้น', true),
  ('ef000000-0000-0000-0000-000000000176', 'electrical', 'วัสดุปิดใช้งาน', 'ชิ้น', false);
-- pm_member is a member of project 1; pm_outsider is not.
insert into public.project_members (project_id, user_id, added_by) values
  ('aa000000-0000-0000-0000-000000000176', '11111111-1111-1111-1111-111111111176',
   '19191919-1919-1919-1919-191919191176');
-- A pre-existing draft plan for project 1 (fixed id for the line tests).
insert into public.supply_plans (id, project_id) values
  ('ff000000-0000-0000-0000-000000000176', 'aa000000-0000-0000-0000-000000000176');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Structure.
select has_table('public', 'supply_plans', 'supply_plans table exists');
select has_table('public', 'supply_plan_lines', 'supply_plan_lines table exists');
select is((select relrowsecurity from pg_class where oid='public.supply_plans'::regclass),
  true, 'RLS enabled on supply_plans');
select is((select relrowsecurity from pg_class where oid='public.supply_plan_lines'::regclass),
  true, 'RLS enabled on supply_plan_lines');
select ok(to_regprocedure('public.create_supply_plan(uuid)') is not null,
  'create_supply_plan exists');
select ok(to_regprocedure('public.add_supply_plan_line(uuid, uuid, uuid, numeric, text)') is not null,
  'add_supply_plan_line exists');
select is(has_function_privilege('anon', 'public.create_supply_plan(uuid)', 'EXECUTE'),
  false, 'anon cannot execute create_supply_plan');
select is(has_function_privilege('anon',
  'public.add_supply_plan_line(uuid, uuid, uuid, numeric, text)', 'EXECUTE'),
  false, 'anon cannot execute add_supply_plan_line');

set local role authenticated;

-- B. PM member (on project 1).
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111176"}';
-- Spec 189: create_supply_plan now ALWAYS makes a new plan (multi-plan), so it
-- returns a fresh id distinct from the pre-existing fixture plan.
select isnt(
  (select public.create_supply_plan('aa000000-0000-0000-0000-000000000176')),
  'ff000000-0000-0000-0000-000000000176'::uuid,
  'PM member create_supply_plan makes a NEW plan (no longer get-or-create)');
select isnt(
  (select public.add_supply_plan_line('ff000000-0000-0000-0000-000000000176',
     'ee000000-0000-0000-0000-000000000176', 'cc000000-0000-0000-0000-000000000176', 10, 'note')),
  null, 'PM member adds a plan line — returns id');
select throws_ok(
  $$ select public.add_supply_plan_line('ff000000-0000-0000-0000-000000000176',
       'ee000000-0000-0000-0000-000000000176', 'cc000000-0000-0000-0000-000000000176', 0, null) $$,
  '22023', null, 'qty <= 0 rejected (22023)');
select throws_ok(
  $$ select public.add_supply_plan_line('ff000000-0000-0000-0000-000000000176',
       'ee000000-0000-0000-0000-000000000176', 'dd000000-0000-0000-0000-000000000176', 5, null) $$,
  '22023', null, 'WP from another project rejected (22023)');
select throws_ok(
  $$ select public.add_supply_plan_line('ff000000-0000-0000-0000-000000000176',
       'ef000000-0000-0000-0000-000000000176', null, 5, null) $$,
  '22023', null, 'inactive catalog item rejected (22023)');
select throws_ok(
  $$ select public.add_supply_plan_line('ff000000-0000-0000-0000-000000000176',
       'ee000000-0000-0000-0000-000000000176', 'cc000000-0000-0000-0000-000000000176', 5, null) $$,
  '23505', null, 'duplicate (item, WP) rejected (23505)');

-- C. PM outsider (not a member of project 1).
set local "request.jwt.claims" = '{"sub": "12121212-1212-1212-1212-121212121176"}';
select throws_ok(
  $$ select public.create_supply_plan('aa000000-0000-0000-0000-000000000176') $$,
  '42501', null, 'non-member PM create denied (42501)');
select throws_ok(
  $$ select public.add_supply_plan_line('ff000000-0000-0000-0000-000000000176',
       'ee000000-0000-0000-0000-000000000176', null, 1, null) $$,
  '42501', null, 'non-member PM add denied (42501)');

-- D. Visitor + unknown project.
set local "request.jwt.claims" = '{"sub": "14141414-1414-1414-1414-141414141176"}';
select throws_ok(
  $$ select public.create_supply_plan('aa000000-0000-0000-0000-000000000176') $$,
  '42501', null, 'visitor create denied (42501)');
set local "request.jwt.claims" = '{"sub": "19191919-1919-1919-1919-191919191176"}';
select throws_ok(
  $$ select public.create_supply_plan('99999999-0000-0000-0000-000000000176') $$,
  '22023', null, 'super create on unknown project → 22023');

-- E. A non-draft plan is frozen (not editable).
reset role;
update public.supply_plans set status='submitted'
  where id='ff000000-0000-0000-0000-000000000176';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111176"}';
select throws_ok(
  $$ select public.add_supply_plan_line('ff000000-0000-0000-0000-000000000176',
       'ee000000-0000-0000-0000-000000000176', null, 2, null) $$,
  '22023', null, 'cannot add a line to a submitted (frozen) plan (22023)');

reset role;

select * from finish();
rollback;
