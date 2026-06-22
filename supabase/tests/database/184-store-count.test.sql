begin;
select plan(19);

-- ============================================================================
-- Spec 177 U9 — stock count / variance (shrinkage = a store-BU P&L hit).
--   A physical count sets on-hand to the counted truth; the variance (counted −
--   system) valued at the moving-average cost is the shrinkage. stock_counts is
--   append-only (system_qty snapshot + counted_qty + GENERATED variance /
--   variance_value). record_stock_count: SITE_STAFF gate + can_see_project; locks
--   the on-hand row (must exist), adjusts qty to counted at the existing avg cost.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('51515151-5151-5151-5151-000000000184', 'sa@cnt.local',     '{}'::jsonb),
  ('12121212-1212-1212-1212-000000000184', 'pmoutsider@cnt.local', '{}'::jsonb),
  ('14141414-1414-1414-1414-000000000184', 'visitor@cnt.local', '{}'::jsonb),
  ('19191919-1919-1919-1919-000000000184', 'super@cnt.local',   '{}'::jsonb);
update public.users set role='site_admin'      where id='51515151-5151-5151-5151-000000000184';
update public.users set role='project_manager' where id='12121212-1212-1212-1212-000000000184';
update public.users set role='super_admin'     where id='19191919-1919-1919-1919-000000000184';

insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000184', 'CN-PROJ-1', 'ตรวจนับ ทดสอบ 1');
insert into public.catalog_items (id, category, base_item, unit, is_active) values
  ('ee000000-0000-0000-0000-000000000184', 'electrical', 'วัสดุตรวจนับ', 'ชิ้น', true),
  ('ef000000-0000-0000-0000-000000000184', 'electrical', 'วัสดุไม่มีสต๊อก', 'ชิ้น', true);
insert into public.project_members (project_id, user_id, added_by) values
  ('aa000000-0000-0000-0000-000000000184', '51515151-5151-5151-5151-000000000184',
   '19191919-1919-1919-1919-000000000184');
-- Seed on-hand: 100 @ avg 10 (value 1000).
insert into public.stock_on_hand (project_id, catalog_item_id, qty_on_hand, total_value) values
  ('aa000000-0000-0000-0000-000000000184', 'ee000000-0000-0000-0000-000000000184', 100, 1000);

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Structure.
select has_table('public', 'stock_counts', 'stock_counts table exists');
select is((select relrowsecurity from pg_class where oid='public.stock_counts'::regclass),
  true, 'RLS enabled on stock_counts');
select ok(to_regprocedure('public.record_stock_count(uuid, uuid, numeric, text)') is not null,
  'record_stock_count exists');
select is(has_function_privilege('anon',
  'public.record_stock_count(uuid, uuid, numeric, text)', 'EXECUTE'),
  false, 'anon cannot execute record_stock_count');

set local role authenticated;

-- B. site_admin counts 90 (system 100) → shrinkage of 10.
set local "request.jwt.claims" = '{"sub": "51515151-5151-5151-5151-000000000184"}';
select isnt(
  (select public.record_stock_count('aa000000-0000-0000-0000-000000000184',
     'ee000000-0000-0000-0000-000000000184', 90, 'ตรวจนับประจำเดือน')),
  null, 'site_admin records a count — returns id');
select is(
  (select qty_on_hand from public.stock_on_hand
     where project_id='aa000000-0000-0000-0000-000000000184'
       and catalog_item_id='ee000000-0000-0000-0000-000000000184'),
  90::numeric, 'on-hand adjusted to the counted 90');
select is(
  (select total_value from public.stock_on_hand
     where project_id='aa000000-0000-0000-0000-000000000184'
       and catalog_item_id='ee000000-0000-0000-0000-000000000184'),
  900::numeric, 'on-hand value 900 (90 * avg 10) after count');
select is(
  (select variance from public.stock_counts
     where catalog_item_id='ee000000-0000-0000-0000-000000000184'),
  -10::numeric, 'variance = counted 90 − system 100 = -10');
select is(
  (select variance_value from public.stock_counts
     where catalog_item_id='ee000000-0000-0000-0000-000000000184'),
  -100::numeric, 'variance_value = -10 * avg 10 = -100 (shrinkage at cost)');
select is(
  (select system_qty from public.stock_counts
     where catalog_item_id='ee000000-0000-0000-0000-000000000184'),
  100::numeric, 'system_qty snapshot = 100');

-- C. Count UP (found 5): 90 → 95.
select isnt(
  (select public.record_stock_count('aa000000-0000-0000-0000-000000000184',
     'ee000000-0000-0000-0000-000000000184', 95, null)),
  null, 'count up returns id');
select is(
  (select qty_on_hand from public.stock_on_hand
     where project_id='aa000000-0000-0000-0000-000000000184'
       and catalog_item_id='ee000000-0000-0000-0000-000000000184'),
  95::numeric, 'on-hand adjusted up to 95');

-- D. Count to ZERO.
select isnt(
  (select public.record_stock_count('aa000000-0000-0000-0000-000000000184',
     'ee000000-0000-0000-0000-000000000184', 0, null)),
  null, 'count to zero returns id');
select is(
  (select total_value from public.stock_on_hand
     where project_id='aa000000-0000-0000-0000-000000000184'
       and catalog_item_id='ee000000-0000-0000-0000-000000000184'),
  0::numeric, 'on-hand value → 0 when counted to zero');

-- E. Counting an item with NO on-hand row is rejected.
select throws_ok(
  $$ select public.record_stock_count('aa000000-0000-0000-0000-000000000184',
       'ef000000-0000-0000-0000-000000000184', 5, null) $$,
  '22023', null, 'counting an unstocked item rejected (22023)');
-- Negative counted qty rejected.
select throws_ok(
  $$ select public.record_stock_count('aa000000-0000-0000-0000-000000000184',
       'ee000000-0000-0000-0000-000000000184', -1, null) $$,
  '22023', null, 'negative counted qty rejected (22023)');

-- F. Non-member PM + visitor denied.
set local "request.jwt.claims" = '{"sub": "12121212-1212-1212-1212-000000000184"}';
select throws_ok(
  $$ select public.record_stock_count('aa000000-0000-0000-0000-000000000184',
       'ee000000-0000-0000-0000-000000000184', 5, null) $$,
  '42501', null, 'non-member PM count denied (42501)');
set local "request.jwt.claims" = '{"sub": "14141414-1414-1414-1414-000000000184"}';
select throws_ok(
  $$ select public.record_stock_count('aa000000-0000-0000-0000-000000000184',
       'ee000000-0000-0000-0000-000000000184', 5, null) $$,
  '42501', null, 'visitor count denied (42501)');

-- G. Read: a member reads the count history.
set local "request.jwt.claims" = '{"sub": "51515151-5151-5151-5151-000000000184"}';
select is(
  (select count(*)::int from public.stock_counts
     where project_id='aa000000-0000-0000-0000-000000000184'),
  3, 'site_admin member reads the project count history (3 counts)');

reset role;

select * from finish();
rollback;
