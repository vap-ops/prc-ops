begin;
select plan(21);

-- ============================================================================
-- Spec 333 U1 — deferred-docs office approve (เข้าระบบก่อน ส่งเอกสารภายหลัง).
--
-- Covers:
--  * staff_registrations.documents_deferred_at (nullable timestamptz flag).
--  * approve_staff_registration re-signatured 6 -> 7 args (adds
--    p_defer_documents boolean default false; old arity DROPPED; anon revoked):
--      - defer + technician -> P0001 (the contractor arm is technician-only,
--        so this guard also excludes the subcon arm);
--      - defer (office role): id_card + book_bank + bank-row floors SKIPPED,
--        full_name + PDPA floors KEPT;
--      - success stamps documents_deferred_at and the role_change audit payload
--        carries documents_deferred=true; office role mints NO workers row;
--      - p_defer_documents=false (default) = today's behavior, floors verbatim.
--  * add_staff_registration_doc approved carve widened: book_bank accepted on
--    approved rows ONLY when documents_deferred_at is set (id_card carve from
--    spec 315 unchanged, any approved row).
--  * record_own_staff_bank accepted on approved rows ONLY when
--    documents_deferred_at is set.
--  * record_staff_consent UNCHANGED (pending-only — consent is never deferred).
-- ============================================================================

-- --- Actors -----------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('a1000333-0000-0000-0000-000000000333', 'office@t333.local',   '{}'::jsonb),  -- office (legal) applicant, deferred arm
  ('a2000333-0000-0000-0000-000000000333', 'tech@t333.local',     '{}'::jsonb),  -- technician applicant (defer refused)
  ('a3000333-0000-0000-0000-000000000333', 'plain@t333.local',    '{}'::jsonb),  -- approved WITHOUT deferral (carve must stay shut)
  ('a4000333-0000-0000-0000-000000000333', 'noname@t333.local',   '{}'::jsonb),  -- blank-name applicant (name floor kept)
  ('a9000333-0000-0000-0000-000000000333', 'approver@t333.local', '{}'::jsonb);  -- approver
update public.users set role='super_admin' where id='a9000333-0000-0000-0000-000000000333';

insert into public.staff_registrations (id, user_id, employee_id, full_name, phone, status) values
  ('b1000333-0000-0000-0000-000000000333', 'a1000333-0000-0000-0000-000000000333', 'PRC-33-9001', 'นิติกร ทดสอบ',  '0810003331', 'pending'),
  ('b2000333-0000-0000-0000-000000000333', 'a2000333-0000-0000-0000-000000000333', 'PRC-33-9002', 'ช่าง ทดสอบ',    '0810003332', 'pending'),
  ('b3000333-0000-0000-0000-000000000333', 'a3000333-0000-0000-0000-000000000333', 'PRC-33-9003', 'อนุมัติ ปกติ',   '0810003333', 'approved'),
  ('b4000333-0000-0000-0000-000000000333', 'a4000333-0000-0000-0000-000000000333', 'PRC-33-9004', null,            '0810003334', 'pending');

-- a2 carries PDPA so the floor that fires on the non-defer regression is id_card.
insert into public.staff_consents (registration_id, user_id, kind, recorded_by) values
  ('b2000333-0000-0000-0000-000000000333', 'a2000333-0000-0000-0000-000000000333', 'pdpa_data', 'a2000333-0000-0000-0000-000000000333');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- Structure.
-- ============================================================================
select has_column('public', 'staff_registrations', 'documents_deferred_at',
  'staff_registrations.documents_deferred_at exists');
select has_function('public', 'approve_staff_registration',
  array['uuid','user_role','uuid','pay_type','employment_type','uuid','boolean'],
  'approve_staff_registration has the 7-arg signature');
select hasnt_function('public', 'approve_staff_registration',
  array['uuid','user_role','uuid','pay_type','employment_type','uuid'],
  'old 6-arg approve_staff_registration is dropped');
select is(
  (select count(*)::int from information_schema.role_routine_grants
     where routine_schema='public' and routine_name='approve_staff_registration'
       and grantee in ('public','anon')),
  0, 'no PUBLIC/anon EXECUTE on the re-signatured approve RPC');

-- ============================================================================
-- Deferred arm — guards and kept floors.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a9000333-0000-0000-0000-000000000333"}';

-- F1: defer is not available for the field role (workers row + bank copy).
select throws_ok(
  $$ select public.approve_staff_registration(
       'b2000333-0000-0000-0000-000000000333', 'technician', null, 'monthly', 'permanent', null, true) $$,
  'P0001',
  'approve_staff_registration: deferred documents are not available for the technician role',
  'defer + technician is refused');

-- F2: the PDPA floor survives deferral (a1 has no consent yet).
select throws_ok(
  $$ select public.approve_staff_registration(
       'b1000333-0000-0000-0000-000000000333', 'legal', null, 'monthly', 'permanent', null, true) $$,
  'P0001',
  'approve_staff_registration: a PDPA consent record is required before approval',
  'defer still requires a live PDPA consent');

-- F3: the full_name floor survives deferral.
select throws_ok(
  $$ select public.approve_staff_registration(
       'b4000333-0000-0000-0000-000000000333', 'legal', null, 'monthly', 'permanent', null, true) $$,
  'P0001',
  'approve_staff_registration: full_name required before approval',
  'defer still requires full_name');

-- Regression: explicit p_defer_documents=false keeps today''s floors verbatim
-- (a2 has name + PDPA but no id_card -> the id_card floor fires).
select throws_ok(
  $$ select public.approve_staff_registration(
       'b2000333-0000-0000-0000-000000000333', 'technician', null, 'monthly', 'permanent', null, false) $$,
  'P0001',
  'approve_staff_registration: an id_card attachment is required before approval',
  'p_defer_documents=false leaves the document floors untouched');

reset role;

-- ============================================================================
-- Deferred arm — happy path (office role, name + PDPA only).
-- ============================================================================
insert into public.staff_consents (registration_id, user_id, kind, recorded_by) values
  ('b1000333-0000-0000-0000-000000000333', 'a1000333-0000-0000-0000-000000000333', 'pdpa_data', 'a1000333-0000-0000-0000-000000000333');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a9000333-0000-0000-0000-000000000333"}';
select lives_ok(
  $$ select public.approve_staff_registration(
       'b1000333-0000-0000-0000-000000000333', 'legal', null, 'monthly', 'permanent', null, true) $$,
  'office role approves deferred with NO id_card, NO book_bank, NO bank row');
reset role;

select isnt(
  (select documents_deferred_at from public.staff_registrations
    where id='b1000333-0000-0000-0000-000000000333'),
  null, 'documents_deferred_at is stamped on the deferred approval');
select is(
  (select role::text from public.users where id='a1000333-0000-0000-0000-000000000333'),
  'legal', 'the applicant got the office role');
select is(
  (select al.payload->>'documents_deferred' from public.audit_log al
    where al.action='role_change' and al.target_id='a1000333-0000-0000-0000-000000000333'
    order by al.created_at desc limit 1),
  'true', 'the role_change audit payload records documents_deferred=true');
select is(
  (select count(*)::int from public.workers w
    where w.user_id='a1000333-0000-0000-0000-000000000333'),
  0, 'an office role still mints no workers row');

-- ============================================================================
-- Upload-later carves (applicant sessions).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1000333-0000-0000-0000-000000000333"}';
select lives_ok(
  $$ select public.add_staff_registration_doc('book_bank',
       'technician/a1000333-0000-0000-0000-000000000333/book_bank/v1.jpg') $$,
  'approved + deferred row accepts a book_bank upload');
select lives_ok(
  $$ select public.record_own_staff_bank('กสิกรไทย', '1234567890', 'นิติกร ทดสอบ') $$,
  'approved + deferred row accepts the bank fields');
select throws_ok(
  $$ select public.record_staff_consent() $$,
  'P0001',
  'record_staff_consent: registration is no longer pending',
  'consent recording stays pending-only (PDPA is never deferred)');
reset role;

select is(
  (select count(*)::int from public.staff_registration_attachments a
    where a.registration_id='b1000333-0000-0000-0000-000000000333' and a.purpose='book_bank'
      and not exists (select 1 from public.staff_registration_attachments n where n.superseded_by = a.id)),
  1, 'the deferred book_bank upload landed live');
select is(
  (select b.bank_name || '|' || b.bank_account_number from public.staff_registration_bank b
    where b.registration_id='b1000333-0000-0000-0000-000000000333'),
  'กสิกรไทย|1234567890', 'the deferred bank row landed');

-- Approved WITHOUT deferral: book_bank stays shut, id_card carve (spec 315) stays open.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a3000333-0000-0000-0000-000000000333"}';
select throws_ok(
  $$ select public.add_staff_registration_doc('book_bank',
       'technician/a3000333-0000-0000-0000-000000000333/book_bank/v1.jpg') $$,
  'P0001',
  'add_staff_registration_doc: registration is no longer pending',
  'approved WITHOUT deferral still refuses a book_bank upload');
select lives_ok(
  $$ select public.add_staff_registration_doc('id_card',
       'technician/a3000333-0000-0000-0000-000000000333/id_card/v1.jpg') $$,
  'approved id_card renewal (spec 315 carve) still works');
select throws_ok(
  $$ select public.record_own_staff_bank('กรุงเทพ', '9876543210', 'อนุมัติ ปกติ') $$,
  'P0001',
  'record_own_staff_bank: registration is no longer pending',
  'approved WITHOUT deferral still refuses bank fields');
reset role;

select * from finish();
rollback;
