begin;
select plan(14);

-- ============================================================================
-- Spec 178 B5 — confirm-on-behalf. A login-less receiver worker can't self-attest
--   on the portal, so a manager confirms for them. Operator gate (AskUserQuestion):
--   PM TIER ONLY (project_manager/super_admin/project_director), and NEVER the
--   person who ISSUED the stock (separation of duties). Every on-behalf confirm is
--   stamped: received_by = the manager, received_on_behalf = true (distinct from a
--   worker self-confirm via confirm_stock_issue, which leaves both untouched).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('51515151-5151-5151-5151-000000000197', 'issuer@ob.local', '{}'::jsonb),
  ('11111111-1111-1111-1111-000000000197', 'pmmember@ob.local', '{}'::jsonb),
  ('12121212-1212-1212-1212-000000000197', 'pmoutsider@ob.local', '{}'::jsonb),
  ('52525252-5252-5252-5252-000000000197', 'samember@ob.local', '{}'::jsonb),
  ('19191919-1919-1919-1919-000000000197', 'super@ob.local', '{}'::jsonb);
update public.users set role='site_admin'      where id='51515151-5151-5151-5151-000000000197';
update public.users set role='project_manager' where id='11111111-1111-1111-1111-000000000197';
update public.users set role='project_manager' where id='12121212-1212-1212-1212-000000000197';
update public.users set role='site_admin'      where id='52525252-5252-5252-5252-000000000197';
update public.users set role='super_admin'     where id='19191919-1919-1919-1919-000000000197';

insert into public.projects (id, code, name) values
  ('aa000000-0000-0000-0000-000000000197', 'OB-PROJ-1', 'ออนบีฮาล์ฟ ทดสอบ');
insert into public.work_packages (id, project_id, code, name) values
  ('cc000000-0000-0000-0000-000000000197', 'aa000000-0000-0000-0000-000000000197', 'WP-1', 'งานทดสอบ');
insert into public.catalog_items (id, category, base_item, unit, is_active) values
  ('ee000000-0000-0000-0000-000000000197', 'electrical', 'วัสดุออนบีฮาล์ฟ', 'ชิ้น', true);
-- issuer (sa), pmMember, saMember are members; pmOutsider is not; super sees all.
insert into public.project_members (project_id, user_id, added_by) values
  ('aa000000-0000-0000-0000-000000000197', '51515151-5151-5151-5151-000000000197',
   '19191919-1919-1919-1919-000000000197'),
  ('aa000000-0000-0000-0000-000000000197', '11111111-1111-1111-1111-000000000197',
   '19191919-1919-1919-1919-000000000197'),
  ('aa000000-0000-0000-0000-000000000197', '52525252-5252-5252-5252-000000000197',
   '19191919-1919-1919-1919-000000000197');
-- The receiver worker (login-less — no user_id).
insert into public.workers (id, name, worker_type, project_id, user_id, active, created_by) values
  ('b0000001-0000-0000-0000-000000000197', 'ผู้รับไม่มีแอป', 'dc',
   'aa000000-0000-0000-0000-000000000197', null, true, '19191919-1919-1919-1919-000000000197');

-- Issues (inserted directly; issued_by set explicitly to drive the not-issuer rule).
--  issue1: named receiver, issued by the site_admin, pending → the confirmable one.
--  issue2: NO receiver, pending → nothing to confirm.
--  issue3: named receiver, ALREADY received.
--  issueByPm: named receiver, issued by pmMember → pmMember is the issuer.
insert into public.stock_issues
  (id, project_id, catalog_item_id, work_package_id, qty, unit, unit_cost, receiver_worker_id,
   issued_by, received_at) values
  ('a1000000-0000-0000-0000-000000000197', 'aa000000-0000-0000-0000-000000000197',
   'ee000000-0000-0000-0000-000000000197', 'cc000000-0000-0000-0000-000000000197', 2, 'ชิ้น', 10,
   'b0000001-0000-0000-0000-000000000197', '51515151-5151-5151-5151-000000000197', null),
  ('a2000000-0000-0000-0000-000000000197', 'aa000000-0000-0000-0000-000000000197',
   'ee000000-0000-0000-0000-000000000197', 'cc000000-0000-0000-0000-000000000197', 2, 'ชิ้น', 10,
   null, '51515151-5151-5151-5151-000000000197', null),
  ('a3000000-0000-0000-0000-000000000197', 'aa000000-0000-0000-0000-000000000197',
   'ee000000-0000-0000-0000-000000000197', 'cc000000-0000-0000-0000-000000000197', 2, 'ชิ้น', 10,
   'b0000001-0000-0000-0000-000000000197', '51515151-5151-5151-5151-000000000197',
   '2026-01-01T00:00:00Z'),
  ('ab000000-0000-0000-0000-000000000197', 'aa000000-0000-0000-0000-000000000197',
   'ee000000-0000-0000-0000-000000000197', 'cc000000-0000-0000-0000-000000000197', 2, 'ชิ้น', 10,
   'b0000001-0000-0000-0000-000000000197', '11111111-1111-1111-1111-000000000197', null);

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Structure.
select has_column('public', 'stock_issues', 'received_on_behalf',
  'stock_issues.received_on_behalf exists');
select has_column('public', 'stock_issues', 'received_by', 'stock_issues.received_by exists');
select ok(to_regprocedure('public.confirm_stock_issue_on_behalf(uuid)') is not null,
  'confirm_stock_issue_on_behalf exists');
select is(has_function_privilege('anon',
  'public.confirm_stock_issue_on_behalf(uuid)', 'EXECUTE'),
  false, 'anon cannot execute confirm_stock_issue_on_behalf');

set local role authenticated;

-- B. Deny branches (run before the happy path, on the still-pending issue1).
set local "request.jwt.claims" = '{"sub": "52525252-5252-5252-5252-000000000197"}';
select throws_ok(
  $$ select public.confirm_stock_issue_on_behalf('a1000000-0000-0000-0000-000000000197') $$,
  '42501', null, 'site_admin (not PM tier) cannot confirm on behalf (42501)');
set local "request.jwt.claims" = '{"sub": "12121212-1212-1212-1212-000000000197"}';
select throws_ok(
  $$ select public.confirm_stock_issue_on_behalf('a1000000-0000-0000-0000-000000000197') $$,
  '42501', null, 'non-member PM cannot confirm on behalf (42501)');

set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-000000000197"}';
select throws_ok(
  $$ select public.confirm_stock_issue_on_behalf('a2000000-0000-0000-0000-000000000197') $$,
  '22023', null, 'an issue with no named receiver is rejected (22023)');
select throws_ok(
  $$ select public.confirm_stock_issue_on_behalf('a3000000-0000-0000-0000-000000000197') $$,
  '22023', null, 'an already-received issue is rejected (22023)');
select throws_ok(
  $$ select public.confirm_stock_issue_on_behalf('ffffffff-0000-0000-0000-000000000197') $$,
  '22023', null, 'an unknown issue is rejected (22023)');
select throws_ok(
  $$ select public.confirm_stock_issue_on_behalf('ab000000-0000-0000-0000-000000000197') $$,
  '42501', null, 'the issuer (a PM) cannot confirm their own handoff (42501)');

-- C. Happy path: pmMember (member, PM tier, not the issuer) confirms issue1.
select lives_ok(
  $$ select public.confirm_stock_issue_on_behalf('a1000000-0000-0000-0000-000000000197') $$,
  'a PM member confirms on behalf of the login-less receiver');
select isnt(
  (select received_at from public.stock_issues where id='a1000000-0000-0000-0000-000000000197'),
  null, 'received_at is set after the on-behalf confirm');
select is(
  (select received_on_behalf from public.stock_issues
     where id='a1000000-0000-0000-0000-000000000197'),
  true, 'received_on_behalf = true (distinct from a worker self-confirm)');
select is(
  (select received_by from public.stock_issues where id='a1000000-0000-0000-0000-000000000197'),
  '11111111-1111-1111-1111-000000000197'::uuid, 'received_by stamps the confirming manager');

reset role;

select * from finish();
rollback;
