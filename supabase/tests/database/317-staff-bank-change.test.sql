begin;
select plan(27);

-- ============================================================================
-- Spec 317 U4 — staff_bank_change_requests: the office-staff mirror of the
-- worker bank-change flow (spec 315 U2 pattern verbatim). An approved staffer
-- with NO bound worker row stages a bank change (passbook photo REQUIRED +
-- storage-existence check); the staff-approval trio decides; approve UPSERTS
-- staff_registration_bank (their payroll home) AND supersede-chains the
-- registration's book_bank doc, so evidence always matches the live payout
-- bank. Bound workers are refused here — their flow is worker_bank_change.
-- ============================================================================

-- --- Actors -----------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('a1000319-0000-4000-8000-000000000317', 'acct@t317u4.local',   '{}'::jsonb),
  ('a2000319-0000-4000-8000-000000000317', 'nobank@t317u4.local', '{}'::jsonb),
  ('a3000319-0000-4000-8000-000000000317', 'tech@t317u4.local',   '{}'::jsonb),
  ('a4000319-0000-4000-8000-000000000317', 'rejected@t317u4.local', '{}'::jsonb),
  ('b1000319-0000-4000-8000-000000000317', 'pm@t317u4.local',     '{}'::jsonb),
  ('b2000319-0000-4000-8000-000000000317', 'pmgr@t317u4.local',   '{}'::jsonb),
  ('c1000319-0000-4000-8000-000000000317', 'sa@t317u4.local',     '{}'::jsonb);
update public.users set role = 'accounting'          where id in
  ('a1000319-0000-4000-8000-000000000317', 'a2000319-0000-4000-8000-000000000317');
update public.users set role = 'technician'          where id = 'a3000319-0000-4000-8000-000000000317';
update public.users set role = 'project_manager'     where id = 'b1000319-0000-4000-8000-000000000317';
update public.users set role = 'procurement_manager' where id = 'b2000319-0000-4000-8000-000000000317';
update public.users set role = 'site_admin'          where id = 'c1000319-0000-4000-8000-000000000317';

insert into public.staff_registrations (id, user_id, employee_id, full_name, phone, status) values
  ('e1000319-0000-4000-8000-000000000317', 'a1000319-0000-4000-8000-000000000317',
   'PRC-19-0001', 'บัญชี หนึ่ง', '0819000001', 'approved'),
  ('e2000319-0000-4000-8000-000000000317', 'a2000319-0000-4000-8000-000000000317',
   'PRC-19-0002', 'บัญชี สอง (ไม่มีบัญชีเดิม)', '0819000002', 'approved'),
  ('e3000319-0000-4000-8000-000000000317', 'a3000319-0000-4000-8000-000000000317',
   'PRC-19-0003', 'ช่าง ผูกแล้ว', '0819000003', 'approved'),
  ('e4000319-0000-4000-8000-000000000317', 'a4000319-0000-4000-8000-000000000317',
   'PRC-19-0004', 'ถูกปฏิเสธ', '0819000004', 'rejected');

-- s1's existing bank + current book_bank doc (what an approve must supersede).
insert into public.staff_registration_bank (registration_id, bank_name, bank_account_number, bank_account_name, updated_by) values
  ('e1000319-0000-4000-8000-000000000317', 'กรุงเทพ', '1112223334', 'บัญชี หนึ่ง',
   'a1000319-0000-4000-8000-000000000317');
insert into public.staff_registration_attachments (id, registration_id, purpose, storage_path, uploaded_by) values
  ('a0000319-0000-4000-8000-0000000000a1', 'e1000319-0000-4000-8000-000000000317', 'book_bank',
   'technician/a1000319-0000-4000-8000-000000000317/book_bank/v1.jpg',
   'a1000319-0000-4000-8000-000000000317');

-- The technician is a BOUND worker → must be refused from the staff flow.
insert into public.workers (id, name, pay_type, employment_type, day_rate, user_id, created_by) values
  ('aa000319-0000-4000-8000-000000000317', 'ช่าง ผูกแล้ว', 'daily', 'temporary', 500,
   'a3000319-0000-4000-8000-000000000317', 'b1000319-0000-4000-8000-000000000317');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

select has_table('public', 'staff_bank_change_requests', 'staff_bank_change_requests exists');
select ok((select relrowsecurity from pg_class where oid = 'public.staff_bank_change_requests'::regclass),
  'RLS enabled');

-- ============================================================================
-- Submit — approved own registration, NOT a bound worker, photo required+real.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1000319-0000-4000-8000-000000000317"}';
select throws_ok(
  $$ select public.submit_staff_bank_change('กสิกรไทย', '9998887776', 'บัญชี หนึ่ง', null) $$,
  'P0001', null, 'photo-less submit refused (passbook REQUIRED)');
select throws_ok(
  $$ select public.submit_staff_bank_change('กสิกรไทย', '9998887776', 'บัญชี หนึ่ง',
       'technician/a1000319-0000-4000-8000-000000000317/book_bank/ghost.jpg') $$,
  'P0001', null, 'a never-uploaded path is refused');
select throws_ok(
  $$ select public.submit_staff_bank_change('กสิกรไทย', '9998887776', 'บัญชี หนึ่ง',
       'technician/a2000319-0000-4000-8000-000000000317/book_bank/x.jpg') $$,
  '42501', null, 'a path in another user''s folder is refused');
insert into storage.objects (id, bucket_id, name) values
  (gen_random_uuid(), 'contact-docs',
   'technician/a1000319-0000-4000-8000-000000000317/book_bank/req1.jpg');
select isnt(
  (select public.submit_staff_bank_change('กสิกรไทย', '9998887776', 'บัญชี หนึ่ง',
     'technician/a1000319-0000-4000-8000-000000000317/book_bank/req1.jpg')),
  null, 'an approved staffer submits a photo-backed change');
select throws_ok(
  $$ select public.submit_staff_bank_change('x', '1', 'y',
       'technician/a1000319-0000-4000-8000-000000000317/book_bank/req1.jpg') $$,
  'P0001', null, 'a second pending request is refused');

set local "request.jwt.claims" = '{"sub": "a3000319-0000-4000-8000-000000000317"}';
select throws_ok(
  $$ select public.submit_staff_bank_change('กสิกรไทย', '1', 'ช่าง', null) $$,
  '42501', null, 'a BOUND worker is refused (their flow is worker_bank_change)');
set local "request.jwt.claims" = '{"sub": "a4000319-0000-4000-8000-000000000317"}';
select throws_ok(
  $$ select public.submit_staff_bank_change('กสิกรไทย', '1', 'ปฏิเสธ', null) $$,
  'P0001', null, 'a rejected registration cannot submit');
reset role;

-- ============================================================================
-- RLS reads — own + trio; PM and site_admin see nothing (money + trio-decided).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1000319-0000-4000-8000-000000000317"}';
select is((select count(*) from public.staff_bank_change_requests), 1::bigint,
  'the requester reads their own request');
set local "request.jwt.claims" = '{"sub": "b1000319-0000-4000-8000-000000000317"}';
select is((select count(*) from public.staff_bank_change_requests), 0::bigint,
  'project_manager reads none (trio-decided kind)');
set local "request.jwt.claims" = '{"sub": "c1000319-0000-4000-8000-000000000317"}';
select is((select count(*) from public.staff_bank_change_requests), 0::bigint,
  'site_admin reads none (money hidden)');
set local "request.jwt.claims" = '{"sub": "b2000319-0000-4000-8000-000000000317"}';
select is((select count(*) from public.staff_bank_change_requests), 1::bigint,
  'procurement_manager (trio) reads the queue');
reset role;

-- ============================================================================
-- Decide — trio only; approve upserts the bank + chains the doc.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b1000319-0000-4000-8000-000000000317"}';
select throws_ok(
  $$ select public.decide_staff_bank_change(
       (select id from public.staff_bank_change_requests where status = 'pending' limit 1),
       true) $$,
  '42501', null, 'project_manager cannot decide staff bank changes');
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b2000319-0000-4000-8000-000000000317"}';
select lives_ok(
  $$ select public.decide_staff_bank_change(
       (select id from public.staff_bank_change_requests
         where registration_id = 'e1000319-0000-4000-8000-000000000317' and status = 'pending'),
       true) $$,
  'procurement_manager approves');
reset role;

select is(
  (select bank_name || '|' || bank_account_number from public.staff_registration_bank
    where registration_id = 'e1000319-0000-4000-8000-000000000317'),
  'กสิกรไทย|9998887776', 'approve upserts staff_registration_bank');
select is(
  (select superseded_by from public.staff_registration_attachments
    where registration_id = 'e1000319-0000-4000-8000-000000000317'
      and purpose = 'book_bank' and storage_path like '%/req1.jpg'),
  'a0000319-0000-4000-8000-0000000000a1'::uuid,
  'the approved photo supersedes the prior book_bank doc');
select is(
  (select uploaded_by from public.staff_registration_attachments
    where storage_path like '%a1000319%/req1.jpg'),
  'a1000319-0000-4000-8000-000000000317'::uuid,
  'the chained doc is attributed to the requester');

-- ============================================================================
-- Reject — nothing flips.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1000319-0000-4000-8000-000000000317"}';
insert into storage.objects (id, bucket_id, name) values
  (gen_random_uuid(), 'contact-docs',
   'technician/a1000319-0000-4000-8000-000000000317/book_bank/req2.jpg');
select lives_ok(
  $$ select public.submit_staff_bank_change('ออมสิน', '5554443332', 'บัญชี หนึ่ง',
       'technician/a1000319-0000-4000-8000-000000000317/book_bank/req2.jpg') $$,
  'a second change submits after the first was decided');
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b2000319-0000-4000-8000-000000000317"}';
select lives_ok(
  $$ select public.decide_staff_bank_change(
       (select id from public.staff_bank_change_requests
         where registration_id = 'e1000319-0000-4000-8000-000000000317' and status = 'pending'),
       false) $$,
  'trio rejects the second change');
reset role;
select is(
  (select bank_name from public.staff_registration_bank
    where registration_id = 'e1000319-0000-4000-8000-000000000317'),
  'กสิกรไทย', 'reject leaves the live bank untouched');
select is(
  (select count(*) from public.staff_registration_attachments
    where registration_id = 'e1000319-0000-4000-8000-000000000317' and purpose = 'book_bank'),
  2::bigint, 'reject chains nothing (v1 + approved req1 only)');

-- ============================================================================
-- Pre-296 staffer with NO existing bank row / book_bank doc: approve INSERTS.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a2000319-0000-4000-8000-000000000317"}';
insert into storage.objects (id, bucket_id, name) values
  (gen_random_uuid(), 'contact-docs',
   'technician/a2000319-0000-4000-8000-000000000317/book_bank/first.jpg');
select lives_ok(
  $$ select public.submit_staff_bank_change('กรุงไทย', '1231231231', 'บัญชี สอง',
       'technician/a2000319-0000-4000-8000-000000000317/book_bank/first.jpg') $$,
  'a staffer with no prior bank row submits');
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b2000319-0000-4000-8000-000000000317"}';
select lives_ok(
  $$ select public.decide_staff_bank_change(
       (select id from public.staff_bank_change_requests
         where registration_id = 'e2000319-0000-4000-8000-000000000317' and status = 'pending'),
       true) $$,
  'approve with no prior bank row succeeds');
reset role;
select is(
  (select bank_name from public.staff_registration_bank
    where registration_id = 'e2000319-0000-4000-8000-000000000317'),
  'กรุงไทย', 'the bank row is INSERTED (upsert) when none existed');
select is(
  (select superseded_by is null from public.staff_registration_attachments
    where registration_id = 'e2000319-0000-4000-8000-000000000317' and purpose = 'book_bank'),
  true, 'the first chain link lands with a NULL prior');

-- ============================================================================
-- Grants.
-- ============================================================================
select is(
  (select count(*)::int from information_schema.role_routine_grants
     where routine_schema = 'public'
       and routine_name in ('submit_staff_bank_change', 'decide_staff_bank_change')
       and grantee in ('public', 'anon')),
  0, 'no PUBLIC/anon EXECUTE on either staff bank RPC');

select * from finish();
rollback;
