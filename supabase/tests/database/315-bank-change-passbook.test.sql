begin;
select plan(26);

-- ============================================================================
-- Spec 315 U2 — REQUIRED passbook photo on the worker bank-change request.
--
--  * worker_bank_change_requests gains book_bank_path (nullable: legacy rows).
--  * submit_worker_bank_change re-signatured to 4 args; the OLD 3-arg form is
--    DROPPED. Photo path REQUIRED + must be the caller's own
--    technician/<uid>/book_bank/… folder (spec-296 hardening mirrored).
--  * decide approve: workers.bank_* update (unchanged) + the request's photo
--    supersede-inserts into the worker's registration book_bank chain
--    (workers.user_id → staff_registrations.user_id), so the stored evidence
--    always matches the live payout bank. No registration / no photo → skip.
--  * reject writes nothing.
-- ============================================================================

-- --- Actors -----------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('a1000315-0000-4000-8000-000000000315', 'w1@t315.local', '{}'::jsonb),
  ('a2000315-0000-4000-8000-000000000315', 'w2@t315.local', '{}'::jsonb),
  ('a3000315-0000-4000-8000-000000000315', 'w3@t315.local', '{}'::jsonb),
  ('b1000315-0000-4000-8000-000000000315', 'pm@t315.local', '{}'::jsonb);
update public.users set role = 'technician'      where id in
  ('a1000315-0000-4000-8000-000000000315', 'a2000315-0000-4000-8000-000000000315',
   'a3000315-0000-4000-8000-000000000315');
update public.users set role = 'project_manager' where id = 'b1000315-0000-4000-8000-000000000315';

-- w1: bound worker WITH an approved registration (chain target).
-- w2: bound worker WITHOUT any registration (skip case).
-- w3: bound worker with an approved registration that has NO book_bank head yet
--     (the spec-298 capture-blind shape — first chain link lands with NULL prior).
insert into public.workers (id, name, pay_type, employment_type, day_rate, user_id, created_by) values
  ('aa000315-0000-4000-8000-000000000315', 'ช่าง หนึ่ง', 'daily', 'temporary', 500,
   'a1000315-0000-4000-8000-000000000315', 'b1000315-0000-4000-8000-000000000315'),
  ('ab000315-0000-4000-8000-000000000315', 'ช่าง สอง', 'daily', 'temporary', 500,
   'a2000315-0000-4000-8000-000000000315', 'b1000315-0000-4000-8000-000000000315'),
  ('ac000315-0000-4000-8000-000000000315', 'ช่าง สาม', 'daily', 'temporary', 500,
   'a3000315-0000-4000-8000-000000000315', 'b1000315-0000-4000-8000-000000000315');

insert into public.staff_registrations (id, user_id, employee_id, full_name, phone, status) values
  ('e1000315-0000-4000-8000-000000000315', 'a1000315-0000-4000-8000-000000000315',
   'PRC-15-0100', 'ช่าง หนึ่ง', '0815000100', 'approved'),
  ('e2000315-0000-4000-8000-000000000315', 'a3000315-0000-4000-8000-000000000315',
   'PRC-15-0102', 'ช่าง สาม', '0815000102', 'approved');
-- The registration's current book_bank photo (what an approved change must supersede).
insert into public.staff_registration_attachments (id, registration_id, purpose, storage_path, uploaded_by) values
  ('0b000315-0000-4000-8000-000000000315', 'e1000315-0000-4000-8000-000000000315', 'book_bank',
   'technician/a1000315-0000-4000-8000-000000000315/book_bank/v1.jpg',
   'a1000315-0000-4000-8000-000000000315');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- Structure + old signature retired.
-- ============================================================================
select has_column('public', 'worker_bank_change_requests', 'book_bank_path',
  'worker_bank_change_requests.book_bank_path exists');
select throws_ok(
  $$ select public.submit_worker_bank_change('x', '1', 'y') $$,
  '42883', null, 'the 3-arg submit signature is dropped');

-- ============================================================================
-- Submit — photo REQUIRED, own-folder + book_bank purpose enforced.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1000315-0000-4000-8000-000000000315"}';
select throws_ok(
  $$ select public.submit_worker_bank_change('กสิกรไทย', '1112223334', 'ช่าง หนึ่ง', null) $$,
  'P0001', null, 'photo-less submit refused (passbook REQUIRED)');
select throws_ok(
  $$ select public.submit_worker_bank_change('กสิกรไทย', '1112223334', 'ช่าง หนึ่ง',
       'technician/a2000315-0000-4000-8000-000000000315/book_bank/x.jpg') $$,
  '42501', null, 'a path in another user''s folder is refused');
select throws_ok(
  $$ select public.submit_worker_bank_change('กสิกรไทย', '1112223334', 'ช่าง หนึ่ง',
       'technician/a1000315-0000-4000-8000-000000000315/id_card/x.jpg') $$,
  '42501', null, 'a non-book_bank purpose folder is refused');
-- Well-formed but never-uploaded path → refused (dangling-evidence guard).
select throws_ok(
  $$ select public.submit_worker_bank_change('กสิกรไทย', '1112223334', 'ช่าง หนึ่ง',
       'technician/a1000315-0000-4000-8000-000000000315/book_bank/ghost.jpg') $$,
  'P0001', null, 'a path whose object was never uploaded is refused');
-- Upload the real object (own-folder storage RLS admits it), then submit.
insert into storage.objects (id, bucket_id, name) values
  (gen_random_uuid(), 'contact-docs',
   'technician/a1000315-0000-4000-8000-000000000315/book_bank/req1.jpg');
select isnt(
  (select public.submit_worker_bank_change('กสิกรไทย', '1112223334', 'ช่าง หนึ่ง',
     'technician/a1000315-0000-4000-8000-000000000315/book_bank/req1.jpg')),
  null, 'valid 4-arg submit succeeds');
reset role;

select is(
  (select book_bank_path from public.worker_bank_change_requests
    where worker_id = 'aa000315-0000-4000-8000-000000000315' and status = 'pending'),
  'technician/a1000315-0000-4000-8000-000000000315/book_bank/req1.jpg',
  'the request row stores the passbook path');

-- ============================================================================
-- Approve — workers.bank_* + the registration book_bank chain flip together.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b1000315-0000-4000-8000-000000000315"}';
select lives_ok(
  $$ select public.decide_worker_bank_change(
       (select id from public.worker_bank_change_requests
         where worker_id = 'aa000315-0000-4000-8000-000000000315' and status = 'pending'),
       true) $$,
  'PM approves the photo-backed change');
reset role;

select is(
  (select bank_name from public.workers where id = 'aa000315-0000-4000-8000-000000000315'),
  'กสิกรไทย', 'approve applies the typed fields to workers.bank_*');
select is(
  (select superseded_by from public.staff_registration_attachments
    where registration_id = 'e1000315-0000-4000-8000-000000000315'
      and purpose = 'book_bank'
      and storage_path like '%/req1.jpg'),
  '0b000315-0000-4000-8000-000000000315'::uuid,
  'approve supersedes the registration''s current book_bank with the request photo');
select is(
  (select uploaded_by from public.staff_registration_attachments
    where storage_path like '%/req1.jpg'),
  'a1000315-0000-4000-8000-000000000315'::uuid,
  'the chained doc is attributed to the requesting worker');

-- ============================================================================
-- Worker WITHOUT a registration — approve succeeds, chain skipped.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a2000315-0000-4000-8000-000000000315"}';
insert into storage.objects (id, bucket_id, name) values
  (gen_random_uuid(), 'contact-docs',
   'technician/a2000315-0000-4000-8000-000000000315/book_bank/req2.jpg');
select lives_ok(
  $$ select public.submit_worker_bank_change('กรุงเทพ', '5556667778', 'ช่าง สอง',
       'technician/a2000315-0000-4000-8000-000000000315/book_bank/req2.jpg') $$,
  'a registration-less bound worker still submits');
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b1000315-0000-4000-8000-000000000315"}';
select lives_ok(
  $$ select public.decide_worker_bank_change(
       (select id from public.worker_bank_change_requests
         where worker_id = 'ab000315-0000-4000-8000-000000000315' and status = 'pending'),
       true) $$,
  'approve succeeds when the worker has no registration (chain skipped)');
reset role;
select is(
  (select count(*) from public.staff_registration_attachments
    where storage_path like '%/req2.jpg'),
  0::bigint, 'no attachment row is minted for a registration-less worker');

-- ============================================================================
-- Reject — nothing flips.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1000315-0000-4000-8000-000000000315"}';
insert into storage.objects (id, bucket_id, name) values
  (gen_random_uuid(), 'contact-docs',
   'technician/a1000315-0000-4000-8000-000000000315/book_bank/req3.jpg');
select lives_ok(
  $$ select public.submit_worker_bank_change('ไทยพาณิชย์', '9990001112', 'ช่าง หนึ่ง',
       'technician/a1000315-0000-4000-8000-000000000315/book_bank/req3.jpg') $$,
  'w1 submits a second change after the first was decided');
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b1000315-0000-4000-8000-000000000315"}';
select lives_ok(
  $$ select public.decide_worker_bank_change(
       (select id from public.worker_bank_change_requests
         where worker_id = 'aa000315-0000-4000-8000-000000000315' and status = 'pending'),
       false) $$,
  'PM rejects the second change');
reset role;
select is(
  (select bank_name from public.workers where id = 'aa000315-0000-4000-8000-000000000315'),
  'กสิกรไทย', 'reject leaves workers.bank_* untouched');
select is(
  (select count(*) from public.staff_registration_attachments
    where registration_id = 'e1000315-0000-4000-8000-000000000315' and purpose = 'book_bank'),
  2::bigint, 'reject chains nothing (v1 + the approved req1 only)');

-- ============================================================================
-- Legacy photo-less pending row (pre-U2) stays decidable.
-- ============================================================================
insert into public.worker_bank_change_requests
  (id, worker_id, bank_name, bank_account_number, bank_account_name, requested_by) values
  ('cc000315-0000-4000-8000-000000000315', 'aa000315-0000-4000-8000-000000000315',
   'Legacy Bank', '123123123', 'ช่าง หนึ่ง', 'a1000315-0000-4000-8000-000000000315');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b1000315-0000-4000-8000-000000000315"}';
select lives_ok(
  $$ select public.decide_worker_bank_change('cc000315-0000-4000-8000-000000000315', true) $$,
  'a legacy photo-less pending row is still decidable');
reset role;
select is(
  (select count(*) from public.staff_registration_attachments
    where registration_id = 'e1000315-0000-4000-8000-000000000315' and purpose = 'book_bank'),
  2::bigint, 'legacy approve skips the chain (no photo to chain)');

-- ============================================================================
-- First chain link — a registration with NO book_bank head yet (spec-298
-- capture-blind shape): the approved photo lands with superseded_by NULL.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a3000315-0000-4000-8000-000000000315"}';
insert into storage.objects (id, bucket_id, name) values
  (gen_random_uuid(), 'contact-docs',
   'technician/a3000315-0000-4000-8000-000000000315/book_bank/req4.jpg');
select lives_ok(
  $$ select public.submit_worker_bank_change('ออมสิน', '4443332221', 'ช่าง สาม',
       'technician/a3000315-0000-4000-8000-000000000315/book_bank/req4.jpg') $$,
  'w3 (registration without a book_bank head) submits');
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b1000315-0000-4000-8000-000000000315"}';
select lives_ok(
  $$ select public.decide_worker_bank_change(
       (select id from public.worker_bank_change_requests
         where worker_id = 'ac000315-0000-4000-8000-000000000315' and status = 'pending'),
       true) $$,
  'approve chains onto a registration with no prior book_bank');
reset role;
select is(
  (select superseded_by is null from public.staff_registration_attachments
    where registration_id = 'e2000315-0000-4000-8000-000000000315' and purpose = 'book_bank'),
  true, 'the first chain link lands with a NULL prior (nothing to supersede)');

-- ============================================================================
-- Grants — anon/public can never execute either money mover.
-- ============================================================================
select is(
  (select count(*)::int from information_schema.role_routine_grants
     where routine_schema = 'public'
       and routine_name = 'submit_worker_bank_change'
       and grantee in ('public', 'anon')),
  0, 'no PUBLIC/anon EXECUTE on submit_worker_bank_change');
select is(
  (select count(*)::int from information_schema.role_routine_grants
     where routine_schema = 'public'
       and routine_name = 'decide_worker_bank_change'
       and grantee in ('public', 'anon')),
  0, 'no PUBLIC/anon EXECUTE on decide_worker_bank_change');

select * from finish();
rollback;
