begin;
select plan(26);

-- ============================================================================
-- Spec 317 U3 — identity_change_requests: the approved tier for legal name /
-- national ID / DOB (operator decisions 2026-07-14: DOB approval-gated; decided
-- by STAFF_APPROVAL_ROLES). Keyed on the LOGIN (user_id): identity belongs to
-- the human, so ONE approve applies to every linked record in one txn —
-- users.full_name + workers.{name,tax_id,date_of_birth} (user_id-bound) +
-- staff_registrations.{full_name,date_of_birth} (own APPROVED row).
-- Contractor party names are deliberately NOT in the apply set (a party is a
-- firm/crew entity managed on /contacts, not personal identity).
-- ============================================================================

-- --- Actors -----------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('a1000318-0000-4000-8000-000000000317', 'tech@t317u3.local',  '{}'::jsonb),
  ('a2000318-0000-4000-8000-000000000317', 'plain@t317u3.local', '{}'::jsonb),
  ('b1000318-0000-4000-8000-000000000317', 'pm@t317u3.local',    '{}'::jsonb),
  ('b2000318-0000-4000-8000-000000000317', 'pmgr@t317u3.local',  '{}'::jsonb),
  ('c1000318-0000-4000-8000-000000000317', 'sa@t317u3.local',    '{}'::jsonb);
update public.users set role = 'technician', full_name = 'ชื่อเก่า ทดสอบ'
  where id = 'a1000318-0000-4000-8000-000000000317';
update public.users set role = 'project_manager'      where id = 'b1000318-0000-4000-8000-000000000317';
update public.users set role = 'procurement_manager'  where id = 'b2000318-0000-4000-8000-000000000317';
update public.users set role = 'site_admin'           where id = 'c1000318-0000-4000-8000-000000000317';

-- The technician's linked records: bound worker + APPROVED registration.
insert into public.workers (id, name, pay_type, employment_type, day_rate, user_id, tax_id, date_of_birth, created_by) values
  ('aa000318-0000-4000-8000-000000000317', 'ชื่อเก่า ทดสอบ', 'daily', 'temporary', 500,
   'a1000318-0000-4000-8000-000000000317', '1234567890121', '1990-01-15',
   'b1000318-0000-4000-8000-000000000317');
insert into public.staff_registrations (id, user_id, employee_id, full_name, phone, status) values
  ('e1000318-0000-4000-8000-000000000317', 'a1000318-0000-4000-8000-000000000317',
   'PRC-18-0001', 'ชื่อเก่า ทดสอบ', '0818000001', 'approved');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- Structure.
-- ============================================================================
select has_table('public', 'identity_change_requests', 'identity_change_requests exists');
select ok((select relrowsecurity from pg_class where oid = 'public.identity_change_requests'::regclass),
  'RLS enabled');

-- ============================================================================
-- Submit — self only; at least one proposal; checksum; one pending.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1000318-0000-4000-8000-000000000317"}';
select throws_ok(
  $$ select public.submit_identity_change(null, null, null) $$,
  'P0001', null, 'an empty request (no proposed field) is refused');
select throws_ok(
  $$ select public.submit_identity_change(null, '1234567890120', null) $$,
  'P0001', null, 'a national ID failing the Thai mod-11 checksum is refused');
select throws_ok(
  $$ select public.submit_identity_change(repeat('ก', 121), null, null) $$,
  'P0001', null, 'an over-long proposed name is refused with a friendly error');
select isnt(
  (select public.submit_identity_change('ชื่อใหม่ ทดสอบ', '3101200000670', date '1990-02-20')),
  null, 'a technician submits name + ID + DOB in one request');
select throws_ok(
  $$ select public.submit_identity_change('อีกชื่อ', null, null) $$,
  'P0001', null, 'a second pending request is refused');
reset role;

-- ============================================================================
-- RLS read scoping — own + STAFF_APPROVAL_ROLES; site_admin sees nothing.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1000318-0000-4000-8000-000000000317"}';
select is(
  (select count(*) from public.identity_change_requests
    where user_id = 'a1000318-0000-4000-8000-000000000317'),
  1::bigint, 'the requester reads their own request');
set local "request.jwt.claims" = '{"sub": "c1000318-0000-4000-8000-000000000317"}';
select is(
  (select count(*) from public.identity_change_requests
    where user_id = 'a1000318-0000-4000-8000-000000000317'),
  0::bigint, 'site_admin sees no identity requests (PII hidden)');
-- project_manager is NOT in the approver trio — the RLS session must hide the
-- rows from them too (the queue page mirrors this with its admin-read gate).
set local "request.jwt.claims" = '{"sub": "b1000318-0000-4000-8000-000000000317"}';
select is(
  (select count(*) from public.identity_change_requests
    where user_id = 'a1000318-0000-4000-8000-000000000317'),
  0::bigint, 'project_manager sees no identity requests (national ID is trio-only PII)');
-- Another regular user reads nothing of someone else's request.
set local "request.jwt.claims" = '{"sub": "a2000318-0000-4000-8000-000000000317"}';
select is(
  (select count(*) from public.identity_change_requests
    where user_id = 'a1000318-0000-4000-8000-000000000317'),
  0::bigint, 'an unrelated user sees no one else''s identity requests');
set local "request.jwt.claims" = '{"sub": "b2000318-0000-4000-8000-000000000317"}';
select is(
  (select count(*) from public.identity_change_requests
    where user_id = 'a1000318-0000-4000-8000-000000000317'),
  1::bigint, 'procurement_manager (approver) reads the queue');
reset role;

-- ============================================================================
-- Decide gate — STAFF_APPROVAL_ROLES only (project_manager is NOT in the trio).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b1000318-0000-4000-8000-000000000317"}';
select throws_ok(
  $$ select public.decide_identity_change(
       (select id from public.identity_change_requests
         where user_id = 'a1000318-0000-4000-8000-000000000317' and status = 'pending'),
       true) $$,
  '42501', null, 'project_manager cannot decide identity changes');
set local "request.jwt.claims" = '{"sub": "c1000318-0000-4000-8000-000000000317"}';
select throws_ok(
  $$ select public.decide_identity_change(
       (select id from public.identity_change_requests limit 1), true) $$,
  '42501', null, 'site_admin cannot decide identity changes');
reset role;

-- ============================================================================
-- Approve — one txn applies to users + workers + approved registration.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b2000318-0000-4000-8000-000000000317"}';
select lives_ok(
  $$ select public.decide_identity_change(
       (select id from public.identity_change_requests
         where user_id = 'a1000318-0000-4000-8000-000000000317' and status = 'pending'),
       true) $$,
  'procurement_manager approves');
reset role;

select is(
  (select full_name from public.users where id = 'a1000318-0000-4000-8000-000000000317'),
  'ชื่อใหม่ ทดสอบ', 'users.full_name applied');
select is(
  (select name || '|' || tax_id || '|' || date_of_birth::text
     from public.workers where id = 'aa000318-0000-4000-8000-000000000317'),
  'ชื่อใหม่ ทดสอบ|3101200000670|1990-02-20', 'workers name + tax_id + DOB applied');
select is(
  (select full_name || '|' || date_of_birth::text
     from public.staff_registrations where id = 'e1000318-0000-4000-8000-000000000317'),
  'ชื่อใหม่ ทดสอบ|1990-02-20', 'approved registration name + DOB applied');
select is(
  (select status from public.identity_change_requests
    where user_id = 'a1000318-0000-4000-8000-000000000317'
    order by created_at desc limit 1)::text,
  'approved', 'request marked approved');

-- ============================================================================
-- Partial proposal (name only) leaves other fields alone; reject is a no-op.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1000318-0000-4000-8000-000000000317"}';
select lives_ok(
  $$ select public.submit_identity_change('ชื่อสาม ทดสอบ', null, null) $$,
  'a name-only follow-up request submits');
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b2000318-0000-4000-8000-000000000317"}';
select lives_ok(
  $$ select public.decide_identity_change(
       (select id from public.identity_change_requests
         where user_id = 'a1000318-0000-4000-8000-000000000317' and status = 'pending'),
       false) $$,
  'a reject decides without applying');
reset role;
select is(
  (select full_name from public.users where id = 'a1000318-0000-4000-8000-000000000317'),
  'ชื่อใหม่ ทดสอบ', 'reject leaves users.full_name untouched');
select is(
  (select tax_id from public.workers where id = 'aa000318-0000-4000-8000-000000000317'),
  '3101200000670', 'reject leaves workers untouched');

-- ============================================================================
-- A login with NO linked records still gets a name change (users only).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a2000318-0000-4000-8000-000000000317"}';
select lives_ok(
  $$ select public.submit_identity_change('คนธรรมดา ใหม่', null, null) $$,
  'a plain login (no worker/registration) submits a name change');
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b2000318-0000-4000-8000-000000000317"}';
select lives_ok(
  $$ select public.decide_identity_change(
       (select id from public.identity_change_requests
         where user_id = 'a2000318-0000-4000-8000-000000000317' and status = 'pending'),
       true) $$,
  'approve succeeds with no linked records (users row only)');
reset role;

-- ============================================================================
-- Grants.
-- ============================================================================
select is(
  (select count(*)::int from information_schema.role_routine_grants
     where routine_schema = 'public'
       and routine_name in ('submit_identity_change', 'decide_identity_change')
       and grantee in ('public', 'anon')),
  0, 'no PUBLIC/anon EXECUTE on either identity RPC');

select * from finish();
rollback;
