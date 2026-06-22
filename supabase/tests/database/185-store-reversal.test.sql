begin;
select plan(18);

-- ============================================================================
-- Spec 177 U11 — reversals (append-only undo of a wrong รับเข้า / เบิก).
--   A wrong stock movement is corrected by an append-only reversal that undoes its
--   on-hand effect — never by editing the original. stock_reversals carries a
--   typed FK to the reversed receipt OR issue (exactly one; a unique index blocks
--   double-reversal). reverse_stock_receipt (BACK_OFFICE) subtracts the receipt's
--   qty/value, guarding qty>=receipt.qty; reverse_stock_issue (SITE_STAFF) adds the
--   issue's qty/value back.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('51515151-5151-5151-5151-000000000185', 'sa@rev.local',     '{}'::jsonb),
  ('13131313-1313-1313-1313-000000000185', 'procurement@rev.local', '{}'::jsonb),
  ('12121212-1212-1212-1212-000000000185', 'pmoutsider@rev.local',  '{}'::jsonb),
  ('14141414-1414-1414-1414-000000000185', 'visitor@rev.local', '{}'::jsonb),
  ('19191919-1919-1919-1919-000000000185', 'super@rev.local',   '{}'::jsonb);
update public.users set role='site_admin'      where id='51515151-5151-5151-5151-000000000185';
update public.users set role='procurement'     where id='13131313-1313-1313-1313-000000000185';
update public.users set role='project_manager' where id='12121212-1212-1212-1212-000000000185';
update public.users set role='super_admin'     where id='19191919-1919-1919-1919-000000000185';

insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000185', 'RV-PROJ-1', 'กลับรายการ ทดสอบ 1');
insert into public.work_packages (id, project_id, code, name) values
  ('cc000000-0000-0000-0000-000000000185', 'aa000000-0000-0000-0000-000000000185', 'WP-1', 'งานทดสอบ');
insert into public.catalog_items (id, category, base_item, unit, is_active) values
  ('ee000000-0000-0000-0000-000000000185', 'electrical', 'วัสดุกลับรายการ', 'ชิ้น', true);
insert into public.project_members (project_id, user_id, added_by) values
  ('aa000000-0000-0000-0000-000000000185', '51515151-5151-5151-5151-000000000185',
   '19191919-1919-1919-1919-000000000185');
-- Seed on-hand 50 @ avg 10 (value 500), plus a receipt (30) and an issue (10) to
-- reverse, and a too-big receipt (999) that cannot be reversed.
insert into public.stock_on_hand (project_id, catalog_item_id, qty_on_hand, total_value) values
  ('aa000000-0000-0000-0000-000000000185', 'ee000000-0000-0000-0000-000000000185', 50, 500);
insert into public.stock_receipts (id, project_id, catalog_item_id, qty, unit, unit_cost) values
  ('d0000001-0000-0000-0000-000000000185', 'aa000000-0000-0000-0000-000000000185',
   'ee000000-0000-0000-0000-000000000185', 30, 'ชิ้น', 10),
  ('d0000002-0000-0000-0000-000000000185', 'aa000000-0000-0000-0000-000000000185',
   'ee000000-0000-0000-0000-000000000185', 999, 'ชิ้น', 10);
insert into public.stock_issues (id, project_id, catalog_item_id, work_package_id, qty, unit, unit_cost) values
  ('e0000001-0000-0000-0000-000000000185', 'aa000000-0000-0000-0000-000000000185',
   'ee000000-0000-0000-0000-000000000185', 'cc000000-0000-0000-0000-000000000185', 10, 'ชิ้น', 10);

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Structure.
select has_table('public', 'stock_reversals', 'stock_reversals table exists');
select is((select relrowsecurity from pg_class where oid='public.stock_reversals'::regclass),
  true, 'RLS enabled on stock_reversals');
select ok(to_regprocedure('public.reverse_stock_receipt(uuid, text)') is not null,
  'reverse_stock_receipt exists');
select ok(to_regprocedure('public.reverse_stock_issue(uuid, text)') is not null,
  'reverse_stock_issue exists');
select is(has_function_privilege('anon', 'public.reverse_stock_receipt(uuid, text)', 'EXECUTE'),
  false, 'anon cannot execute reverse_stock_receipt');

set local role authenticated;

-- B. Procurement reverses the receipt (30) → on-hand 50→20, value 500→200.
set local "request.jwt.claims" = '{"sub": "13131313-1313-1313-1313-000000000185"}';
select isnt(
  (select public.reverse_stock_receipt('d0000001-0000-0000-0000-000000000185', 'รับเข้าผิด')),
  null, 'procurement reverses a receipt — returns id');
select is(
  (select qty_on_hand from public.stock_on_hand
     where project_id='aa000000-0000-0000-0000-000000000185'
       and catalog_item_id='ee000000-0000-0000-0000-000000000185'),
  20::numeric, 'on-hand qty 50 → 20 after reversing the 30 receipt');
select is(
  (select total_value from public.stock_on_hand
     where project_id='aa000000-0000-0000-0000-000000000185'
       and catalog_item_id='ee000000-0000-0000-0000-000000000185'),
  200::numeric, 'on-hand value 500 → 200 (−300) after the receipt reversal');
select is(
  (select value_delta from public.stock_reversals
     where receipt_id='d0000001-0000-0000-0000-000000000185'),
  -300::numeric, 'reversal value_delta = -300 (the receipt total_cost)');

-- C. Reversing the same receipt again is blocked (unique).
select throws_ok(
  $$ select public.reverse_stock_receipt('d0000001-0000-0000-0000-000000000185', null) $$,
  '23505', null, 'a receipt cannot be reversed twice (23505)');

-- D. A receipt whose qty exceeds current on-hand cannot be reversed.
select throws_ok(
  $$ select public.reverse_stock_receipt('d0000002-0000-0000-0000-000000000185', null) $$,
  '22023', null, 'receipt with qty > on-hand cannot be reversed (22023)');

-- E. site_admin reverses the issue (10) → on-hand 20→30, value 200→300.
set local "request.jwt.claims" = '{"sub": "51515151-5151-5151-5151-000000000185"}';
select isnt(
  (select public.reverse_stock_issue('e0000001-0000-0000-0000-000000000185', null)),
  null, 'site_admin reverses an issue — returns id');
select is(
  (select qty_on_hand from public.stock_on_hand
     where project_id='aa000000-0000-0000-0000-000000000185'
       and catalog_item_id='ee000000-0000-0000-0000-000000000185'),
  30::numeric, 'on-hand qty 20 → 30 after reversing the 10 issue (added back)');
select is(
  (select value_delta from public.stock_reversals
     where issue_id='e0000001-0000-0000-0000-000000000185'),
  100::numeric, 'issue reversal value_delta = +100 (added back)');

-- F. Reversing the same issue again is blocked (unique).
select throws_ok(
  $$ select public.reverse_stock_issue('e0000001-0000-0000-0000-000000000185', null) $$,
  '23505', null, 'an issue cannot be reversed twice (23505)');

-- G. Denies: visitor reverse-receipt + non-member PM reverse-issue.
set local "request.jwt.claims" = '{"sub": "14141414-1414-1414-1414-000000000185"}';
select throws_ok(
  $$ select public.reverse_stock_receipt('d0000001-0000-0000-0000-000000000185', null) $$,
  '42501', null, 'visitor reverse-receipt denied (42501)');
set local "request.jwt.claims" = '{"sub": "12121212-1212-1212-1212-000000000185"}';
select throws_ok(
  $$ select public.reverse_stock_issue('e0000001-0000-0000-0000-000000000185', null) $$,
  '42501', null, 'non-member PM reverse-issue denied (42501)');

-- H. Read: a member reads the reversal history.
set local "request.jwt.claims" = '{"sub": "51515151-5151-5151-5151-000000000185"}';
select is(
  (select count(*)::int from public.stock_reversals
     where project_id='aa000000-0000-0000-0000-000000000185'),
  2, 'site_admin member reads the project reversal history (2)');

reset role;

select * from finish();
rollback;
