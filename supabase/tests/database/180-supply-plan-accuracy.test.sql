begin;
select plan(15);

-- Spec 176 U5 — supply_plan_accuracy(project): the PM-accuracy measure. Per work
-- package, the planned line count vs the reactive purchase requests by reason
-- (unplanned_miss = the misses that count against the PM; fair_reactive =
-- rework/breakage/scope_change/unforeseeable; untagged = legacy null-reason PRs).
-- PRs join the project via work_packages.project_id; a null work_package_id row =
-- site-general planned lines.

-- ============================================================================
-- A. Function shape.
-- ============================================================================
select has_function('public', 'supply_plan_accuracy', array['uuid'],
  'supply_plan_accuracy(project) exists');
select is(
  (select prosecdef from pg_proc where proname = 'supply_plan_accuracy'),
  true, 'supply_plan_accuracy is SECURITY DEFINER');
select is(
  has_function_privilege('anon', 'public.supply_plan_accuracy(uuid)', 'EXECUTE'),
  false, 'anon cannot execute supply_plan_accuracy');

-- ============================================================================
-- Fixtures (postgres bypasses RLS + column grants).
-- ============================================================================
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-000000000180', 'super@acc-test.local',   '{}'::jsonb),
  ('22222222-2222-2222-2222-000000000180', 'pm@acc-test.local',      '{}'::jsonb),
  ('33333333-3333-3333-3333-000000000180', 'visitor@acc-test.local', '{}'::jsonb),
  ('44444444-4444-4444-4444-000000000180', 'pm2@acc-test.local',     '{}'::jsonb);
update public.users set role = 'super_admin'     where id = '11111111-1111-1111-1111-000000000180';
update public.users set role = 'project_manager' where id = '22222222-2222-2222-2222-000000000180';
-- '3333…' stays visitor.
update public.users set role = 'project_manager' where id = '44444444-4444-4444-4444-000000000180';

insert into public.projects (id, code, name) values
  ('cccccccc-cccc-cccc-cccc-000000000180', 'PRC-ACC', 'Accuracy fixture');
-- pm is a member; pm2 is NOT (a non-member PM is denied).
insert into public.project_members (project_id, user_id, added_by) values
  ('cccccccc-cccc-cccc-cccc-000000000180',
   '22222222-2222-2222-2222-000000000180',
   '22222222-2222-2222-2222-000000000180');

insert into public.work_packages (id, project_id, code, name) values
  ('eeeeeeee-eeee-eeee-eeee-00000000a180', 'cccccccc-cccc-cccc-cccc-000000000180', 'WP-A', 'WP A'),
  ('eeeeeeee-eeee-eeee-eeee-00000000b180', 'cccccccc-cccc-cccc-cccc-000000000180', 'WP-B', 'WP B');

-- Two catalog items: the unique index is (plan, item, coalesce(wp, sentinel)), so
-- two lines on the SAME WP need two distinct items.
insert into public.catalog_items (id, category, base_item, unit) values
  ('dddddddd-dddd-dddd-dddd-000000000180', 'steel_fixing', 'เหล็กทดสอบ 1', 'เส้น'),
  ('dddddddd-dddd-dddd-dddd-000000000281', 'steel_fixing', 'เหล็กทดสอบ 2', 'เส้น');

-- the plan + lines: WP-A 2 lines (qty 10 + 5 = 15), site-general (null WP) 1 line,
-- WP-B none (it shows up only via its reactive PR).
insert into public.supply_plans (id, project_id, status) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000180', 'cccccccc-cccc-cccc-cccc-000000000180', 'approved');
insert into public.supply_plan_lines (supply_plan_id, catalog_item_id, work_package_id, qty) values
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000180', 'dddddddd-dddd-dddd-dddd-000000000180',
   'eeeeeeee-eeee-eeee-eeee-00000000a180', 10),
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000180', 'dddddddd-dddd-dddd-dddd-000000000281',
   'eeeeeeee-eeee-eeee-eeee-00000000a180', 5),
  ('aaaaaaaa-aaaa-aaaa-aaaa-000000000180', 'dddddddd-dddd-dddd-dddd-000000000180',
   null, 3);

-- PRs: WP-A → 2 unplanned_miss + 1 breakage + 1 untagged(null); WP-B → 1 unplanned_miss.
insert into public.purchase_requests
  (work_package_id, item_description, quantity, unit, requested_by, status, source, reason_code)
values
  ('eeeeeeee-eeee-eeee-eeee-00000000a180', 'miss1', 1, 'ea',
   '22222222-2222-2222-2222-000000000180', 'requested', 'app', 'unplanned_miss'),
  ('eeeeeeee-eeee-eeee-eeee-00000000a180', 'miss2', 1, 'ea',
   '22222222-2222-2222-2222-000000000180', 'requested', 'app', 'unplanned_miss'),
  ('eeeeeeee-eeee-eeee-eeee-00000000a180', 'brk1', 1, 'ea',
   '22222222-2222-2222-2222-000000000180', 'requested', 'app', 'breakage'),
  ('eeeeeeee-eeee-eeee-eeee-00000000a180', 'legacy1', 1, 'ea',
   '22222222-2222-2222-2222-000000000180', 'requested', 'app', null),
  ('eeeeeeee-eeee-eeee-eeee-00000000b180', 'miss3', 1, 'ea',
   '22222222-2222-2222-2222-000000000180', 'requested', 'app', 'unplanned_miss');

-- ============================================================================
-- B. Role gate (role-sim authenticated).
-- ============================================================================
grant insert on _tap_buf to authenticated;
grant usage on sequence _tap_buf_ord_seq to authenticated;
set local role authenticated;

-- B.1 visitor is refused.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-000000000180"}';
select throws_ok(
  $$ select * from public.supply_plan_accuracy('cccccccc-cccc-cccc-cccc-000000000180') $$,
  '42501', null, 'visitor cannot read plan accuracy');

-- B.2 a non-member PM is refused.
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-000000000180"}';
select throws_ok(
  $$ select * from public.supply_plan_accuracy('cccccccc-cccc-cccc-cccc-000000000180') $$,
  '42501', null, 'a non-member PM cannot read plan accuracy');

-- B.3 super on an unknown project → 22023.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-000000000180"}';
select throws_ok(
  $$ select * from public.supply_plan_accuracy('cccccccc-cccc-cccc-cccc-0000000099ff') $$,
  '22023', null, 'unknown project is rejected');

-- ============================================================================
-- C. Behaviour (the member PM).
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-000000000180"}';

select is(
  (select planned_lines from public.supply_plan_accuracy('cccccccc-cccc-cccc-cccc-000000000180')
     where work_package_id = 'eeeeeeee-eeee-eeee-eeee-00000000a180'),
  2, 'WP-A has 2 planned lines');
select is(
  (select planned_qty from public.supply_plan_accuracy('cccccccc-cccc-cccc-cccc-000000000180')
     where work_package_id = 'eeeeeeee-eeee-eeee-eeee-00000000a180'),
  15::numeric, 'WP-A planned qty sums to 15');
select is(
  (select unplanned_miss from public.supply_plan_accuracy('cccccccc-cccc-cccc-cccc-000000000180')
     where work_package_id = 'eeeeeeee-eeee-eeee-eeee-00000000a180'),
  2, 'WP-A has 2 unplanned-miss PRs');
select is(
  (select fair_reactive from public.supply_plan_accuracy('cccccccc-cccc-cccc-cccc-000000000180')
     where work_package_id = 'eeeeeeee-eeee-eeee-eeee-00000000a180'),
  1, 'WP-A has 1 fair-reactive PR (breakage)');
select is(
  (select untagged from public.supply_plan_accuracy('cccccccc-cccc-cccc-cccc-000000000180')
     where work_package_id = 'eeeeeeee-eeee-eeee-eeee-00000000a180'),
  1, 'WP-A has 1 untagged (legacy) PR');
select is(
  (select unplanned_miss from public.supply_plan_accuracy('cccccccc-cccc-cccc-cccc-000000000180')
     where work_package_id = 'eeeeeeee-eeee-eeee-eeee-00000000b180'),
  1, 'WP-B (no plan lines) still shows its 1 unplanned-miss PR');
select is(
  (select planned_lines from public.supply_plan_accuracy('cccccccc-cccc-cccc-cccc-000000000180')
     where work_package_id = 'eeeeeeee-eeee-eeee-eeee-00000000b180'),
  0, 'WP-B has 0 planned lines');
select is(
  (select planned_lines from public.supply_plan_accuracy('cccccccc-cccc-cccc-cccc-000000000180')
     where work_package_id is null),
  1, 'the site-general (null WP) row carries its 1 planned line');
select is(
  (select count(*)::int from public.supply_plan_accuracy('cccccccc-cccc-cccc-cccc-000000000180')),
  3, 'three rows: WP-A, WP-B, site-general');

reset role;

select * from finish();
rollback;
