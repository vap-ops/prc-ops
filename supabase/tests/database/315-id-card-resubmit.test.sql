begin;
select plan(9);

-- ============================================================================
-- Spec 315 U1 — ID-card re-submit on an APPROVED registration (self-serve
-- supersede; operator decision 2026-07-14).
--
-- add_staff_registration_doc's gate relaxes to:
--   status = 'pending'  -> any purpose (unchanged), OR
--   status = 'approved' -> id_card ONLY (renewal; supersede chain keeps history).
-- Everything else stays refused: rejected registrations, and book_bank /
-- profile_photo on an approved registration (book_bank flips only via the U2
-- bank-change approve, so the photo can never contradict live workers.bank_*).
-- ============================================================================

-- --- Actors -----------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('c0000315-0000-0000-0000-000000000315', 'approved@t315.local', '{}'::jsonb),
  ('c1000315-0000-0000-0000-000000000315', 'pending@t315.local',  '{}'::jsonb),
  ('c2000315-0000-0000-0000-000000000315', 'rejected@t315.local', '{}'::jsonb);

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- --- Fixtures (direct inserts; pgTAP runs as owner) --------------------------
insert into public.staff_registrations (id, user_id, employee_id, full_name, phone, status) values
  ('e0000315-0000-0000-0000-0000000000c0', 'c0000315-0000-0000-0000-000000000315', 'PRC-15-0000', 'อนุมัติแล้ว ทดสอบ', '0815000000', 'approved'),
  ('e0000315-0000-0000-0000-0000000000c1', 'c1000315-0000-0000-0000-000000000315', 'PRC-15-0001', 'รอตรวจ ทดสอบ',    '0815000001', 'pending'),
  ('e0000315-0000-0000-0000-0000000000c2', 'c2000315-0000-0000-0000-000000000315', 'PRC-15-0002', 'ปฏิเสธ ทดสอบ',    '0815000002', 'rejected');

-- The approved registration's existing (current) id_card — the doc a renewal
-- must supersede, not replace.
insert into public.staff_registration_attachments (id, registration_id, purpose, storage_path, uploaded_by) values
  ('a0000315-0000-0000-0000-0000000000a1', 'e0000315-0000-0000-0000-0000000000c0', 'id_card',
   'technician/c0000315-0000-0000-0000-000000000315/id_card/v1.jpg',
   'c0000315-0000-0000-0000-000000000315');

-- ============================================================================
-- Approved owner CAN renew the id_card, and the supersede chain holds.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "c0000315-0000-0000-0000-000000000315"}';
select lives_ok(
  $$ select public.add_staff_registration_doc('id_card',
       'technician/c0000315-0000-0000-0000-000000000315/id_card/v2.jpg') $$,
  'approved owner re-submits an id_card (renewal)');
reset role;

select is(
  (select superseded_by from public.staff_registration_attachments
    where registration_id = 'e0000315-0000-0000-0000-0000000000c0'
      and purpose = 'id_card'
      and storage_path like '%/v2.jpg'),
  'a0000315-0000-0000-0000-0000000000a1'::uuid,
  'the renewal row supersedes the prior current id_card (chain, not overwrite)');

select is(
  (select a.storage_path from public.staff_registration_attachments a
    where a.registration_id = 'e0000315-0000-0000-0000-0000000000c0'
      and a.purpose = 'id_card'
      and not exists (select 1 from public.staff_registration_attachments n
                        where n.superseded_by = a.id)),
  'technician/c0000315-0000-0000-0000-000000000315/id_card/v2.jpg',
  'the anti-join current id_card is the renewal');

-- ============================================================================
-- Approved owner still CANNOT touch book_bank / profile_photo directly.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "c0000315-0000-0000-0000-000000000315"}';
select throws_ok(
  $$ select public.add_staff_registration_doc('book_bank',
       'technician/c0000315-0000-0000-0000-000000000315/book_bank/v9.jpg') $$,
  'P0001', null,
  'approved owner cannot self-swap the book_bank doc (bank evidence flips only via a decided bank change)');
select throws_ok(
  $$ select public.add_staff_registration_doc('profile_photo',
       'technician/c0000315-0000-0000-0000-000000000315/profile_photo/v9.jpg') $$,
  'P0001', null,
  'approved owner cannot re-submit a profile_photo (out of scope)');
-- The spec-296 owner/purpose path hardening still guards the new approved arm.
select throws_ok(
  $$ select public.add_staff_registration_doc('id_card',
       'technician/c1000315-0000-0000-0000-000000000315/id_card/forged.jpg') $$,
  '42501', null,
  'approved owner cannot record a path in another applicant''s folder');
reset role;

-- ============================================================================
-- Rejected registration stays closed.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "c2000315-0000-0000-0000-000000000315"}';
select throws_ok(
  $$ select public.add_staff_registration_doc('id_card',
       'technician/c2000315-0000-0000-0000-000000000315/id_card/v2.jpg') $$,
  'P0001', null,
  'rejected registration cannot add documents');
reset role;

-- ============================================================================
-- Pending flow unchanged (any purpose).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "c1000315-0000-0000-0000-000000000315"}';
select lives_ok(
  $$ select public.add_staff_registration_doc('id_card',
       'technician/c1000315-0000-0000-0000-000000000315/id_card/v1.jpg') $$,
  'pending owner still uploads an id_card');
select lives_ok(
  $$ select public.add_staff_registration_doc('book_bank',
       'technician/c1000315-0000-0000-0000-000000000315/book_bank/v1.jpg') $$,
  'pending owner still uploads a book_bank');
reset role;

select * from finish();
rollback;
