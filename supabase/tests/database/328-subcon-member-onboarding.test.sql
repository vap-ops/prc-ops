begin;
select plan(19);

-- ============================================================================
-- Spec 328 U1 — subcontractor-member onboarding schema.
--
-- Covers:
--  * staff_registrations.invited_contractor_id (nullable FK -> contractors,
--    ON DELETE SET NULL) — the F2b-symmetric advisory invite ref.
--  * start_staff_registration re-signatured 5 -> 6 args (adds
--    p_invited_contractor_id, defaulted; old arity DROPPED; anon revoked on the
--    new signature); forged/unknown contractor ids existence-coerce to NULL.
--  * approve_staff_registration re-signatured 5 -> 6 args (adds p_contractor_id,
--    defaulted; old arity DROPPED; anon revoked):
--      - contractor arm FORCES role technician (any other role -> P0001);
--      - p_contractor_id must exist (approver-confirmed, never coerced) -> P0001;
--      - bank floors (book_bank attachment + staff_registration_bank row) are
--        SKIPPED on the contractor arm — id_card + PDPA floors STAY;
--      - minted worker: contractor_id set, pay_type FORCED 'daily', day_rate 0,
--        cost_confirmed_at NULL, bank columns NULL;
--      - PRC arm (p_contractor_id NULL) keeps the spec-296 bank floors verbatim.
-- ============================================================================

-- --- Actors -----------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('c0000328-0000-0000-0000-000000000328', 'member@t328.local',  '{}'::jsonb),  -- subcon member (contractor arm, no bank)
  ('c1000328-0000-0000-0000-000000000328', 'forged@t328.local',  '{}'::jsonb),  -- visitor who scans a forged contractor QR
  ('c2000328-0000-0000-0000-000000000328', 'prc@t328.local',     '{}'::jsonb),  -- PRC-arm applicant (bank floors must still hold)
  ('c9000328-0000-0000-0000-000000000328', 'super@t328.local',   '{}'::jsonb);  -- approver
update public.users set role='super_admin' where id='c9000328-0000-0000-0000-000000000328';

insert into public.contractors (id, name, created_by) values
  ('d0000328-0000-0000-0000-000000000328', 'ทีมทดสอบ 328 (ช่างอวย)', 'c9000328-0000-0000-0000-000000000328');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- Structure.
-- ============================================================================
select has_column('public', 'staff_registrations', 'invited_contractor_id',
  'staff_registrations.invited_contractor_id exists');
select is(
  (select rc.delete_rule::text
     from information_schema.referential_constraints rc
     join information_schema.key_column_usage k
       on k.constraint_name = rc.constraint_name and k.constraint_schema = rc.constraint_schema
    where k.table_schema='public' and k.table_name='staff_registrations'
      and k.column_name='invited_contractor_id'),
  'SET NULL', 'invited_contractor_id FK is ON DELETE SET NULL');
select has_function('public', 'start_staff_registration',
  array['text','text','text','uuid','uuid','uuid'],
  'start_staff_registration has the 6-arg signature');
select hasnt_function('public', 'start_staff_registration',
  array['text','text','text','uuid','uuid'],
  'old 5-arg start_staff_registration is dropped');
select has_function('public', 'approve_staff_registration',
  array['uuid','user_role','uuid','pay_type','employment_type','uuid'],
  'approve_staff_registration has the 6-arg signature');
select hasnt_function('public', 'approve_staff_registration',
  array['uuid','user_role','uuid','pay_type','employment_type'],
  'old 5-arg approve_staff_registration is dropped');
select is(
  (select count(*)::int from information_schema.role_routine_grants
     where routine_schema='public'
       and routine_name in ('start_staff_registration','approve_staff_registration')
       and grantee in ('public','anon')),
  0, 'no PUBLIC/anon EXECUTE on either re-signatured RPC');

-- ============================================================================
-- start_staff_registration — advisory contractor ref existence-coerces.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "c0000328-0000-0000-0000-000000000328"}';
select lives_ok(
  $$ select public.start_staff_registration('สมาชิก ทีมอวย', '0810000328', null, null, null,
       'd0000328-0000-0000-0000-000000000328') $$,
  'visitor starts a registration carrying a REAL contractor id');
reset role;
select is(
  (select invited_contractor_id from public.staff_registrations
    where user_id='c0000328-0000-0000-0000-000000000328'),
  'd0000328-0000-0000-0000-000000000328',
  'real contractor id lands on invited_contractor_id');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "c1000328-0000-0000-0000-000000000328"}';
select lives_ok(
  $$ select public.start_staff_registration('ปลอม คิวอาร์', '0810000329', null, null, null,
       'ffffffff-ffff-ffff-ffff-ffffffffffff') $$,
  'visitor start with a forged contractor id still lives');
reset role;
select is(
  (select invited_contractor_id from public.staff_registrations
    where user_id='c1000328-0000-0000-0000-000000000328'),
  null, 'forged contractor id existence-coerces to NULL');

-- ============================================================================
-- approve — contractor arm. Floors: id_card + PDPA only (NO book_bank, NO bank row).
-- ============================================================================
insert into public.staff_registration_attachments (registration_id, purpose, storage_path, uploaded_by)
select r.id, 'id_card', 'technician/' || r.user_id || '/id_card/v1.jpg', r.user_id
  from public.staff_registrations r
 where r.user_id = 'c0000328-0000-0000-0000-000000000328';
insert into public.staff_consents (registration_id, user_id, kind, recorded_by)
select r.id, r.user_id, 'pdpa_data', r.user_id
  from public.staff_registrations r
 where r.user_id = 'c0000328-0000-0000-0000-000000000328';

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "c9000328-0000-0000-0000-000000000328"}';

-- role guard: contractor arm refuses any non-technician role.
select throws_ok(
  $$ select public.approve_staff_registration(
       (select id from public.staff_registrations where user_id='c0000328-0000-0000-0000-000000000328'),
       'site_admin', null, 'daily', 'temporary',
       'd0000328-0000-0000-0000-000000000328') $$,
  'P0001', null, 'contractor arm refuses a non-technician role');

-- unknown contractor id: approver-confirmed value is validated, never coerced.
select throws_ok(
  $$ select public.approve_staff_registration(
       (select id from public.staff_registrations where user_id='c0000328-0000-0000-0000-000000000328'),
       'technician', null, 'daily', 'temporary',
       'ffffffff-ffff-ffff-ffff-ffffffffffff') $$,
  'P0001', null, 'contractor arm refuses an unknown contractor id');

-- happy path: approves WITHOUT book_bank attachment or bank row.
select lives_ok(
  $$ select public.approve_staff_registration(
       (select id from public.staff_registrations where user_id='c0000328-0000-0000-0000-000000000328'),
       'technician', null, 'monthly', 'temporary',
       'd0000328-0000-0000-0000-000000000328') $$,
  'contractor arm approves with NO bank data (id_card + PDPA floors only)');
reset role;

select is(
  (select w.contractor_id from public.workers w where w.user_id='c0000328-0000-0000-0000-000000000328'),
  'd0000328-0000-0000-0000-000000000328', 'minted worker carries contractor_id');
select is(
  (select w.pay_type::text || '|' || (w.day_rate = 0)::text from public.workers w
    where w.user_id='c0000328-0000-0000-0000-000000000328'),
  'daily|true', 'contractor member is pay_type daily at day_rate 0 (p_pay_type monthly IGNORED)');
select is(
  (select w.cost_confirmed_at from public.workers w where w.user_id='c0000328-0000-0000-0000-000000000328'),
  null, 'contractor member is never cost-confirmed');
select is(
  (select coalesce(w.bank_name, '') || coalesce(w.bank_account_number, '') || coalesce(w.bank_account_name, '')
     from public.workers w where w.user_id='c0000328-0000-0000-0000-000000000328'),
  '', 'no bank data lands on the contractor member');

-- ============================================================================
-- approve — PRC arm regression: bank floors still hold when p_contractor_id NULL.
-- ============================================================================
insert into public.staff_registrations (id, user_id, employee_id, full_name, phone, status) values
  ('e0000328-0000-0000-0000-0000000000c2', 'c2000328-0000-0000-0000-000000000328', 'PRC-28-9902', 'ช่าง พีอาร์ซี', '0810000330', 'pending');
insert into public.staff_registration_attachments (registration_id, purpose, storage_path, uploaded_by) values
  ('e0000328-0000-0000-0000-0000000000c2', 'id_card', 'technician/c2000328-0000-0000-0000-000000000328/id_card/v1.jpg', 'c2000328-0000-0000-0000-000000000328');
insert into public.staff_consents (registration_id, user_id, kind, recorded_by) values
  ('e0000328-0000-0000-0000-0000000000c2', 'c2000328-0000-0000-0000-000000000328', 'pdpa_data', 'c2000328-0000-0000-0000-000000000328');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "c9000328-0000-0000-0000-000000000328"}';
select throws_ok(
  $$ select public.approve_staff_registration(
       'e0000328-0000-0000-0000-0000000000c2', 'technician', null, 'daily', 'temporary') $$,
  'P0001', null, 'PRC arm (no contractor) still refuses without the spec-296 bank floors');
reset role;

select * from finish();
rollback;
