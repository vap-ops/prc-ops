begin;
select plan(18);

-- ============================================================================
-- Spec 177 U6 — two-party custody handshake on เบิก (issue now, receiver confirms).
--   stock_issues gains receiver_worker_id (the worker who takes custody) +
--   received_at (null = pending receipt). issue_stock gains p_receiver_worker_id.
--   confirm_stock_issue(issue): the NAMED receiver worker attests receipt (via the
--   worker portal — current_user_worker_id). RLS lets the receiver read their issue.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('51515151-5151-5151-5151-000000000183', 'sa@cust.local',    '{}'::jsonb),
  ('19191919-1919-1919-1919-000000000183', 'super@cust.local', '{}'::jsonb),
  ('a1111111-1111-1111-1111-000000000183', 'recv@cust.local',  '{}'::jsonb),
  ('a2222222-2222-2222-2222-000000000183', 'other@cust.local', '{}'::jsonb);
update public.users set role='site_admin'  where id='51515151-5151-5151-5151-000000000183';
update public.users set role='super_admin' where id='19191919-1919-1919-1919-000000000183';
-- recv + other stay visitor (they are workers, reaching via the portal).

insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000183', 'CU-PROJ-1', 'คัสโตดี ทดสอบ 1'),
  ('bb000000-0000-0000-0000-000000000183', 'CU-PROJ-2', 'คัสโตดี ทดสอบ 2');
insert into public.work_packages (id, project_id, code, name) values
  ('cc000000-0000-0000-0000-000000000183', 'aa000000-0000-0000-0000-000000000183', 'WP-1', 'งานทดสอบ');
insert into public.catalog_items (id, category, base_item, unit, is_active) values
  ('ee000000-0000-0000-0000-000000000183', 'electrical', 'วัสดุคัสโตดี', 'ชิ้น', true);
-- sa is a member of project 1.
insert into public.project_members (project_id, user_id, added_by) values
  ('aa000000-0000-0000-0000-000000000183', '51515151-5151-5151-5151-000000000183',
   '19191919-1919-1919-1919-000000000183');
-- Workers: receiver (portal-bound, project 1), other (project 1), elsewhere
-- (project 2), inactive (project 1).
insert into public.workers (id, name, pay_type, employment_type, project_id, user_id, active, created_by) values
  ('b0000001-0000-0000-0000-000000000183', 'ผู้รับ', 'daily', 'permanent', 'aa000000-0000-0000-0000-000000000183',
   'a1111111-1111-1111-1111-000000000183', true, '19191919-1919-1919-1919-000000000183'),
  ('b0000002-0000-0000-0000-000000000183', 'คนอื่น', 'daily', 'permanent', 'aa000000-0000-0000-0000-000000000183',
   'a2222222-2222-2222-2222-000000000183', true, '19191919-1919-1919-1919-000000000183'),
  ('b0000003-0000-0000-0000-000000000183', 'อีกไซต์', 'daily', 'permanent', 'bb000000-0000-0000-0000-000000000183',
   null, true, '19191919-1919-1919-1919-000000000183'),
  ('b0000004-0000-0000-0000-000000000183', 'พ้นสภาพ', 'daily', 'permanent', 'aa000000-0000-0000-0000-000000000183',
   null, false, '19191919-1919-1919-1919-000000000183');
-- Seed on-hand: 100 @ avg 10.
insert into public.stock_on_hand (project_id, catalog_item_id, qty_on_hand, total_value) values
  ('aa000000-0000-0000-0000-000000000183', 'ee000000-0000-0000-0000-000000000183', 100, 1000);

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Structure.
select has_column('public', 'stock_issues', 'receiver_worker_id',
  'stock_issues.receiver_worker_id exists');
select has_column('public', 'stock_issues', 'received_at', 'stock_issues.received_at exists');
select ok(to_regprocedure('public.issue_stock(uuid, uuid, uuid, numeric, text, uuid)') is not null,
  'issue_stock gains p_receiver_worker_id (6-arg)');
select ok(to_regprocedure('public.confirm_stock_issue(uuid)') is not null,
  'confirm_stock_issue exists');
select is(has_function_privilege('anon', 'public.confirm_stock_issue(uuid)', 'EXECUTE'),
  false, 'anon cannot execute confirm_stock_issue');

set local role authenticated;

-- B. site_admin issues 5 naming the receiver worker → pending receipt.
set local "request.jwt.claims" = '{"sub": "51515151-5151-5151-5151-000000000183"}';
select lives_ok(
  $$ select public.issue_stock('aa000000-0000-0000-0000-000000000183',
       'ee000000-0000-0000-0000-000000000183', 'cc000000-0000-0000-0000-000000000183', 5, 'เบิก',
       'b0000001-0000-0000-0000-000000000183') $$,
  'site_admin issues naming a receiver worker');
select is(
  (select count(*)::int from public.stock_issues
     where receiver_worker_id='b0000001-0000-0000-0000-000000000183' and received_at is null),
  1, 'the issue is recorded with the receiver, pending receipt');

-- A receiver from ANOTHER project + an INACTIVE worker are rejected.
select throws_ok(
  $$ select public.issue_stock('aa000000-0000-0000-0000-000000000183',
       'ee000000-0000-0000-0000-000000000183', 'cc000000-0000-0000-0000-000000000183', 1, null,
       'b0000003-0000-0000-0000-000000000183') $$,
  '22023', null, 'receiver worker from another project rejected (22023)');
select throws_ok(
  $$ select public.issue_stock('aa000000-0000-0000-0000-000000000183',
       'ee000000-0000-0000-0000-000000000183', 'cc000000-0000-0000-0000-000000000183', 1, null,
       'b0000004-0000-0000-0000-000000000183') $$,
  '22023', null, 'inactive receiver worker rejected (22023)');
-- An issue with NO receiver (the /store manager path) still works.
select lives_ok(
  $$ select public.issue_stock('aa000000-0000-0000-0000-000000000183',
       'ee000000-0000-0000-0000-000000000183', 'cc000000-0000-0000-0000-000000000183', 3, null) $$,
  'issue without a receiver still works (5-arg compatible)');

-- C. The receiver worker reads + confirms their issue (portal).
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-000000000183"}';
select is(
  (select count(*)::int from public.stock_issues
     where receiver_worker_id='b0000001-0000-0000-0000-000000000183'),
  1, 'the receiver worker can read their own issue (RLS arm)');
select lives_ok(
  $$ select public.confirm_stock_issue(
       (select id from public.stock_issues
         where receiver_worker_id='b0000001-0000-0000-0000-000000000183')) $$,
  'the receiver worker confirms receipt');
select is(
  (select count(*)::int from public.stock_issues
     where receiver_worker_id='b0000001-0000-0000-0000-000000000183' and received_at is not null),
  1, 'received_at is set after confirmation');

-- D. Confirming again → already confirmed (22023).
select throws_ok(
  $$ select public.confirm_stock_issue(
       (select id from public.stock_issues
         where receiver_worker_id='b0000001-0000-0000-0000-000000000183')) $$,
  '22023', null, 'confirming an already-received issue rejected (22023)');

-- E. A different worker cannot confirm someone else's issue (42501) and cannot read it.
set local "request.jwt.claims" = '{"sub": "a2222222-2222-2222-2222-000000000183"}';
select is(
  (select count(*)::int from public.stock_issues
     where receiver_worker_id='b0000001-0000-0000-0000-000000000183'),
  0, 'a non-receiver worker cannot read the issue');

-- F. A fresh pending issue (FIXED id, receiver = recv) — a different worker passes
-- that id and is rejected (42501). The id is a literal: a non-receiver worker
-- cannot READ the issue via RLS, so they could never reach it via a subquery, but
-- the definer RPC sees it and enforces the receiver-only rule.
reset role;
insert into public.stock_issues (id, project_id, catalog_item_id, work_package_id, qty, unit,
  unit_cost, receiver_worker_id)
values ('d1000000-0000-0000-0000-000000000183', 'aa000000-0000-0000-0000-000000000183',
  'ee000000-0000-0000-0000-000000000183', 'cc000000-0000-0000-0000-000000000183', 1, 'ชิ้น', 10,
  'b0000001-0000-0000-0000-000000000183');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a2222222-2222-2222-2222-000000000183"}';
select throws_ok(
  $$ select public.confirm_stock_issue('d1000000-0000-0000-0000-000000000183') $$,
  '42501', null, 'a non-receiver worker cannot confirm the issue (42501)');

-- G. Confirming an issue with NO receiver → nothing to confirm (22023).
reset role;
insert into public.stock_issues (id, project_id, catalog_item_id, work_package_id, qty, unit, unit_cost)
values ('d0000000-0000-0000-0000-000000000183', 'aa000000-0000-0000-0000-000000000183',
  'ee000000-0000-0000-0000-000000000183', 'cc000000-0000-0000-0000-000000000183', 1, 'ชิ้น', 10);
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-000000000183"}';
select throws_ok(
  $$ select public.confirm_stock_issue('d0000000-0000-0000-0000-000000000183') $$,
  '22023', null, 'confirming an issue with no receiver rejected (22023)');

-- H. A non-worker (site_admin, no worker binding) cannot confirm (42501).
set local "request.jwt.claims" = '{"sub": "51515151-5151-5151-5151-000000000183"}';
select throws_ok(
  $$ select public.confirm_stock_issue('d0000000-0000-0000-0000-000000000183') $$,
  '42501', null, 'a non-worker cannot confirm (42501)');

reset role;

select * from finish();
rollback;
