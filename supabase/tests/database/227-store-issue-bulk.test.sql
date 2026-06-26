begin;
select plan(21);

-- ============================================================================
-- Spec 208 U3 — multi-line เบิก (bulk withdrawal). issue_stock_bulk(project, wp,
-- jsonb) issues many catalog items from the project store to ONE work package in
-- one atomic call. Same gate as issue_stock (SITE_STAFF + can_see_project
-- MEMBERSHIP — procurement excluded, issue is a member-only OUT), per-line
-- validation, moving-average costing, on-hand decrement; any bad line rolls back
-- the whole batch. Sections: A structure, B happy, C validations, D atomicity,
-- E role/membership.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-000000000227', 'pmmember@iss.local',   '{}'::jsonb),
  ('12121212-1212-1212-1212-000000000227', 'pmoutsider@iss.local', '{}'::jsonb),
  ('13131313-1313-1313-1313-000000000227', 'procurement@iss.local','{}'::jsonb),
  ('14141414-1414-1414-1414-000000000227', 'visitor@iss.local',    '{}'::jsonb),
  ('15151515-1515-1515-1515-000000000227', 'sitemember@iss.local', '{}'::jsonb),
  ('19191919-1919-1919-1919-000000000227', 'super@iss.local',      '{}'::jsonb);
update public.users set role='project_manager' where id='11111111-1111-1111-1111-000000000227';
update public.users set role='project_manager' where id='12121212-1212-1212-1212-000000000227';
update public.users set role='procurement'     where id='13131313-1313-1313-1313-000000000227';
update public.users set role='site_admin'      where id='15151515-1515-1515-1515-000000000227';
update public.users set role='super_admin'     where id='19191919-1919-1919-1919-000000000227';
-- '1414…' stays visitor.

insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000227', 'ISS-PROJ-1', 'เบิกหลายรายการ 1'),
  ('bb000000-0000-0000-0000-000000000227', 'ISS-PROJ-2', 'เบิกหลายรายการ 2');
insert into public.work_packages (id, project_id, code, name, status) values
  ('ee000000-0000-0000-0000-000000000227', 'aa000000-0000-0000-0000-000000000227',
   'WP-ISS-1', 'เบิกเข้างาน', 'in_progress'),
  ('ff000000-0000-0000-0000-000000000227', 'bb000000-0000-0000-0000-000000000227',
   'WP-ISS-2', 'งานคนละโครงการ', 'in_progress');
insert into public.catalog_items (id, category, base_item, unit, is_active) values
  ('dd000000-0000-0000-0000-000000000227', 'electrical', 'วัสดุเบิก A', 'ชิ้น', true),
  ('de000000-0000-0000-0000-000000000227', 'electrical', 'วัสดุเบิก B', 'ชิ้น', true),
  ('df000000-0000-0000-0000-000000000227', 'electrical', 'วัสดุปิดใช้งาน', 'ชิ้น', false);

-- site_member + pm_member are on project 1; pm_outsider is not.
insert into public.project_members (project_id, user_id, added_by) values
  ('aa000000-0000-0000-0000-000000000227', '15151515-1515-1515-1515-000000000227',
   '19191919-1919-1919-1919-000000000227'),
  ('aa000000-0000-0000-0000-000000000227', '11111111-1111-1111-1111-000000000227',
   '19191919-1919-1919-1919-000000000227');

-- Pre-load the project-1 store: itemA 20 @ avg 20 (value 400), itemB 10 @ avg 35 (350).
insert into public.stock_on_hand (project_id, catalog_item_id, qty_on_hand, total_value) values
  ('aa000000-0000-0000-0000-000000000227', 'dd000000-0000-0000-0000-000000000227', 20, 400),
  ('aa000000-0000-0000-0000-000000000227', 'de000000-0000-0000-0000-000000000227', 10, 350);

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- A. Structure.
-- ============================================================================
select ok(to_regprocedure('public.issue_stock_bulk(uuid, uuid, jsonb)') is not null,
  'issue_stock_bulk exists');
select is(has_function_privilege('anon',
  'public.issue_stock_bulk(uuid, uuid, jsonb)', 'EXECUTE'),
  false, 'anon cannot execute issue_stock_bulk');

set local role authenticated;

-- ============================================================================
-- B. Happy: site_admin member issues a 2-line batch [itemA 5, itemB 3] to WP1.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "15151515-1515-1515-1515-000000000227"}';
select is(
  (select public.issue_stock_bulk(
     'aa000000-0000-0000-0000-000000000227',
     'ee000000-0000-0000-0000-000000000227',
     '[{"catalog_item_id":"dd000000-0000-0000-0000-000000000227","qty":5},
       {"catalog_item_id":"de000000-0000-0000-0000-000000000227","qty":3}]'::jsonb)),
  2, 'site_admin member issues a 2-line batch — returns count 2');
select is(
  (select qty_on_hand from public.stock_on_hand
     where project_id='aa000000-0000-0000-0000-000000000227'
       and catalog_item_id='dd000000-0000-0000-0000-000000000227'),
  15::numeric, 'itemA on-hand = 15 (20 - 5)');
select is(
  (select total_value from public.stock_on_hand
     where project_id='aa000000-0000-0000-0000-000000000227'
       and catalog_item_id='dd000000-0000-0000-0000-000000000227'),
  300::numeric, 'itemA value = 300 (400 - 5*20 moving-avg)');
select is(
  (select qty_on_hand from public.stock_on_hand
     where project_id='aa000000-0000-0000-0000-000000000227'
       and catalog_item_id='de000000-0000-0000-0000-000000000227'),
  7::numeric, 'itemB on-hand = 7 (10 - 3)');
select is(
  (select count(*)::int from public.stock_issues
     where work_package_id='ee000000-0000-0000-0000-000000000227'),
  2, 'two stock_issues rows written to the WP');
select is(
  (select unit_cost from public.stock_issues
     where work_package_id='ee000000-0000-0000-0000-000000000227'
       and catalog_item_id='dd000000-0000-0000-0000-000000000227'),
  20::numeric, 'itemA issue snapshots the moving-average unit_cost = 20');

-- ============================================================================
-- C. Validations (site_admin member actor).
-- ============================================================================
select throws_ok(
  $$ select public.issue_stock_bulk('aa000000-0000-0000-0000-000000000227',
       'ee000000-0000-0000-0000-000000000227', '[]'::jsonb) $$,
  '22023', null, 'empty array rejected (22023)');
select throws_ok(
  $$ select public.issue_stock_bulk('aa000000-0000-0000-0000-000000000227',
       'ee000000-0000-0000-0000-000000000227', '{}'::jsonb) $$,
  '22023', null, 'non-array lines rejected (22023)');
select throws_ok(
  $$ select public.issue_stock_bulk('aa000000-0000-0000-0000-000000000227',
       'ee000000-0000-0000-0000-000000000227',
       '[{"catalog_item_id":"dd000000-0000-0000-0000-000000000227","qty":0}]'::jsonb) $$,
  '22023', null, 'qty <= 0 rejected (22023)');
select throws_ok(
  $$ select public.issue_stock_bulk('aa000000-0000-0000-0000-000000000227',
       'ee000000-0000-0000-0000-000000000227',
       '[{"catalog_item_id":"df000000-0000-0000-0000-000000000227","qty":2}]'::jsonb) $$,
  '22023', null, 'inactive catalog item rejected (22023)');
select throws_ok(
  $$ select public.issue_stock_bulk('aa000000-0000-0000-0000-000000000227',
       'ee000000-0000-0000-0000-000000000227',
       '[{"catalog_item_id":"dd000000-0000-0000-0000-000000000227","qty":999}]'::jsonb) $$,
  '22023', null, 'insufficient stock rejected (22023)');
select throws_ok(
  $$ select public.issue_stock_bulk('aa000000-0000-0000-0000-000000000227',
       'ff000000-0000-0000-0000-000000000227',
       '[{"catalog_item_id":"dd000000-0000-0000-0000-000000000227","qty":2}]'::jsonb) $$,
  '22023', null, 'a WP from another project rejected (22023)');
select throws_ok(
  $$ select public.issue_stock_bulk('aa000000-0000-0000-0000-000000000227',
       'ee000000-0000-0000-0000-000000000227',
       '[{"catalog_item_id":"dd000000-0000-0000-0000-000000000227","qty":2,"receiver_worker_id":"99999999-0000-0000-0000-000000000227"}]'::jsonb) $$,
  '22023', null, 'unknown/inactive receiver rejected (22023)');

-- ============================================================================
-- D. Atomicity: one good line + one bad line → whole batch rolls back.
-- ============================================================================
select throws_ok(
  $$ select public.issue_stock_bulk('aa000000-0000-0000-0000-000000000227',
       'ee000000-0000-0000-0000-000000000227',
       '[{"catalog_item_id":"dd000000-0000-0000-0000-000000000227","qty":4,"note":"ATOMIC227"},
         {"catalog_item_id":"de000000-0000-0000-0000-000000000227","qty":0}]'::jsonb) $$,
  '22023', null, 'a batch with one bad line raises (22023)');
select is(
  (select qty_on_hand from public.stock_on_hand
     where project_id='aa000000-0000-0000-0000-000000000227'
       and catalog_item_id='dd000000-0000-0000-0000-000000000227'),
  15::numeric, 'itemA on-hand still 15 — the failed batch rolled back');
select is(
  (select count(*)::int from public.stock_issues where note='ATOMIC227'),
  0, 'the good line of the failed batch left no stock_issue');

-- ============================================================================
-- E. Role / membership.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "14141414-1414-1414-1414-000000000227"}';
select throws_ok(
  $$ select public.issue_stock_bulk('aa000000-0000-0000-0000-000000000227',
       'ee000000-0000-0000-0000-000000000227',
       '[{"catalog_item_id":"de000000-0000-0000-0000-000000000227","qty":1}]'::jsonb) $$,
  '42501', null, 'visitor denied (42501)');
-- Spec 208: procurement curates RECEIVING, not withdrawal — it cannot เบิก.
set local "request.jwt.claims" = '{"sub": "13131313-1313-1313-1313-000000000227"}';
select throws_ok(
  $$ select public.issue_stock_bulk('aa000000-0000-0000-0000-000000000227',
       'ee000000-0000-0000-0000-000000000227',
       '[{"catalog_item_id":"de000000-0000-0000-0000-000000000227","qty":1}]'::jsonb) $$,
  '42501', null, 'procurement denied — issue is member-only (42501)');
set local "request.jwt.claims" = '{"sub": "12121212-1212-1212-1212-000000000227"}';
select throws_ok(
  $$ select public.issue_stock_bulk('aa000000-0000-0000-0000-000000000227',
       'ee000000-0000-0000-0000-000000000227',
       '[{"catalog_item_id":"de000000-0000-0000-0000-000000000227","qty":1}]'::jsonb) $$,
  '42501', null, 'non-member PM denied (42501)');
-- pm member issues itemB 2 (on hand 7) → returns 1.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-000000000227"}';
select is(
  (select public.issue_stock_bulk('aa000000-0000-0000-0000-000000000227',
     'ee000000-0000-0000-0000-000000000227',
     '[{"catalog_item_id":"de000000-0000-0000-0000-000000000227","qty":2}]'::jsonb)),
  1, 'pm member issues a 1-line batch into own project — returns count 1');

reset role;
select * from finish();
rollback;
