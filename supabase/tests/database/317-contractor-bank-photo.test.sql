begin;
select plan(18);

-- ============================================================================
-- Spec 317 U5 — contractor bank-change passbook parity (operator decision
-- 2026-07-14: same anti-fraud bar for every payout target). The contractor
-- submit gains a REQUIRED passbook photo (own contractor/<id>/ folder pin +
-- storage-existence check); approve additionally INSERTS the photo as the
-- newest contact_attachments 'bank_book' doc (contact docs are newest-wins,
-- not supersede-chained), so the stored evidence matches the live contact_bank.
-- ============================================================================

-- --- Actors -----------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('a1000320-0000-4000-8000-000000000317', 'dc@t317u5.local', '{}'::jsonb),
  ('b1000320-0000-4000-8000-000000000317', 'pm@t317u5.local', '{}'::jsonb);
update public.users set role = 'contractor'      where id = 'a1000320-0000-4000-8000-000000000317';
update public.users set role = 'project_manager' where id = 'b1000320-0000-4000-8000-000000000317';

insert into public.contractors (id, name, created_by) values
  ('cc000320-0000-4000-8000-000000000317', 'ผู้รับเหมา ทดสอบ U5', 'b1000320-0000-4000-8000-000000000317'),
  ('cd000320-0000-4000-8000-000000000317', 'ผู้รับเหมา อื่น', 'b1000320-0000-4000-8000-000000000317');
insert into public.contractor_users (contractor_id, user_id) values
  ('cc000320-0000-4000-8000-000000000317', 'a1000320-0000-4000-8000-000000000317');
insert into public.contact_bank (contractor_id, bank_name, bank_account_no, bank_account_name, updated_by) values
  ('cc000320-0000-4000-8000-000000000317', 'กรุงเทพ', '111222333', 'ผู้รับเหมา ทดสอบ',
   'b1000320-0000-4000-8000-000000000317');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

select has_column('public', 'contractor_bank_change_requests', 'bank_book_path',
  'contractor_bank_change_requests.bank_book_path exists');
select throws_ok(
  $$ select public.submit_contractor_bank_change('x', '1', 'y') $$,
  '42883', null, 'the 3-arg contractor submit signature is dropped');

-- ============================================================================
-- Submit — bound contractor, photo REQUIRED + own-folder pin + existence.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1000320-0000-4000-8000-000000000317"}';
select throws_ok(
  $$ select public.submit_contractor_bank_change('กสิกรไทย', '999888777', 'ผู้รับเหมา', null) $$,
  'P0001', null, 'photo-less submit refused (passbook REQUIRED)');
select throws_ok(
  $$ select public.submit_contractor_bank_change('กสิกรไทย', '999888777', 'ผู้รับเหมา',
       'contractor/cc000320-0000-4000-8000-000000000317/ghost.jpg') $$,
  'P0001', null, 'a never-uploaded path is refused');
select throws_ok(
  $$ select public.submit_contractor_bank_change('กสิกรไทย', '999888777', 'ผู้รับเหมา',
       'contractor/cd000320-0000-4000-8000-000000000317/x.jpg') $$,
  '42501', null, 'a path in another contractor''s folder is refused');
insert into storage.objects (id, bucket_id, name) values
  (gen_random_uuid(), 'contact-docs',
   'contractor/cc000320-0000-4000-8000-000000000317/req1.jpg');
select isnt(
  (select public.submit_contractor_bank_change('กสิกรไทย', '999888777', 'ผู้รับเหมา ทดสอบ',
     'contractor/cc000320-0000-4000-8000-000000000317/req1.jpg')),
  null, 'a bound contractor submits a photo-backed change');
select throws_ok(
  $$ select public.submit_contractor_bank_change('ออมสิน', '555666777', 'ผู้รับเหมา',
       'contractor/cc000320-0000-4000-8000-000000000317/req1.jpg') $$,
  'P0001', null, 'a second pending request is refused');
reset role;

-- ============================================================================
-- Approve — contact_bank updated + the photo lands as the newest bank_book doc.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b1000320-0000-4000-8000-000000000317"}';
select lives_ok(
  $$ select public.decide_contractor_bank_change(
       (select id from public.contractor_bank_change_requests
         where contractor_id = 'cc000320-0000-4000-8000-000000000317' and status = 'pending'),
       true) $$,
  'a manager approves the photo-backed change');
reset role;

select is(
  (select bank_name || '|' || bank_account_no from public.contact_bank
    where contractor_id = 'cc000320-0000-4000-8000-000000000317'),
  'กสิกรไทย|999888777', 'approve applies the typed fields to contact_bank');
select is(
  (select count(*) from public.contact_attachments
    where contractor_id = 'cc000320-0000-4000-8000-000000000317'
      and purpose = 'bank_book' and storage_path like '%/req1.jpg'),
  1::bigint, 'the approved photo lands as a bank_book attachment');
select is(
  (select uploaded_by from public.contact_attachments
    where contractor_id = 'cc000320-0000-4000-8000-000000000317'
      and storage_path like '%/req1.jpg'),
  'a1000320-0000-4000-8000-000000000317'::uuid,
  'the attachment is attributed to the requesting contractor user');

-- ============================================================================
-- Reject — nothing flips.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1000320-0000-4000-8000-000000000317"}';
insert into storage.objects (id, bucket_id, name) values
  (gen_random_uuid(), 'contact-docs',
   'contractor/cc000320-0000-4000-8000-000000000317/req2.jpg');
select lives_ok(
  $$ select public.submit_contractor_bank_change('ออมสิน', '555666777', 'ผู้รับเหมา ทดสอบ',
       'contractor/cc000320-0000-4000-8000-000000000317/req2.jpg') $$,
  'a second change submits after the first was decided');
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b1000320-0000-4000-8000-000000000317"}';
select lives_ok(
  $$ select public.decide_contractor_bank_change(
       (select id from public.contractor_bank_change_requests
         where contractor_id = 'cc000320-0000-4000-8000-000000000317' and status = 'pending'),
       false) $$,
  'a manager rejects the second change');
reset role;
select is(
  (select bank_name from public.contact_bank
    where contractor_id = 'cc000320-0000-4000-8000-000000000317'),
  'กสิกรไทย', 'reject leaves contact_bank untouched');
select is(
  (select count(*) from public.contact_attachments
    where contractor_id = 'cc000320-0000-4000-8000-000000000317' and purpose = 'bank_book'),
  1::bigint, 'reject inserts no attachment');

-- ============================================================================
-- Legacy photo-less pending row (pre-U5) stays decidable, no attachment.
-- ============================================================================
insert into public.contractor_bank_change_requests
  (id, contractor_id, bank_name, bank_account_no, bank_account_name, requested_by) values
  ('cb000320-0000-4000-8000-000000000317', 'cc000320-0000-4000-8000-000000000317',
   'Legacy', '123123', 'Legacy Co', 'a1000320-0000-4000-8000-000000000317');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b1000320-0000-4000-8000-000000000317"}';
select lives_ok(
  $$ select public.decide_contractor_bank_change('cb000320-0000-4000-8000-000000000317', true) $$,
  'a legacy photo-less pending row is still decidable');
reset role;
select is(
  (select count(*) from public.contact_attachments
    where contractor_id = 'cc000320-0000-4000-8000-000000000317' and purpose = 'bank_book'),
  1::bigint, 'legacy approve skips the attachment insert (no photo)');

-- ============================================================================
-- Grants.
-- ============================================================================
select is(
  (select count(*)::int from information_schema.role_routine_grants
     where routine_schema = 'public'
       and routine_name = 'submit_contractor_bank_change'
       and grantee in ('public', 'anon')),
  0, 'no PUBLIC/anon EXECUTE on the re-signatured contractor submit');

select * from finish();
rollback;
