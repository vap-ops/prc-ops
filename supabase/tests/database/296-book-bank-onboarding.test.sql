begin;
select plan(27);

-- ============================================================================
-- Spec 296 U1 — book-bank capture at staff signup.
--
-- Covers:
--  * enum staff_doc_purpose gains 'book_bank' (id_card | profile_photo | book_bank).
--  * NEW zero-grant table staff_registration_bank (mirror contact_bank): RLS on,
--    NO anon/authenticated grant — reads/writes only via DEFINER RPCs / service-role.
--  * record_own_staff_bank(text,text,text) — own + PENDING guard; validates non-empty
--    + normalizes the account number to ^\d{6,20}$ (strips spaces/dashes); upsert 1:1.
--  * get_own_staff_bank() — owner reads back own declared bank (form prefill).
--  * anon-exec revoked on both new DEFINERs.
--  * approve_staff_registration floor gains: a live book_bank attachment AND a bank
--    row (all 3 fields non-empty) — unconditional, before the role branch.
--  * technician branch copies declared bank -> workers.bank_*; office role does NOT
--    (no worker row) but the bank row is retained.
--  * add_staff_registration_doc hardened: storage path segment[2]=uid & [3]=purpose.
-- ============================================================================

-- --- Actors -----------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('c0000296-0000-0000-0000-000000000296', 'owner@t296.local',    '{}'::jsonb),  -- pending applicant (RPC behaviour + add_doc)
  ('c1000296-0000-0000-0000-000000000296', 'tech@t296.local',     '{}'::jsonb),  -- full floor -> technician (bank copied)
  ('c2000296-0000-0000-0000-000000000296', 'acct@t296.local',     '{}'::jsonb),  -- full floor -> accounting (office, no worker)
  ('c3000296-0000-0000-0000-000000000296', 'nophoto@t296.local',  '{}'::jsonb),  -- bank row but NO book_bank photo
  ('c4000296-0000-0000-0000-000000000296', 'nobank@t296.local',   '{}'::jsonb),  -- book_bank photo but NO bank row
  ('c5000296-0000-0000-0000-000000000296', 'noreg@t296.local',    '{}'::jsonb),  -- no registration at all
  ('c6000296-0000-0000-0000-000000000296', 'approved@t296.local', '{}'::jsonb),  -- already-approved registration
  ('c7000296-0000-0000-0000-000000000296', 'sa@t296.local',       '{}'::jsonb),  -- site_admin (zero-grant read attempt)
  ('c9000296-0000-0000-0000-000000000296', 'super@t296.local',    '{}'::jsonb);  -- super_admin (approver)
update public.users set role='site_admin'  where id='c7000296-0000-0000-0000-000000000296';
update public.users set role='super_admin' where id='c9000296-0000-0000-0000-000000000296';

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- Structure.
-- ============================================================================
select enum_has_labels('public', 'staff_doc_purpose',
  array['id_card','profile_photo','book_bank'],
  'staff_doc_purpose = (id_card, profile_photo, book_bank)');
select has_table('public', 'staff_registration_bank', 'staff_registration_bank table exists');
select is((select relrowsecurity from pg_class where oid='public.staff_registration_bank'::regclass), true,
  'RLS enabled on staff_registration_bank');
select is(
  (select count(*)::int from information_schema.role_table_grants
     where table_schema='public' and table_name='staff_registration_bank'
       and grantee in ('anon','authenticated')),
  0, 'zero-grant: no anon/authenticated privileges on staff_registration_bank');
select has_function('public', 'record_own_staff_bank', array['text','text','text'],
  'record_own_staff_bank(text,text,text) exists');
select has_function('public', 'get_own_staff_bank', 'get_own_staff_bank() exists');
select is(
  (select count(*)::int from information_schema.role_routine_grants
     where routine_schema='public'
       and routine_name in ('record_own_staff_bank','get_own_staff_bank')
       and grantee in ('public','anon')),
  0, 'no PUBLIC/anon EXECUTE on the new bank RPCs');

-- ============================================================================
-- Fixtures — pending registrations (direct inserts; pgTAP runs as owner).
-- ============================================================================
insert into public.staff_registrations (id, user_id, employee_id, full_name, phone, status) values
  ('e0000296-0000-0000-0000-0000000000c0', 'c0000296-0000-0000-0000-000000000296', 'PRC-96-0000', 'เจ้าของ ทดสอบ', '0810000000', 'pending'),
  ('e0000296-0000-0000-0000-0000000000c1', 'c1000296-0000-0000-0000-000000000296', 'PRC-96-0001', 'ช่าง สนาม',   '0810000001', 'pending'),
  ('e0000296-0000-0000-0000-0000000000c2', 'c2000296-0000-0000-0000-000000000296', 'PRC-96-0002', 'บัญชี สนง.',  '0810000002', 'pending'),
  ('e0000296-0000-0000-0000-0000000000c3', 'c3000296-0000-0000-0000-000000000296', 'PRC-96-0003', 'ไม่มีรูป',    '0810000003', 'pending'),
  ('e0000296-0000-0000-0000-0000000000c4', 'c4000296-0000-0000-0000-000000000296', 'PRC-96-0004', 'ไม่มีบัญชี',  '0810000004', 'pending'),
  ('e0000296-0000-0000-0000-0000000000c6', 'c6000296-0000-0000-0000-000000000296', 'PRC-96-0006', 'อนุมัติแล้ว',  '0810000006', 'approved');

-- id_card + consent for the four approve-floor fixtures (tech, acct, nophoto, nobank).
insert into public.staff_registration_attachments (registration_id, purpose, storage_path, uploaded_by) values
  ('e0000296-0000-0000-0000-0000000000c1', 'id_card', 'technician/c1000296-0000-0000-0000-000000000296/id_card/v1.jpg', 'c1000296-0000-0000-0000-000000000296'),
  ('e0000296-0000-0000-0000-0000000000c2', 'id_card', 'technician/c2000296-0000-0000-0000-000000000296/id_card/v1.jpg', 'c2000296-0000-0000-0000-000000000296'),
  ('e0000296-0000-0000-0000-0000000000c3', 'id_card', 'technician/c3000296-0000-0000-0000-000000000296/id_card/v1.jpg', 'c3000296-0000-0000-0000-000000000296'),
  ('e0000296-0000-0000-0000-0000000000c4', 'id_card', 'technician/c4000296-0000-0000-0000-000000000296/id_card/v1.jpg', 'c4000296-0000-0000-0000-000000000296');
insert into public.staff_consents (registration_id, user_id, kind, recorded_by) values
  ('e0000296-0000-0000-0000-0000000000c1', 'c1000296-0000-0000-0000-000000000296', 'pdpa_data', 'c1000296-0000-0000-0000-000000000296'),
  ('e0000296-0000-0000-0000-0000000000c2', 'c2000296-0000-0000-0000-000000000296', 'pdpa_data', 'c2000296-0000-0000-0000-000000000296'),
  ('e0000296-0000-0000-0000-0000000000c3', 'c3000296-0000-0000-0000-000000000296', 'pdpa_data', 'c3000296-0000-0000-0000-000000000296'),
  ('e0000296-0000-0000-0000-0000000000c4', 'c4000296-0000-0000-0000-000000000296', 'pdpa_data', 'c4000296-0000-0000-0000-000000000296');
-- book_bank photo for tech, acct, nobank (NOT nophoto).
insert into public.staff_registration_attachments (registration_id, purpose, storage_path, uploaded_by) values
  ('e0000296-0000-0000-0000-0000000000c1', 'book_bank', 'technician/c1000296-0000-0000-0000-000000000296/book_bank/v1.jpg', 'c1000296-0000-0000-0000-000000000296'),
  ('e0000296-0000-0000-0000-0000000000c2', 'book_bank', 'technician/c2000296-0000-0000-0000-000000000296/book_bank/v1.jpg', 'c2000296-0000-0000-0000-000000000296'),
  ('e0000296-0000-0000-0000-0000000000c4', 'book_bank', 'technician/c4000296-0000-0000-0000-000000000296/book_bank/v1.jpg', 'c4000296-0000-0000-0000-000000000296');
-- bank rows for tech, acct, nophoto (NOT nobank).
insert into public.staff_registration_bank (registration_id, bank_name, bank_account_number, bank_account_name, updated_by) values
  ('e0000296-0000-0000-0000-0000000000c1', 'ธ.กสิกรไทย', '1112223334', 'ช่าง สนาม',  'c1000296-0000-0000-0000-000000000296'),
  ('e0000296-0000-0000-0000-0000000000c2', 'ธ.ไทยพาณิชย์', '5556667778', 'บัญชี สนง.', 'c2000296-0000-0000-0000-000000000296'),
  ('e0000296-0000-0000-0000-0000000000c3', 'ธ.กรุงเทพ',   '9990001112', 'ไม่มีรูป',   'c3000296-0000-0000-0000-000000000296');

-- ============================================================================
-- record_own_staff_bank + get_own_staff_bank — owner writes + normalizes + reads.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "c0000296-0000-0000-0000-000000000296"}';
select lives_ok(
  $$ select public.record_own_staff_bank('ธ.กสิกรไทย', '123-456 789', 'นาย ทดสอบ') $$,
  'owner records own pending bank (spaces/dashes accepted)');
select is((select bank_account_number from public.get_own_staff_bank()), '123456789',
  'account number normalized to digits and read back');
select is((select bank_name from public.get_own_staff_bank()), 'ธ.กสิกรไทย',
  'bank_name stored and read back via get_own_staff_bank');
select throws_ok(
  $$ select public.record_own_staff_bank('', '123456', 'นาย ทดสอบ') $$,
  'P0001', null, 'record_own_staff_bank rejects an empty bank name');
select throws_ok(
  $$ select public.record_own_staff_bank('ธ.กสิกรไทย', '12ab34', 'นาย ทดสอบ') $$,
  'P0001', null, 'record_own_staff_bank rejects a non-digit account number');
select throws_ok(
  $$ select public.record_own_staff_bank('ธ.กสิกรไทย', '12345', 'นาย ทดสอบ') $$,
  'P0001', null, 'record_own_staff_bank rejects a too-short (<6) account number');
reset role;

-- no registration for the caller -> 42501.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "c5000296-0000-0000-0000-000000000296"}';
select throws_ok(
  $$ select public.record_own_staff_bank('ธ.กสิกรไทย', '123456', 'นาย ทดสอบ') $$,
  '42501', null, 'record_own_staff_bank denied when the caller has no registration');
reset role;

-- already-approved registration -> not pending -> P0001.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "c6000296-0000-0000-0000-000000000296"}';
select throws_ok(
  $$ select public.record_own_staff_bank('ธ.กสิกรไทย', '123456', 'นาย ทดสอบ') $$,
  'P0001', null, 'record_own_staff_bank denied on a non-pending (approved) registration');
reset role;

-- ============================================================================
-- Zero-grant read — an authenticated site_admin cannot SELECT the bank table.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "c7000296-0000-0000-0000-000000000296"}';
select throws_ok(
  $$ select 1 from public.staff_registration_bank $$,
  '42501', null, 'zero-grant: an authenticated site_admin cannot SELECT staff_registration_bank');
reset role;

-- ============================================================================
-- Approval floor — book_bank photo AND bank row required (both P0001 when missing).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "c9000296-0000-0000-0000-000000000296"}';
select throws_ok(
  $$ select public.approve_staff_registration('e0000296-0000-0000-0000-0000000000c3', 'technician') $$,
  'P0001', null, 'approve refused without a book_bank attachment (floor)');
select throws_ok(
  $$ select public.approve_staff_registration('e0000296-0000-0000-0000-0000000000c4', 'technician') $$,
  'P0001', null, 'approve refused without a bank row (floor)');

-- Full floor met -> technician: worker created WITH bank copied.
select lives_ok(
  $$ select public.approve_staff_registration('e0000296-0000-0000-0000-0000000000c1', 'technician') $$,
  'approve a technician with full floor (book_bank + bank present)');
reset role;
select is((select bank_name from public.workers where user_id='c1000296-0000-0000-0000-000000000296'),
  'ธ.กสิกรไทย', 'worker.bank_name copied from the declared bank');
select is((select bank_account_number from public.workers where user_id='c1000296-0000-0000-0000-000000000296'),
  '1112223334', 'worker.bank_account_number copied from the declared bank');
select is((select bank_account_name from public.workers where user_id='c1000296-0000-0000-0000-000000000296'),
  'ช่าง สนาม', 'worker.bank_account_name copied from the declared bank');

-- Office role (accounting) -> role flip only, NO worker, bank row retained.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "c9000296-0000-0000-0000-000000000296"}';
select is(
  (select public.approve_staff_registration('e0000296-0000-0000-0000-0000000000c2', 'accounting')),
  null, 'approving an office role returns NULL (no worker id)');
reset role;
select is((select count(*)::int from public.workers where user_id='c2000296-0000-0000-0000-000000000296'),
  0, 'no workers row for the office role');
select is((select count(*)::int from public.staff_registration_bank where registration_id='e0000296-0000-0000-0000-0000000000c2'),
  1, 'the office applicant''s bank row is retained on the registration');

-- ============================================================================
-- add_staff_registration_doc hardening — path segment[3] must equal the purpose.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "c0000296-0000-0000-0000-000000000296"}';
select throws_ok(
  $$ select public.add_staff_registration_doc('book_bank', 'technician/c0000296-0000-0000-0000-000000000296/id_card/x.jpg') $$,
  '42501', null, 'add_staff_registration_doc rejects a path whose purpose segment mismatches');
select lives_ok(
  $$ select public.add_staff_registration_doc('book_bank', 'technician/c0000296-0000-0000-0000-000000000296/book_bank/x.jpg') $$,
  'add_staff_registration_doc accepts a conformant book_bank path');
reset role;

select * from finish();
rollback;
