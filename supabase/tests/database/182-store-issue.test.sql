begin;
select plan(20);

-- ============================================================================
-- Spec 177 U3 — เบิก/Issue (the first OUT flow), at weighted-average cost.
--   stock_issues (append-only issue-out events: catalog item drawn TO a work
--   package, at the moving-avg cost snapshotted at issue) + issue_stock RPC:
--   SITE_STAFF gate, can_see_project membership, WP-in-project + qty + sufficient
--   on-hand guards, decrement on_hand at avg cost (qty-=, value-=qty*avg; last
--   unit → value 0). The sell/margin layer stays OUT (cost-first dial).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('51515151-5151-5151-5151-000000000182', 'sa@iss.local',        '{}'::jsonb),
  ('11111111-1111-1111-1111-000000000182', 'pmmember@iss.local',  '{}'::jsonb),
  ('12121212-1212-1212-1212-000000000182', 'pmoutsider@iss.local','{}'::jsonb),
  ('14141414-1414-1414-1414-000000000182', 'visitor@iss.local',   '{}'::jsonb),
  ('19191919-1919-1919-1919-000000000182', 'super@iss.local',     '{}'::jsonb);
update public.users set role='site_admin'       where id='51515151-5151-5151-5151-000000000182';
update public.users set role='project_manager'  where id='11111111-1111-1111-1111-000000000182';
update public.users set role='project_manager'  where id='12121212-1212-1212-1212-000000000182';
update public.users set role='super_admin'      where id='19191919-1919-1919-1919-000000000182';
-- '1414…' stays visitor.

insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000182', 'IS-PROJ-1', 'เบิก ทดสอบ 1'),
  ('bb000000-0000-0000-0000-000000000182', 'IS-PROJ-2', 'เบิก ทดสอบ 2');
insert into public.work_packages (id, project_id, code, name) values
  ('cc000000-0000-0000-0000-000000000182', 'aa000000-0000-0000-0000-000000000182', 'WP-1', 'งานทดสอบ 1'),
  ('dd000000-0000-0000-0000-000000000182', 'bb000000-0000-0000-0000-000000000182', 'WP-2', 'งานทดสอบ 2');
insert into public.catalog_items (id, category, base_item, unit, is_active) values
  ('ee000000-0000-0000-0000-000000000182', 'electrical', 'วัสดุเบิกทดสอบ', 'ชิ้น', true),
  ('ef000000-0000-0000-0000-000000000182', 'electrical', 'วัสดุเบิกสอง',  'ชิ้น', true);
-- sa + pm_member on project 1; pm_outsider is not.
insert into public.project_members (project_id, user_id, added_by) values
  ('aa000000-0000-0000-0000-000000000182', '51515151-5151-5151-5151-000000000182',
   '19191919-1919-1919-1919-000000000182'),
  ('aa000000-0000-0000-0000-000000000182', '11111111-1111-1111-1111-000000000182',
   '19191919-1919-1919-1919-000000000182');
-- Pre-seed on-hand directly (fixtures run as the runner role, bypassing RLS;
-- in production only record_stock_in writes this). item1: 20 @ avg 30 (value 600);
-- item2: 10 @ avg 5 (value 50).
insert into public.stock_on_hand (project_id, catalog_item_id, qty_on_hand, total_value) values
  ('aa000000-0000-0000-0000-000000000182', 'ee000000-0000-0000-0000-000000000182', 20, 600),
  ('aa000000-0000-0000-0000-000000000182', 'ef000000-0000-0000-0000-000000000182', 10, 50);

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Structure.
select has_table('public', 'stock_issues', 'stock_issues table exists');
select is((select relrowsecurity from pg_class where oid='public.stock_issues'::regclass),
  true, 'RLS enabled on stock_issues');
-- Spec 177 U6 widened issue_stock with a trailing p_receiver_worker_id (the
-- 5-arg signature was dropped); the 5-positional calls below still resolve here.
select ok(to_regprocedure('public.issue_stock(uuid, uuid, uuid, numeric, text, uuid)') is not null,
  'issue_stock exists');
select is(has_function_privilege('anon',
  'public.issue_stock(uuid, uuid, uuid, numeric, text, uuid)', 'EXECUTE'),
  false, 'anon cannot execute issue_stock');

set local role authenticated;

-- B. site_admin (project member) issues 5 of item1 (on-hand 20 @ avg 30).
set local "request.jwt.claims" = '{"sub": "51515151-5151-5151-5151-000000000182"}';
select isnt(
  (select public.issue_stock('aa000000-0000-0000-0000-000000000182',
     'ee000000-0000-0000-0000-000000000182', 'cc000000-0000-0000-0000-000000000182', 5, 'เบิกหน้างาน')),
  null, 'site_admin issues stock — returns issue id');
select is(
  (select qty_on_hand from public.stock_on_hand
     where project_id='aa000000-0000-0000-0000-000000000182'
       and catalog_item_id='ee000000-0000-0000-0000-000000000182'),
  15::numeric, 'on-hand qty 20 → 15 after issuing 5');
select is(
  (select total_value from public.stock_on_hand
     where project_id='aa000000-0000-0000-0000-000000000182'
       and catalog_item_id='ee000000-0000-0000-0000-000000000182'),
  450::numeric, 'on-hand value 600 → 450 (5 * avg 30) after issue');
-- the issue row snapshots the avg unit cost + generated total_cost + the WP.
select is(
  (select unit_cost from public.stock_issues
     where work_package_id='cc000000-0000-0000-0000-000000000182'
       and catalog_item_id='ee000000-0000-0000-0000-000000000182'),
  30::numeric, 'issue unit_cost = moving-avg 30 at issue');
select is(
  (select total_cost from public.stock_issues
     where work_package_id='cc000000-0000-0000-0000-000000000182'
       and catalog_item_id='ee000000-0000-0000-0000-000000000182'),
  150::numeric, 'issue total_cost generated = 150 (5 * 30)');

-- C. Issue the rest of item1 (15) → qty 0, value forced to 0 (no float dust).
select isnt(
  (select public.issue_stock('aa000000-0000-0000-0000-000000000182',
     'ee000000-0000-0000-0000-000000000182', 'cc000000-0000-0000-0000-000000000182', 15, null)),
  null, 'site_admin issues the remaining 15 — returns id');
select is(
  (select qty_on_hand from public.stock_on_hand
     where project_id='aa000000-0000-0000-0000-000000000182'
       and catalog_item_id='ee000000-0000-0000-0000-000000000182'),
  0::numeric, 'on-hand qty → 0 after issuing all');
select is(
  (select total_value from public.stock_on_hand
     where project_id='aa000000-0000-0000-0000-000000000182'
       and catalog_item_id='ee000000-0000-0000-0000-000000000182'),
  0::numeric, 'on-hand value → 0 when fully depleted');

-- D. Insufficient stock: item1 is now empty.
select throws_ok(
  $$ select public.issue_stock('aa000000-0000-0000-0000-000000000182',
       'ee000000-0000-0000-0000-000000000182', 'cc000000-0000-0000-0000-000000000182', 1, null) $$,
  '22023', null, 'issuing more than on-hand rejected (22023)');

-- E. pm member issues item2; qty<=0 + WP-from-another-project rejected.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-000000000182"}';
select isnt(
  (select public.issue_stock('aa000000-0000-0000-0000-000000000182',
     'ef000000-0000-0000-0000-000000000182', 'cc000000-0000-0000-0000-000000000182', 4, null)),
  null, 'pm member issues item2 — returns id');
select throws_ok(
  $$ select public.issue_stock('aa000000-0000-0000-0000-000000000182',
       'ef000000-0000-0000-0000-000000000182', 'cc000000-0000-0000-0000-000000000182', 0, null) $$,
  '22023', null, 'qty <= 0 rejected (22023)');
select throws_ok(
  $$ select public.issue_stock('aa000000-0000-0000-0000-000000000182',
       'ef000000-0000-0000-0000-000000000182', 'dd000000-0000-0000-0000-000000000182', 1, null) $$,
  '22023', null, 'WP from another project rejected (22023)');

-- F. pm outsider (not a member) + visitor denied.
set local "request.jwt.claims" = '{"sub": "12121212-1212-1212-1212-000000000182"}';
select throws_ok(
  $$ select public.issue_stock('aa000000-0000-0000-0000-000000000182',
       'ef000000-0000-0000-0000-000000000182', 'cc000000-0000-0000-0000-000000000182', 1, null) $$,
  '42501', null, 'non-member PM issue denied (42501)');
set local "request.jwt.claims" = '{"sub": "14141414-1414-1414-1414-000000000182"}';
select throws_ok(
  $$ select public.issue_stock('aa000000-0000-0000-0000-000000000182',
       'ef000000-0000-0000-0000-000000000182', 'cc000000-0000-0000-0000-000000000182', 1, null) $$,
  '42501', null, 'visitor issue denied (42501)');

-- G. Read posture: a member reads the project's issues; an outsider does not.
set local "request.jwt.claims" = '{"sub": "51515151-5151-5151-5151-000000000182"}';
select is(
  (select count(*)::int from public.stock_issues
     where project_id='aa000000-0000-0000-0000-000000000182'),
  3, 'site_admin member reads the project issues (2 item1 + 1 item2)');
set local "request.jwt.claims" = '{"sub": "12121212-1212-1212-1212-000000000182"}';
select is(
  (select count(*)::int from public.stock_issues
     where project_id='aa000000-0000-0000-0000-000000000182'),
  0, 'non-member PM cannot read another project issues');

reset role;

select * from finish();
rollback;
