begin;
select plan(9);

-- ============================================================================
-- Spec 181 U2 — add_supply_plan_lines: bulk-add plan lines atomically. Same gate
-- + validations as the single add; any bad line rolls the whole batch back.
-- Procurement (cross-project, non-member) can bulk-add in the PM's stead.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('b1111111-1111-1111-1111-111111111190', 'proc@sp190.local', '{}'::jsonb);
update public.users set role='procurement' where id='b1111111-1111-1111-1111-111111111190';

insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000190', 'SP190', 'แผนจัดหา bulk 190'),
  ('ab000000-0000-0000-0000-000000000190', 'SP190B', 'โครงการอื่น 190');
insert into public.work_packages (id, project_id, code, name) values
  ('cc000000-0000-0000-0000-000000000190', 'aa000000-0000-0000-0000-000000000190', 'WP190', 'งาน 190'),
  ('cd000000-0000-0000-0000-000000000190', 'ab000000-0000-0000-0000-000000000190', 'WPX', 'งานอื่น');
insert into public.catalog_items (id, category, base_item, unit, is_active) values
  ('ee000000-0000-0000-0000-000000000190', 'electrical', 'วัสดุ A 190', 'ชิ้น', true),
  ('ef000000-0000-0000-0000-000000000190', 'electrical', 'วัสดุ B 190', 'ชิ้น', true),
  ('e0000000-0000-0000-0000-000000000190', 'electrical', 'วัสดุปิด 190', 'ชิ้น', false);
insert into public.supply_plans (id, project_id) values
  ('ff000000-0000-0000-0000-000000000190', 'aa000000-0000-0000-0000-000000000190');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

select is(has_function_privilege('anon', 'public.add_supply_plan_lines(uuid, jsonb)', 'EXECUTE'),
  false, 'anon cannot execute add_supply_plan_lines');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b1111111-1111-1111-1111-111111111190"}';

-- A. procurement bulk-adds two valid lines → returns 2.
select is(
  (select public.add_supply_plan_lines('ff000000-0000-0000-0000-000000000190', $json$[
     {"catalog_item_id":"ee000000-0000-0000-0000-000000000190","work_package_id":"cc000000-0000-0000-0000-000000000190","qty":10},
     {"catalog_item_id":"ef000000-0000-0000-0000-000000000190","work_package_id":null,"qty":5,"note":"ทั้งโครงการ"}
   ]$json$::jsonb)),
  2, 'procurement bulk-adds 2 lines → returns 2');
select is(
  (select count(*)::int from public.supply_plan_lines where supply_plan_id='ff000000-0000-0000-0000-000000000190'),
  2, 'both lines landed');

-- B. Atomic: a batch with one bad line (qty 0) rolls back entirely.
select throws_ok(
  $$ select public.add_supply_plan_lines('ff000000-0000-0000-0000-000000000190', $json$[
       {"catalog_item_id":"ee000000-0000-0000-0000-000000000190","work_package_id":null,"qty":3},
       {"catalog_item_id":"ef000000-0000-0000-0000-000000000190","work_package_id":null,"qty":0}
     ]$json$::jsonb) $$,
  '22023', null, 'a batch with a qty<=0 line is rejected (22023)');
select is(
  (select count(*)::int from public.supply_plan_lines where supply_plan_id='ff000000-0000-0000-0000-000000000190'),
  2, 'the rejected batch left no partial rows (still 2)');

-- C. Inactive catalog item rejected.
select throws_ok(
  $$ select public.add_supply_plan_lines('ff000000-0000-0000-0000-000000000190', $json$[
       {"catalog_item_id":"e0000000-0000-0000-0000-000000000190","work_package_id":null,"qty":1}
     ]$json$::jsonb) $$,
  '22023', null, 'inactive catalog item rejected (22023)');

-- D. WP from another project rejected.
select throws_ok(
  $$ select public.add_supply_plan_lines('ff000000-0000-0000-0000-000000000190', $json$[
       {"catalog_item_id":"ee000000-0000-0000-0000-000000000190","work_package_id":"cd000000-0000-0000-0000-000000000190","qty":1}
     ]$json$::jsonb) $$,
  '22023', null, 'WP from another project rejected (22023)');

-- E. Duplicate (item, WP) — vs an already-landed line — rejected (23505).
select throws_ok(
  $$ select public.add_supply_plan_lines('ff000000-0000-0000-0000-000000000190', $json$[
       {"catalog_item_id":"ee000000-0000-0000-0000-000000000190","work_package_id":"cc000000-0000-0000-0000-000000000190","qty":99}
     ]$json$::jsonb) $$,
  '23505', null, 'duplicate (item, WP) rejected (23505)');

-- F. A frozen (submitted) plan is not editable.
reset role;
update public.supply_plans set status='submitted' where id='ff000000-0000-0000-0000-000000000190';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b1111111-1111-1111-1111-111111111190"}';
select throws_ok(
  $$ select public.add_supply_plan_lines('ff000000-0000-0000-0000-000000000190', $json$[
       {"catalog_item_id":"ef000000-0000-0000-0000-000000000190","work_package_id":"cc000000-0000-0000-0000-000000000190","qty":2}
     ]$json$::jsonb) $$,
  '22023', null, 'cannot bulk-add to a submitted (frozen) plan (22023)');

reset role;

select * from finish();
rollback;
