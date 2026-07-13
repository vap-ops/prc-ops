begin;
select plan(22);

-- ============================================================================
-- Spec 170 U4c-2 / ADR 0062 / ADR 0051 §6 — DC WORKER bank-change request + PM
-- approval (anti-fraud), the worker analogue of spec 130 U4. A bound worker
-- submits a pending bank change (own only, one at a time); pm/super/director
-- approves (applies to the worker's OWN bank_* columns) or rejects; site_admin
-- never sees the money. The request row is the audit trail. OPEN-6 resolved:
-- a PARALLEL worker_bank_change_requests table (not the contractor one) — the
-- apply target is workers.bank_*, inline (no contact_bank).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1000000-0000-4000-8000-000000000201', 'wa@portal.local', '{}'::jsonb),
  ('11111111-1111-1111-1111-111111110201', 'pm@portal.local', '{}'::jsonb),
  ('51000000-0000-4000-8000-000000000201', 'sa@portal.local', '{}'::jsonb);
update public.users set role = 'project_manager' where id = '11111111-1111-1111-1111-111111110201';
update public.users set role = 'site_admin'      where id = '51000000-0000-4000-8000-000000000201';

-- DC edit matrix (2026-07-13): procurement_manager owns ช่าง onboarding, so it
-- JOINS the bank-change decide gate; plain procurement stays out (fixtures for E).
insert into auth.users (id, email, raw_user_meta_data) values
  ('c1000000-0000-4000-8000-000000000201', 'pmgr@portal.local', '{}'::jsonb),
  ('c2000000-0000-4000-8000-000000000201', 'proc@portal.local', '{}'::jsonb);
update public.users set role = 'procurement_manager' where id = 'c1000000-0000-4000-8000-000000000201';
update public.users set role = 'procurement'         where id = 'c2000000-0000-4000-8000-000000000201';

-- Worker A is bound to user wA (portal). Worker B is unbound (queue fixture).
-- Both DC, both start with NO bank on file so approve/reject effects are visible.
insert into public.workers (id, name, pay_type, employment_type, day_rate, user_id, created_by) values
  ('aa000000-0000-4000-8000-000000000201', 'Worker A', 'daily', 'temporary', 500,
   'a1000000-0000-4000-8000-000000000201', '11111111-1111-1111-1111-111111110201'),
  ('bb000000-0000-4000-8000-000000000201', 'Worker B', 'daily', 'temporary', 500,
   null, '11111111-1111-1111-1111-111111110201');
-- wA becomes a bound contractor-tier user (the portal role for a claimed worker).
update public.users set role = 'contractor' where id = 'a1000000-0000-4000-8000-000000000201';

-- A pending request for B, seeded directly (cross-party + queue fixture).
insert into public.worker_bank_change_requests
  (id, worker_id, bank_name, bank_account_number, bank_account_name, requested_by) values
  ('cb000000-0000-4000-8000-000000000201', 'bb000000-0000-4000-8000-000000000201',
   'B Bank', '999', 'B Co', '11111111-1111-1111-1111-111111110201');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- A. Catalog.
select has_table('public', 'worker_bank_change_requests', 'request table exists');
select ok((select relrowsecurity from pg_class where oid = 'public.worker_bank_change_requests'::regclass),
  'RLS enabled');

-- B. submit — bound worker only, own, one pending at a time.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1000000-0000-4000-8000-000000000201"}';
select isnt(
  (select public.submit_worker_bank_change('กสิกรไทย', '1112223334', 'Worker A')),
  null, 'wA submits a bank change');
select is(
  (select count(*) from public.worker_bank_change_requests
    where worker_id = 'aa000000-0000-4000-8000-000000000201' and status = 'pending'),
  1::bigint, 'one pending request for Worker A');
select throws_ok(
  $$ select public.submit_worker_bank_change('x', '1', 'y') $$,
  'P0001', null, 'a second pending request is refused');

set local "request.jwt.claims" = '{"sub": "51000000-0000-4000-8000-000000000201"}';
select throws_ok(
  $$ select public.submit_worker_bank_change('x', '1', 'y') $$,
  '42501', null, 'a non-worker (site_admin) cannot submit');

-- C. RLS read scoping.
set local "request.jwt.claims" = '{"sub": "a1000000-0000-4000-8000-000000000201"}';
select is((select count(*) from public.worker_bank_change_requests),
  1::bigint, 'wA sees only their own request (not B''s)');
set local "request.jwt.claims" = '{"sub": "51000000-0000-4000-8000-000000000201"}';
select is((select count(*) from public.worker_bank_change_requests),
  0::bigint, 'site_admin sees no bank-change requests (money hidden)');
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110201"}';
select is((select count(*) from public.worker_bank_change_requests),
  2::bigint, 'pm sees the full queue (A + B)');

-- D. decide — pm/super/director only; approve applies to workers.bank_*, reject does not.
set local "request.jwt.claims" = '{"sub": "51000000-0000-4000-8000-000000000201"}';
select throws_ok(
  $$ select public.decide_worker_bank_change(
       (select id from public.worker_bank_change_requests
         where worker_id = 'bb000000-0000-4000-8000-000000000201'), true) $$,
  '42501', null, 'site_admin cannot decide');

set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110201"}';
select lives_ok(
  $$ select public.decide_worker_bank_change(
       (select id from public.worker_bank_change_requests
         where worker_id = 'aa000000-0000-4000-8000-000000000201'), true) $$,
  'pm approves Worker A''s request');

reset role;
select is(
  (select bank_account_number from public.workers
    where id = 'aa000000-0000-4000-8000-000000000201'),
  '1112223334', 'approve applied the proposed bank to the worker''s own columns');
select is(
  (select status from public.worker_bank_change_requests
    where worker_id = 'aa000000-0000-4000-8000-000000000201'),
  'approved'::public.contractor_change_status, 'request marked approved');
select is(
  (select decided_by from public.worker_bank_change_requests
    where worker_id = 'aa000000-0000-4000-8000-000000000201'),
  '11111111-1111-1111-1111-111111110201'::uuid, 'decided_by = the PM');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110201"}';
select throws_ok(
  $$ select public.decide_worker_bank_change(
       (select id from public.worker_bank_change_requests
         where worker_id = 'aa000000-0000-4000-8000-000000000201'), true) $$,
  'P0001', null, 're-deciding an already-decided request is refused');
select lives_ok(
  $$ select public.decide_worker_bank_change(
       'cb000000-0000-4000-8000-000000000201', false) $$,
  'pm rejects Worker B''s request');

reset role;
select is(
  (select status from public.worker_bank_change_requests
    where id = 'cb000000-0000-4000-8000-000000000201'),
  'rejected'::public.contractor_change_status, 'B''s request marked rejected');
select is(
  (select bank_account_number from public.workers
    where id = 'bb000000-0000-4000-8000-000000000201'),
  null, 'reject did NOT write the bank to Worker B');

-- E. DC edit matrix — procurement_manager joins the decide gate; plain
-- procurement does NOT (the gate is is_manager()-or-procurement_manager, NOT
-- is_back_office(), which would also admit plain procurement). Superuser context
-- here (section D ended with reset role) for the fixture inserts.
insert into public.workers (id, name, pay_type, employment_type, day_rate, user_id, created_by) values
  ('cc000000-0000-4000-8000-000000000201', 'Worker C', 'daily', 'temporary', 500,
   null, '11111111-1111-1111-1111-111111110201');
insert into public.worker_bank_change_requests
  (id, worker_id, bank_name, bank_account_number, bank_account_name, requested_by) values
  ('dc000000-0000-4000-8000-000000000201', 'cc000000-0000-4000-8000-000000000201',
   'C Bank', '777', 'C Co', '11111111-1111-1111-1111-111111110201');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "c2000000-0000-4000-8000-000000000201"}';
select throws_ok(
  $$ select public.decide_worker_bank_change(
       'dc000000-0000-4000-8000-000000000201', true) $$,
  '42501', null, 'plain procurement cannot decide a worker bank change');

set local "request.jwt.claims" = '{"sub": "c1000000-0000-4000-8000-000000000201"}';
select lives_ok(
  $$ select public.decide_worker_bank_change(
       'dc000000-0000-4000-8000-000000000201', true) $$,
  'procurement_manager approves the request (joins the decide gate)');

reset role;
select is(
  (select bank_account_number from public.workers
    where id = 'cc000000-0000-4000-8000-000000000201'),
  '777', 'procurement_manager approve applied the bank to the worker');
select is(
  (select status from public.worker_bank_change_requests
    where id = 'dc000000-0000-4000-8000-000000000201'),
  'approved'::public.contractor_change_status, 'request marked approved by procurement_manager');

select * from finish();
rollback;
