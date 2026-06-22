begin;
select plan(24);

-- ============================================================================
-- Spec 177 U1 — Store + Stock-In (รับเข้า) at cost.
--   stock_receipts (append-only รับเข้า events, catalog-keyed, at cost) +
--   stock_on_hand (derived current state, one row per (project, catalog item),
--   qty_on_hand + total_value → moving-avg cost = value/qty). WRITE via the
--   SECURITY DEFINER RPC record_stock_in(project, item, qty, unit_cost,
--   supplier, note): BACK_OFFICE gate, can_see_project OR procurement member,
--   validations, additive on-hand upsert. READ via can_see_project OR procurement.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-000000000181', 'pmmember@st.local',   '{}'::jsonb),
  ('12121212-1212-1212-1212-000000000181', 'pmoutsider@st.local', '{}'::jsonb),
  ('13131313-1313-1313-1313-000000000181', 'procurement@st.local','{}'::jsonb),
  ('14141414-1414-1414-1414-000000000181', 'visitor@st.local',    '{}'::jsonb),
  ('19191919-1919-1919-1919-000000000181', 'super@st.local',      '{}'::jsonb);
update public.users set role='project_manager'  where id='11111111-1111-1111-1111-000000000181';
update public.users set role='project_manager'  where id='12121212-1212-1212-1212-000000000181';
update public.users set role='procurement'      where id='13131313-1313-1313-1313-000000000181';
update public.users set role='super_admin'      where id='19191919-1919-1919-1919-000000000181';
-- '1414…' stays visitor.

insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000181', 'ST-PROJ-1', 'สโตร์ ทดสอบ 1'),
  ('bb000000-0000-0000-0000-000000000181', 'ST-PROJ-2', 'สโตร์ ทดสอบ 2');
insert into public.catalog_items (id, category, base_item, unit, is_active) values
  ('ee000000-0000-0000-0000-000000000181', 'electrical', 'วัสดุสโตร์ทดสอบ', 'ชิ้น', true),
  ('ef000000-0000-0000-0000-000000000181', 'electrical', 'วัสดุปิดใช้งาน',  'ชิ้น', false);
insert into public.suppliers (id, name, created_by) values
  ('5a000000-0000-0000-0000-000000000181', 'ผู้ขายทดสอบ',
   '19191919-1919-1919-1919-000000000181');
-- pm_member is on project 1; pm_outsider is not.
insert into public.project_members (project_id, user_id, added_by) values
  ('aa000000-0000-0000-0000-000000000181', '11111111-1111-1111-1111-000000000181',
   '19191919-1919-1919-1919-000000000181');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Structure.
select has_table('public', 'stock_receipts', 'stock_receipts table exists');
select has_table('public', 'stock_on_hand', 'stock_on_hand table exists');
select is((select relrowsecurity from pg_class where oid='public.stock_receipts'::regclass),
  true, 'RLS enabled on stock_receipts');
select is((select relrowsecurity from pg_class where oid='public.stock_on_hand'::regclass),
  true, 'RLS enabled on stock_on_hand');
select ok(to_regprocedure('public.record_stock_in(uuid, uuid, numeric, numeric, uuid, text)') is not null,
  'record_stock_in exists');
select is(has_function_privilege('anon',
  'public.record_stock_in(uuid, uuid, numeric, numeric, uuid, text)', 'EXECUTE'),
  false, 'anon cannot execute record_stock_in');

set local role authenticated;

-- B. Procurement (cross-project) records a stock-in into project 1.
set local "request.jwt.claims" = '{"sub": "13131313-1313-1313-1313-000000000181"}';
select isnt(
  (select public.record_stock_in('aa000000-0000-0000-0000-000000000181',
     'ee000000-0000-0000-0000-000000000181', 10, 25, '5a000000-0000-0000-0000-000000000181', 'งวดแรก')),
  null, 'procurement records a stock-in — returns receipt id');
select is(
  (select qty_on_hand from public.stock_on_hand
     where project_id='aa000000-0000-0000-0000-000000000181'
       and catalog_item_id='ee000000-0000-0000-0000-000000000181'),
  10::numeric, 'on-hand qty = 10 after first receipt');
select is(
  (select total_value from public.stock_on_hand
     where project_id='aa000000-0000-0000-0000-000000000181'
       and catalog_item_id='ee000000-0000-0000-0000-000000000181'),
  250::numeric, 'on-hand value = 250 (10 * 25) after first receipt');
-- generated total_cost on the receipt row.
select is(
  (select total_cost from public.stock_receipts
     where project_id='aa000000-0000-0000-0000-000000000181'
       and catalog_item_id='ee000000-0000-0000-0000-000000000181'),
  250::numeric, 'receipt total_cost generated = 250');
-- unit snapshotted from the catalog item.
select is(
  (select unit from public.stock_receipts
     where project_id='aa000000-0000-0000-0000-000000000181'
       and catalog_item_id='ee000000-0000-0000-0000-000000000181'),
  'ชิ้น', 'receipt unit snapshotted from catalog item');

-- C. Second receipt at a different unit cost → additive on-hand (moving-avg shifts).
select isnt(
  (select public.record_stock_in('aa000000-0000-0000-0000-000000000181',
     'ee000000-0000-0000-0000-000000000181', 10, 35, null, null)),
  null, 'procurement records a second stock-in (no supplier) — returns id');
select is(
  (select qty_on_hand from public.stock_on_hand
     where project_id='aa000000-0000-0000-0000-000000000181'
       and catalog_item_id='ee000000-0000-0000-0000-000000000181'),
  20::numeric, 'on-hand qty = 20 after second receipt (additive)');
select is(
  (select total_value from public.stock_on_hand
     where project_id='aa000000-0000-0000-0000-000000000181'
       and catalog_item_id='ee000000-0000-0000-0000-000000000181'),
  600::numeric, 'on-hand value = 600 (250 + 350) → moving-avg 30');

-- D. PM member records a stock-in into their own project.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-000000000181"}';
select isnt(
  (select public.record_stock_in('aa000000-0000-0000-0000-000000000181',
     'ee000000-0000-0000-0000-000000000181', 5, 40, null, null)),
  null, 'PM member records a stock-in into own project — returns id');

-- E. Validations (procurement actor).
set local "request.jwt.claims" = '{"sub": "13131313-1313-1313-1313-000000000181"}';
select throws_ok(
  $$ select public.record_stock_in('aa000000-0000-0000-0000-000000000181',
       'ee000000-0000-0000-0000-000000000181', 0, 25, null, null) $$,
  '22023', null, 'qty <= 0 rejected (22023)');
select throws_ok(
  $$ select public.record_stock_in('aa000000-0000-0000-0000-000000000181',
       'ee000000-0000-0000-0000-000000000181', 5, -1, null, null) $$,
  '22023', null, 'negative unit_cost rejected (22023)');
select throws_ok(
  $$ select public.record_stock_in('aa000000-0000-0000-0000-000000000181',
       'ef000000-0000-0000-0000-000000000181', 5, 25, null, null) $$,
  '22023', null, 'inactive catalog item rejected (22023)');
select throws_ok(
  $$ select public.record_stock_in('99999999-0000-0000-0000-000000000181',
       'ee000000-0000-0000-0000-000000000181', 5, 25, null, null) $$,
  '22023', null, 'unknown project rejected (22023)');

-- F. PM outsider (not a member of project 1) denied.
set local "request.jwt.claims" = '{"sub": "12121212-1212-1212-1212-000000000181"}';
select throws_ok(
  $$ select public.record_stock_in('aa000000-0000-0000-0000-000000000181',
       'ee000000-0000-0000-0000-000000000181', 5, 25, null, null) $$,
  '42501', null, 'non-member PM stock-in denied (42501)');

-- G. Visitor denied.
set local "request.jwt.claims" = '{"sub": "14141414-1414-1414-1414-000000000181"}';
select throws_ok(
  $$ select public.record_stock_in('aa000000-0000-0000-0000-000000000181',
       'ee000000-0000-0000-0000-000000000181', 5, 25, null, null) $$,
  '42501', null, 'visitor stock-in denied (42501)');

-- H. Read posture: member + procurement can read on-hand; outsider cannot.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-000000000181"}';
select is(
  (select count(*)::int from public.stock_on_hand
     where project_id='aa000000-0000-0000-0000-000000000181'),
  1, 'PM member reads project on-hand');
set local "request.jwt.claims" = '{"sub": "13131313-1313-1313-1313-000000000181"}';
select is(
  (select count(*)::int from public.stock_on_hand
     where project_id='aa000000-0000-0000-0000-000000000181'),
  1, 'procurement reads on-hand (cross-project arm)');
set local "request.jwt.claims" = '{"sub": "12121212-1212-1212-1212-000000000181"}';
select is(
  (select count(*)::int from public.stock_on_hand
     where project_id='aa000000-0000-0000-0000-000000000181'),
  0, 'non-member PM cannot read another project on-hand');

reset role;

select * from finish();
rollback;
