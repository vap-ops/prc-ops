begin;
select plan(30);

-- ============================================================================
-- Spec 319 U1 — user_bank + user_bank_change_requests: a login(user_id)-keyed
-- bank home for the admin/office tier (no worker/contractor/approved-registration
-- record to anchor a bank on). Twin of the spec 317 U4 staff-bank flow, re-keyed
-- on users(id); decided by the staff-approval trio. Passbook reuses the spec 315
-- U2 technician/<uid>/book_bank path + INSERT policy — no new storage RLS.
-- ============================================================================

-- --- Actors -----------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('11110000-0000-4000-8000-000000000319', 'homeless1@t319.local', '{}'::jsonb),
  ('22220000-0000-4000-8000-000000000319', 'latebind@t319.local',  '{}'::jsonb),
  ('33330000-0000-4000-8000-000000000319', 'boundwkr@t319.local',  '{}'::jsonb),
  ('44440000-0000-4000-8000-000000000319', 'apprreg@t319.local',   '{}'::jsonb),
  ('55550000-0000-4000-8000-000000000319', 'sa@t319.local',        '{}'::jsonb),
  ('66660000-0000-4000-8000-000000000319', 'contractor@t319.local','{}'::jsonb),
  ('77770000-0000-4000-8000-000000000319', 'conlate@t319.local',   '{}'::jsonb),
  ('b1110000-0000-4000-8000-000000000319', 'pm@t319.local',        '{}'::jsonb),
  ('b2220000-0000-4000-8000-000000000319', 'pmgr@t319.local',      '{}'::jsonb);
update public.users set role = 'accounting'          where id = '11110000-0000-4000-8000-000000000319';
update public.users set role = 'legal'               where id = '22220000-0000-4000-8000-000000000319';
update public.users set role = 'technician'          where id = '33330000-0000-4000-8000-000000000319';
update public.users set role = 'accounting'          where id = '44440000-0000-4000-8000-000000000319';
update public.users set role = 'site_admin'          where id = '55550000-0000-4000-8000-000000000319';
update public.users set role = 'contractor'          where id = '66660000-0000-4000-8000-000000000319';
update public.users set role = 'accounting'          where id = '77770000-0000-4000-8000-000000000319';
update public.users set role = 'project_manager'     where id = 'b1110000-0000-4000-8000-000000000319';
update public.users set role = 'procurement_manager' where id = 'b2220000-0000-4000-8000-000000000319';

-- boundwkr is a BOUND worker → must be refused from the login flow.
insert into public.workers (id, name, pay_type, employment_type, day_rate, user_id, created_by) values
  ('a3330000-0000-4000-8000-000000000319', 'ช่าง ผูกแล้ว', 'daily', 'temporary', 500,
   '33330000-0000-4000-8000-000000000319', 'b1110000-0000-4000-8000-000000000319');
-- apprreg has an APPROVED staff registration (staff-bank home) → refused.
insert into public.staff_registrations (id, user_id, employee_id, full_name, phone, status) values
  ('e4440000-0000-4000-8000-000000000319', '44440000-0000-4000-8000-000000000319',
   'PRC-19-0044', 'มีทะเบียนแล้ว', '0819000044', 'approved');
-- contractor is bound via contractor_users (contractor-bank home) → refused.
insert into public.contractors (id, name, created_by) values
  ('c6660000-0000-4000-8000-000000000319', 'ผู้รับเหมา ทดสอบ', 'b2220000-0000-4000-8000-000000000319');
insert into public.contractor_users (user_id, contractor_id) values
  ('66660000-0000-4000-8000-000000000319', 'c6660000-0000-4000-8000-000000000319');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

select has_table('public', 'user_bank', 'user_bank exists');
select has_table('public', 'user_bank_change_requests', 'user_bank_change_requests exists');
select ok((select relrowsecurity from pg_class where oid = 'public.user_bank_change_requests'::regclass),
  'RLS enabled on user_bank_change_requests');

-- ============================================================================
-- Submit — a home-less employee, photo required + real, single-home guard.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11110000-0000-4000-8000-000000000319"}';
select throws_ok(
  $$ select public.submit_user_bank_change('กสิกรไทย', '9998887776', 'โฮมเลส หนึ่ง', null) $$,
  'P0001', null, 'photo-less submit refused (passbook REQUIRED)');
select throws_ok(
  $$ select public.submit_user_bank_change('', '9998887776', 'โฮมเลส หนึ่ง',
       'technician/11110000-0000-4000-8000-000000000319/book_bank/req1.jpg') $$,
  'P0001', null, 'an empty bank field is refused (decide would hit NOT NULL)');
select throws_ok(
  $$ select public.submit_user_bank_change('กสิกรไทย', '99x9', 'โฮมเลส หนึ่ง',
       'technician/11110000-0000-4000-8000-000000000319/book_bank/req1.jpg') $$,
  'P0001', null, 'a malformed account number is refused');
select throws_ok(
  $$ select public.submit_user_bank_change('กสิกรไทย', '9998887776', 'โฮมเลส หนึ่ง',
       'technician/11110000-0000-4000-8000-000000000319/book_bank/ghost.jpg') $$,
  'P0001', null, 'a never-uploaded path is refused');
select throws_ok(
  $$ select public.submit_user_bank_change('กสิกรไทย', '9998887776', 'โฮมเลส หนึ่ง',
       'technician/22220000-0000-4000-8000-000000000319/book_bank/x.jpg') $$,
  '42501', null, 'a path in another user''s folder is refused');
insert into storage.objects (id, bucket_id, name) values
  (gen_random_uuid(), 'contact-docs',
   'technician/11110000-0000-4000-8000-000000000319/book_bank/req1.jpg');
-- dashes/spaces normalized away → 9998887776 (10 digits) passes the floor.
select isnt(
  (select public.submit_user_bank_change('กสิกรไทย', '999-888 7776', 'โฮมเลส หนึ่ง',
     'technician/11110000-0000-4000-8000-000000000319/book_bank/req1.jpg')),
  null, 'a home-less employee submits a photo-backed change (dashes/spaces ok)');
select throws_ok(
  $$ select public.submit_user_bank_change('ออมสิน', '5556667778', 'โฮมเลส หนึ่ง',
       'technician/11110000-0000-4000-8000-000000000319/book_bank/req1.jpg') $$,
  'P0001', null, 'a second pending request is refused');

-- Single bank home per login — worker / approved-staff are refused.
set local "request.jwt.claims" = '{"sub": "33330000-0000-4000-8000-000000000319"}';
select throws_ok(
  $$ select public.submit_user_bank_change('กสิกรไทย', '1234567', 'ช่าง', null) $$,
  '42501', null, 'a BOUND worker is refused (their home is workers.bank_*)');
set local "request.jwt.claims" = '{"sub": "44440000-0000-4000-8000-000000000319"}';
select throws_ok(
  $$ select public.submit_user_bank_change('กสิกรไทย', '1234567', 'ทะเบียน', null) $$,
  '42501', null, 'an approved-registration staffer is refused (staff-bank home)');
set local "request.jwt.claims" = '{"sub": "66660000-0000-4000-8000-000000000319"}';
select throws_ok(
  $$ select public.submit_user_bank_change('กสิกรไทย', '1234567', 'ผู้รับเหมา', null) $$,
  '42501', null, 'a bound contractor is refused (contractor-bank home)');
reset role;

-- ============================================================================
-- RLS reads — own + trio; PM and site_admin see nothing (money + trio-decided).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11110000-0000-4000-8000-000000000319"}';
select is((select count(*) from public.user_bank_change_requests
            where user_id = '11110000-0000-4000-8000-000000000319'), 1::bigint,
  'the requester reads their own request');
set local "request.jwt.claims" = '{"sub": "b1110000-0000-4000-8000-000000000319"}';
select is((select count(*) from public.user_bank_change_requests
            where user_id = '11110000-0000-4000-8000-000000000319'), 0::bigint,
  'project_manager reads none (trio-decided kind)');
set local "request.jwt.claims" = '{"sub": "55550000-0000-4000-8000-000000000319"}';
select is((select count(*) from public.user_bank_change_requests
            where user_id = '11110000-0000-4000-8000-000000000319'), 0::bigint,
  'site_admin reads none (money hidden)');
set local "request.jwt.claims" = '{"sub": "b2220000-0000-4000-8000-000000000319"}';
select is((select count(*) from public.user_bank_change_requests
            where user_id = '11110000-0000-4000-8000-000000000319'), 1::bigint,
  'procurement_manager (trio) reads the queue');
-- user_bank itself is zero-grant: even the trio cannot SELECT it directly (the
-- only reads are DEFINER get_own_user_bank / the admin client). ADR 0079.
select throws_ok(
  $$ select 1 from public.user_bank $$,
  '42501', null, 'user_bank is unreadable by authenticated (zero-grant, DEFINER-only)');
reset role;

-- ============================================================================
-- Decide — trio only; approve upserts user_bank (+ get_own_user_bank reflects).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b1110000-0000-4000-8000-000000000319"}';
select throws_ok(
  $$ select public.decide_user_bank_change(
       (select id from public.user_bank_change_requests
         where user_id = '11110000-0000-4000-8000-000000000319' and status = 'pending' limit 1),
       true) $$,
  '42501', null, 'project_manager cannot decide user bank changes');
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b2220000-0000-4000-8000-000000000319"}';
select lives_ok(
  $$ select public.decide_user_bank_change(
       (select id from public.user_bank_change_requests
         where user_id = '11110000-0000-4000-8000-000000000319' and status = 'pending'),
       true) $$,
  'procurement_manager (trio) approves');
reset role;
select is(
  (select bank_name || '|' || bank_account_number from public.user_bank
    where user_id = '11110000-0000-4000-8000-000000000319'),
  'กสิกรไทย|9998887776', 'approve upserts user_bank with the normalized account');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11110000-0000-4000-8000-000000000319"}';
select is(
  (select bank_account_number from public.get_own_user_bank()),
  '9998887776', 'get_own_user_bank returns the caller''s own bank');
reset role;

-- ============================================================================
-- Reject — nothing flips.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11110000-0000-4000-8000-000000000319"}';
insert into storage.objects (id, bucket_id, name) values
  (gen_random_uuid(), 'contact-docs',
   'technician/11110000-0000-4000-8000-000000000319/book_bank/req2.jpg');
select lives_ok(
  $$ select public.submit_user_bank_change('ออมสิน', '5554443332', 'โฮมเลส หนึ่ง',
       'technician/11110000-0000-4000-8000-000000000319/book_bank/req2.jpg') $$,
  'a second change submits after the first was decided');
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b2220000-0000-4000-8000-000000000319"}';
select lives_ok(
  $$ select public.decide_user_bank_change(
       (select id from public.user_bank_change_requests
         where user_id = '11110000-0000-4000-8000-000000000319' and status = 'pending'),
       false) $$,
  'trio rejects the second change');
reset role;
select is(
  (select bank_name from public.user_bank
    where user_id = '11110000-0000-4000-8000-000000000319'),
  'กสิกรไทย', 'reject leaves the live bank untouched');

-- ============================================================================
-- Late binding — a login that becomes a bound worker AFTER submitting: the
-- stale request is refused at decide time (their home moved).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22220000-0000-4000-8000-000000000319"}';
insert into storage.objects (id, bucket_id, name) values
  (gen_random_uuid(), 'contact-docs',
   'technician/22220000-0000-4000-8000-000000000319/book_bank/late.jpg');
select lives_ok(
  $$ select public.submit_user_bank_change('ออมสิน', '7776665554', 'ผูกทีหลัง',
       'technician/22220000-0000-4000-8000-000000000319/book_bank/late.jpg') $$,
  'a home-less employee submits before binding');
reset role;
insert into public.workers (id, name, pay_type, employment_type, day_rate, user_id, created_by) values
  ('a2220000-0000-4000-8000-000000000319', 'ผูกทีหลัง', 'daily', 'temporary', 500,
   '22220000-0000-4000-8000-000000000319', 'b1110000-0000-4000-8000-000000000319');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b2220000-0000-4000-8000-000000000319"}';
select throws_ok(
  $$ select public.decide_user_bank_change(
       (select id from public.user_bank_change_requests
         where user_id = '22220000-0000-4000-8000-000000000319' and status = 'pending'),
       true) $$,
  'P0001', null, 'approve refused once the requester is a bound worker (home moved)');
reset role;

-- A home-less login that gets claimed into contractor_users AFTER submitting:
-- the same decide-side single-home guard refuses the stale request.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "77770000-0000-4000-8000-000000000319"}';
insert into storage.objects (id, bucket_id, name) values
  (gen_random_uuid(), 'contact-docs',
   'technician/77770000-0000-4000-8000-000000000319/book_bank/conlate.jpg');
select lives_ok(
  $$ select public.submit_user_bank_change('ทหารไทยธนชาต', '6665554443', 'ผูกผู้รับเหมาทีหลัง',
       'technician/77770000-0000-4000-8000-000000000319/book_bank/conlate.jpg') $$,
  'a home-less login submits before a contractor bind');
reset role;
insert into public.contractors (id, name, created_by) values
  ('c7770000-0000-4000-8000-000000000319', 'ผู้รับเหมา ทีหลัง', 'b2220000-0000-4000-8000-000000000319');
insert into public.contractor_users (user_id, contractor_id) values
  ('77770000-0000-4000-8000-000000000319', 'c7770000-0000-4000-8000-000000000319');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b2220000-0000-4000-8000-000000000319"}';
select throws_ok(
  $$ select public.decide_user_bank_change(
       (select id from public.user_bank_change_requests
         where user_id = '77770000-0000-4000-8000-000000000319' and status = 'pending'),
       true) $$,
  'P0001', null, 'approve refused once the requester is a bound contractor (home moved)');
reset role;

-- ============================================================================
-- Grants.
-- ============================================================================
select is(
  (select count(*)::int from information_schema.role_routine_grants
     where routine_schema = 'public'
       and routine_name in ('get_own_user_bank', 'submit_user_bank_change', 'decide_user_bank_change')
       and grantee in ('public', 'anon')),
  0, 'no PUBLIC/anon EXECUTE on any user bank RPC');

select * from finish();
rollback;
