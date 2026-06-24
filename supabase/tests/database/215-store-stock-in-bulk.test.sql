begin;
select plan(18);

-- ============================================================================
-- Spec 198 U1 — multi-line รับเข้า (bulk stock check-in).
--   record_stock_in_bulk(project, jsonb[]) records many stock_receipts lines in
--   ONE atomic call: same role gate (site_admin + BACK_OFFICE), membership
--   (can_see_project OR procurement), and per-line validation as the single
--   record_stock_in; any bad line rolls back the whole batch. Each line rolls
--   additively into stock_on_hand (moving-average). Returns the count inserted.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-000000000215', 'pmmember@bk.local',   '{}'::jsonb),
  ('12121212-1212-1212-1212-000000000215', 'pmoutsider@bk.local', '{}'::jsonb),
  ('13131313-1313-1313-1313-000000000215', 'procurement@bk.local','{}'::jsonb),
  ('14141414-1414-1414-1414-000000000215', 'visitor@bk.local',    '{}'::jsonb),
  ('15151515-1515-1515-1515-000000000215', 'sitemember@bk.local', '{}'::jsonb),
  ('19191919-1919-1919-1919-000000000215', 'super@bk.local',      '{}'::jsonb);
update public.users set role='project_manager'  where id='11111111-1111-1111-1111-000000000215';
update public.users set role='project_manager'  where id='12121212-1212-1212-1212-000000000215';
update public.users set role='procurement'      where id='13131313-1313-1313-1313-000000000215';
update public.users set role='site_admin'       where id='15151515-1515-1515-1515-000000000215';
update public.users set role='super_admin'      where id='19191919-1919-1919-1919-000000000215';
-- '1414…' stays visitor.

insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000215', 'BK-PROJ-1', 'รับเข้าหลายรายการ 1'),
  ('bb000000-0000-0000-0000-000000000215', 'BK-PROJ-2', 'รับเข้าหลายรายการ 2');
insert into public.catalog_items (id, category, base_item, unit, is_active) values
  ('ee000000-0000-0000-0000-000000000215', 'electrical', 'วัสดุบัลค์ทดสอบ', 'ชิ้น', true),
  ('ef000000-0000-0000-0000-000000000215', 'electrical', 'วัสดุปิดใช้งาน',  'ชิ้น', false);
insert into public.suppliers (id, name, created_by) values
  ('5a000000-0000-0000-0000-000000000215', 'ผู้ขายบัลค์',
   '19191919-1919-1919-1919-000000000215');
-- pm_member + site_member are on project 1; pm_outsider is not.
insert into public.project_members (project_id, user_id, added_by) values
  ('aa000000-0000-0000-0000-000000000215', '11111111-1111-1111-1111-000000000215',
   '19191919-1919-1919-1919-000000000215'),
  ('aa000000-0000-0000-0000-000000000215', '15151515-1515-1515-1515-000000000215',
   '19191919-1919-1919-1919-000000000215');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Structure.
select ok(to_regprocedure('public.record_stock_in_bulk(uuid, jsonb)') is not null,
  'record_stock_in_bulk exists');
select is(has_function_privilege('anon',
  'public.record_stock_in_bulk(uuid, jsonb)', 'EXECUTE'),
  false, 'anon cannot execute record_stock_in_bulk');

set local role authenticated;

-- B. Procurement records a 2-line batch into project 1 (same item twice → additive).
set local "request.jwt.claims" = '{"sub": "13131313-1313-1313-1313-000000000215"}';
select is(
  (select public.record_stock_in_bulk('aa000000-0000-0000-0000-000000000215',
     '[{"catalog_item_id":"ee000000-0000-0000-0000-000000000215","qty":10,"unit_cost":25},
       {"catalog_item_id":"ee000000-0000-0000-0000-000000000215","qty":5,"unit_cost":35}]'::jsonb)),
  2, 'procurement records a 2-line batch — returns count 2');
select is(
  (select qty_on_hand from public.stock_on_hand
     where project_id='aa000000-0000-0000-0000-000000000215'
       and catalog_item_id='ee000000-0000-0000-0000-000000000215'),
  15::numeric, 'on-hand qty = 15 (10 + 5) after the batch');
select is(
  (select total_value from public.stock_on_hand
     where project_id='aa000000-0000-0000-0000-000000000215'
       and catalog_item_id='ee000000-0000-0000-0000-000000000215'),
  425::numeric, 'on-hand value = 425 (250 + 175) after the batch');
select is(
  (select count(*)::int from public.stock_receipts
     where project_id='aa000000-0000-0000-0000-000000000215'
       and catalog_item_id='ee000000-0000-0000-0000-000000000215'),
  2, 'two stock_receipts rows written');

-- C. Validations (procurement actor).
select throws_ok(
  $$ select public.record_stock_in_bulk('aa000000-0000-0000-0000-000000000215', '[]'::jsonb) $$,
  '22023', null, 'empty array rejected (22023)');
select throws_ok(
  $$ select public.record_stock_in_bulk('aa000000-0000-0000-0000-000000000215', '{}'::jsonb) $$,
  '22023', null, 'non-array lines rejected (22023)');
select throws_ok(
  $$ select public.record_stock_in_bulk('aa000000-0000-0000-0000-000000000215',
       '[{"catalog_item_id":"ee000000-0000-0000-0000-000000000215","qty":0,"unit_cost":25}]'::jsonb) $$,
  '22023', null, 'qty <= 0 rejected (22023)');
select throws_ok(
  $$ select public.record_stock_in_bulk('aa000000-0000-0000-0000-000000000215',
       '[{"catalog_item_id":"ee000000-0000-0000-0000-000000000215","qty":5,"unit_cost":-1}]'::jsonb) $$,
  '22023', null, 'negative unit_cost rejected (22023)');
select throws_ok(
  $$ select public.record_stock_in_bulk('aa000000-0000-0000-0000-000000000215',
       '[{"catalog_item_id":"ef000000-0000-0000-0000-000000000215","qty":5,"unit_cost":25}]'::jsonb) $$,
  '22023', null, 'inactive catalog item rejected (22023)');
select throws_ok(
  $$ select public.record_stock_in_bulk('aa000000-0000-0000-0000-000000000215',
       '[{"catalog_item_id":"ee000000-0000-0000-0000-000000000215","qty":5,"unit_cost":25,"supplier_id":"99999999-0000-0000-0000-000000000215"}]'::jsonb) $$,
  '22023', null, 'unknown supplier rejected (22023)');
select throws_ok(
  $$ select public.record_stock_in_bulk('99999999-0000-0000-0000-000000000215',
       '[{"catalog_item_id":"ee000000-0000-0000-0000-000000000215","qty":5,"unit_cost":25}]'::jsonb) $$,
  '22023', null, 'unknown project rejected (22023)');

-- D. Atomicity: one good line + one bad line → whole batch rolls back.
select throws_ok(
  $$ select public.record_stock_in_bulk('aa000000-0000-0000-0000-000000000215',
       '[{"catalog_item_id":"ee000000-0000-0000-0000-000000000215","qty":7,"unit_cost":25,"note":"ATOMIC"},
         {"catalog_item_id":"ee000000-0000-0000-0000-000000000215","qty":0,"unit_cost":25}]'::jsonb) $$,
  '22023', null, 'a batch with one bad line raises (22023)');
select is(
  (select count(*)::int from public.stock_receipts
     where note='ATOMIC'),
  0, 'the good line of the failed batch was rolled back (no partial check-in)');

-- E. Role / membership.
set local "request.jwt.claims" = '{"sub": "14141414-1414-1414-1414-000000000215"}';
select throws_ok(
  $$ select public.record_stock_in_bulk('aa000000-0000-0000-0000-000000000215',
       '[{"catalog_item_id":"ee000000-0000-0000-0000-000000000215","qty":5,"unit_cost":25}]'::jsonb) $$,
  '42501', null, 'visitor denied (42501)');
set local "request.jwt.claims" = '{"sub": "12121212-1212-1212-1212-000000000215"}';
select throws_ok(
  $$ select public.record_stock_in_bulk('aa000000-0000-0000-0000-000000000215',
       '[{"catalog_item_id":"ee000000-0000-0000-0000-000000000215","qty":5,"unit_cost":25}]'::jsonb) $$,
  '42501', null, 'non-member PM denied (42501)');
-- site_admin member (the storekeeper) records a batch into their own project.
set local "request.jwt.claims" = '{"sub": "15151515-1515-1515-1515-000000000215"}';
select is(
  (select public.record_stock_in_bulk('aa000000-0000-0000-0000-000000000215',
     '[{"catalog_item_id":"ee000000-0000-0000-0000-000000000215","qty":3,"unit_cost":30}]'::jsonb)),
  1, 'site_admin member records a batch into own project — returns count 1');

reset role;
select * from finish();
rollback;
