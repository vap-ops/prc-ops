begin;
select plan(78);

-- ============================================================================
-- Spec 264 G1 (ADR 0072) — the technician self-registration substrate is
-- generalized into a role-neutral STAFF self-onboarding substrate, and the
-- approve RPC becomes role-parametric.
--
-- Covers:
--  * RENAME — staff_registrations / staff_registration_attachments exist and the
--    old technician_* table names are GONE; enum staff_doc_purpose (id_card |
--    profile_photo, `consent` DROPPED) exists and technician_doc_purpose is gone;
--    can_see_staff_registration exists (technician helper gone); the self-serve
--    RPCs are renamed (start_/update_own_/add_..._staff_registration[_doc]).
--  * DATA-INDEPENDENT — a fixture pending row is queryable under the renamed table.
--  * declared_role_hint — new nullable column; threaded through start_/update_own_.
--  * staff_consents + record_staff_consent — the PDPA consent record (self-serve).
--  * approve_staff_registration(p_id, p_role, p_project_id) — role-parametric:
--     - approver gate: procurement_manager/project_director/super_admin CAN; every
--       other role incl. plain project_manager / plain procurement / site_admin /
--       visitor DENIED.
--     - STAFF_ASSIGNABLE_ROLES guard REJECTS visitor / contractor / client /
--       super_admin.
--     - FIELD role (technician) → status+role flip + workers row WITH phone/DOB/
--       emergency_* COPIED + role_change & worker_change audits.
--     - OFFICE role (accounting) → role flip, NO workers row, employee_id stays
--       carried on the staging row.
--     - floor rejects missing full_name / missing id_card / missing consent.
--  * reject_staff_registration — rename, writes nothing authoritative.
--  * anon-exec posture (revoke public,anon / grant authenticated) preserved on
--    every renamed/new DEFINER + append-only attachments still enforced.
-- ============================================================================

-- --- Renamed table holds rows (data-independent) -----------------------------
-- The rename ALTERed the table in place, so a pending registration is queryable
-- under the NEW table name. Rather than pin a specific live employee_id (which
-- drifts as production data is renumbered — e.g. the old PRC-26-0001 was renamed
-- to PRC-26-0002), seed a fixture pending row in this transaction and assert it
-- survives under the new table name. (Data-independent; matches how the other
-- 264 assertions use in-transaction fixtures — spec-243 test-hygiene pattern.)
insert into auth.users (id, email, raw_user_meta_data) values
  ('d0000264-0000-0000-0000-000000000264', 'renameFixture@t264.local', '{}'::jsonb);
insert into public.staff_registrations
  (id, user_id, employee_id, full_name, phone, status)
values ('e0000264-0000-0000-0000-000000000264', 'd0000264-0000-0000-0000-000000000264',
  'PRC-91-0264', 'ทดสอบ เปลี่ยนชื่อ', '0800000264', 'pending');
select ok(
  exists (select 1 from public.staff_registrations where employee_id = 'PRC-91-0264'),
  'a fixture pending registration is queryable under staff_registrations (rename survived)');

-- --- Actors -----------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('d1111111-1111-1111-1111-11111111d264', 'appTech@t264.local', '{}'::jsonb),  -- applicant → technician (field)
  ('d2222222-2222-2222-2222-22222222d264', 'appAcct@t264.local', '{}'::jsonb),  -- applicant → accounting (office)
  ('d3333333-3333-3333-3333-33333333d264', 'appGuard@t264.local','{}'::jsonb),  -- applicant → assignable-role guard target
  ('d4444444-4444-4444-4444-44444444d264', 'appFloor@t264.local','{}'::jsonb),  -- applicant → floor (no consent)
  ('d5555555-5555-5555-5555-55555555d264', 'appRej@t264.local',  '{}'::jsonb),  -- applicant → reject
  ('d6666666-6666-6666-6666-66666666d264', 'appSelf@t264.local', '{}'::jsonb),  -- applicant → self-serve RPC path
  ('daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaad264', 'pmgr@t264.local',    '{}'::jsonb),  -- procurement_manager (approver)
  ('dddddddd-dddd-dddd-dddd-ddddddddd264', 'pd@t264.local',      '{}'::jsonb),  -- project_director (approver)
  ('deeeeeee-eeee-eeee-eeee-eeeeeeeed264', 'super@t264.local',   '{}'::jsonb),  -- super_admin (approver)
  ('dfffffff-ffff-ffff-ffff-ffffffffd264', 'pm@t264.local',      '{}'::jsonb);  -- plain project_manager (DENIED)
update public.users set role='procurement_manager' where id='daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaad264';
update public.users set role='project_director'     where id='dddddddd-dddd-dddd-dddd-ddddddddd264';
update public.users set role='super_admin'          where id='deeeeeee-eeee-eeee-eeee-eeeeeeeed264';
update public.users set role='project_manager'      where id='dfffffff-ffff-ffff-ffff-ffffffffd264';

create temporary table _fix (k text primary key, v text) on commit drop;
grant select on _fix to authenticated;
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- RENAME — new objects exist, old ones gone.
-- ============================================================================
select has_table('public', 'staff_registrations', 'staff_registrations exists');
select has_table('public', 'staff_registration_attachments', 'staff_registration_attachments exists');
select hasnt_table('public', 'technician_registrations', 'technician_registrations is GONE');
select hasnt_table('public', 'technician_registration_attachments', 'technician_registration_attachments is GONE');

select has_type('public', 'staff_doc_purpose', 'staff_doc_purpose enum exists');
select enum_has_labels('public', 'staff_doc_purpose',
  array['id_card','profile_photo','book_bank'], 'staff_doc_purpose = (id_card, profile_photo, book_bank) — consent dropped, book_bank added (spec 296)');
select hasnt_type('public', 'technician_doc_purpose', 'technician_doc_purpose enum is GONE');
select col_type_is('public', 'staff_registration_attachments', 'purpose', 'staff_doc_purpose',
  'attachments.purpose is staff_doc_purpose');

select has_function('public', 'can_see_staff_registration', array['uuid'],
  'can_see_staff_registration helper exists');
select hasnt_function('public', 'can_see_technician_registration', array['uuid'],
  'can_see_technician_registration is GONE');
select has_function('public', 'start_staff_registration', array['text','text','text','uuid','uuid'],
  'start_staff_registration(text,text,text,uuid,uuid) exists (declared_role_hint + spec-279-F2b invite refs)');
select has_function('public', 'update_own_staff_registration',
  array['text','text','date','text','text','text','text'],
  'update_own_staff_registration exists (declared_role_hint threaded)');
select has_function('public', 'add_staff_registration_doc', array['staff_doc_purpose','text'],
  'add_staff_registration_doc exists');
select hasnt_function('public', 'start_technician_registration', array['text','text'],
  'start_technician_registration is GONE');
select hasnt_function('public', 'approve_technician_registration', array['uuid','uuid'],
  'approve_technician_registration is GONE');

-- new column + table
select has_column('public', 'staff_registrations', 'declared_role_hint', 'declared_role_hint column added');
select col_type_is('public', 'staff_registrations', 'declared_role_hint', 'text', 'declared_role_hint text');
select has_table('public', 'staff_consents', 'staff_consents table exists');
select has_function('public', 'record_staff_consent', array['staff_consent_kind'],
  'record_staff_consent(staff_consent_kind) exists');
select has_function('public', 'approve_staff_registration',
  array['uuid','user_role','uuid','pay_type','employment_type'],
  'approve_staff_registration(uuid, user_role, uuid, pay_type, employment_type) — role-parametric');
select has_function('public', 'reject_staff_registration', array['uuid','text'],
  'reject_staff_registration(uuid, text) exists');

-- RLS still enabled on the renamed tables + the new consents table.
select is((select relrowsecurity from pg_class where oid='public.staff_registrations'::regclass), true,
  'RLS on staff_registrations');
select is((select relrowsecurity from pg_class where oid='public.staff_registration_attachments'::regclass), true,
  'RLS on staff_registration_attachments');
select is((select relrowsecurity from pg_class where oid='public.staff_consents'::regclass), true,
  'RLS on staff_consents');

-- No direct write grant on the renamed PII table / the consents table.
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema='public' and table_name='staff_registrations'
      and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE')),
  0, 'no direct write grant on staff_registrations');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema='public' and table_name='staff_consents'
      and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE')),
  0, 'no direct write grant on staff_consents (RPC-only writes)');

-- anon-exec posture on every renamed/new DEFINER.
select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema='public'
      and routine_name in (
        'start_staff_registration','update_own_staff_registration',
        'add_staff_registration_doc','can_see_staff_registration',
        'record_staff_consent','approve_staff_registration','reject_staff_registration')
      and grantee in ('public','anon')),
  0, 'no PUBLIC/anon EXECUTE on any spec-264 function');
select function_privs_are('public', 'approve_staff_registration',
  array['uuid','user_role','uuid','pay_type','employment_type'],
  'authenticated', array['EXECUTE'], 'authenticated can execute approve_staff_registration');
select function_privs_are('public', 'record_staff_consent', array['staff_consent_kind'],
  'authenticated', array['EXECUTE'], 'authenticated can execute record_staff_consent');

-- ============================================================================
-- Self-serve path — start (with declared_role_hint) → consent → doc → update_own.
-- Applicant d6 walks the full self-serve flow to exercise the renamed RPCs.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "d6666666-6666-6666-6666-66666666d264"}';
select lives_ok(
  $$ select public.start_staff_registration('เทพ ทดสอบ', '0890000000', 'ช่างไฟ') $$,
  'visitor starts staff registration with a declared_role_hint');
select lives_ok($$ select public.record_staff_consent() $$, 'applicant records own PDPA consent');
select lives_ok(
  $$ select public.add_staff_registration_doc('id_card', 'technician/d6666666-6666-6666-6666-66666666d264/id_card/v1.jpg') $$,
  'applicant adds an id_card doc (staff_doc_purpose)');
select lives_ok(
  $$ select public.update_own_staff_registration(p_declared_role_hint := 'จัดซื้อ') $$,
  'applicant updates own declared_role_hint');
reset role;
select is((select declared_role_hint from public.staff_registrations where user_id='d6666666-6666-6666-6666-66666666d264'),
  'จัดซื้อ', 'declared_role_hint captured + updatable (advisory)');
select is((select count(*)::int from public.staff_consents where user_id='d6666666-6666-6666-6666-66666666d264' and revoked_at is null),
  1, 'one live PDPA consent record for the applicant');

-- profile_photo is a valid purpose; consent as a doc purpose is GONE (cast fails).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "d6666666-6666-6666-6666-66666666d264"}';
select lives_ok(
  $$ select public.add_staff_registration_doc('profile_photo', 'technician/d6666666-6666-6666-6666-66666666d264/profile_photo/v1.jpg') $$,
  'profile_photo is an accepted doc purpose');
select throws_ok(
  $$ select public.add_staff_registration_doc('consent'::text::public.staff_doc_purpose, 'x') $$,
  '22P02', null, 'consent is no longer a valid staff_doc_purpose (invalid enum input)');
reset role;

-- ============================================================================
-- Helper to seed a complete pending registration (full_name + id_card + consent)
-- for a given uid+emp. Direct inserts (pgTAP runs as owner).
-- ============================================================================
-- appTech (→ technician, field): complete + PII present.
insert into public.staff_registrations (id, user_id, employee_id, full_name, phone,
  date_of_birth, emergency_contact_name, emergency_contact_relation, emergency_contact_phone, status)
values ('e0000001-0000-0000-0000-0000000000d1', 'd1111111-1111-1111-1111-11111111d264',
  'PRC-91-0001', 'ช่าง สนาม', '0811111111',
  date '1992-03-04', 'แม่ ช่าง', 'มารดา', '0820000001', 'pending');
insert into public.staff_registration_attachments (registration_id, purpose, storage_path, uploaded_by)
values ('e0000001-0000-0000-0000-0000000000d1', 'id_card',
  'technician/d1111111-1111-1111-1111-11111111d264/id_card/v1.jpg', 'd1111111-1111-1111-1111-11111111d264');
insert into public.staff_consents (registration_id, user_id, kind, recorded_by)
values ('e0000001-0000-0000-0000-0000000000d1', 'd1111111-1111-1111-1111-11111111d264', 'pdpa_data', 'd1111111-1111-1111-1111-11111111d264');
-- Spec 296: approval floor now also requires a book_bank photo + a bank row.
insert into public.staff_registration_attachments (registration_id, purpose, storage_path, uploaded_by)
values ('e0000001-0000-0000-0000-0000000000d1', 'book_bank',
  'technician/d1111111-1111-1111-1111-11111111d264/book_bank/v1.jpg', 'd1111111-1111-1111-1111-11111111d264');
insert into public.staff_registration_bank (registration_id, bank_name, bank_account_number, bank_account_name, updated_by)
values ('e0000001-0000-0000-0000-0000000000d1', 'ธ.กสิกรไทย', '2640000001', 'ช่าง สนาม', 'd1111111-1111-1111-1111-11111111d264');

-- appAcct (→ accounting, office): complete.
insert into public.staff_registrations (id, user_id, employee_id, full_name, phone, status)
values ('e0000002-0000-0000-0000-0000000000a2', 'd2222222-2222-2222-2222-22222222d264',
  'PRC-91-0002', 'บัญชี สำนักงาน', '0822222222', 'pending');
insert into public.staff_registration_attachments (registration_id, purpose, storage_path, uploaded_by)
values ('e0000002-0000-0000-0000-0000000000a2', 'id_card',
  'technician/d2222222-2222-2222-2222-22222222d264/id_card/v1.jpg', 'd2222222-2222-2222-2222-22222222d264');
insert into public.staff_consents (registration_id, user_id, kind, recorded_by)
values ('e0000002-0000-0000-0000-0000000000a2', 'd2222222-2222-2222-2222-22222222d264', 'pdpa_data', 'd2222222-2222-2222-2222-22222222d264');
-- Spec 296: approval floor now also requires a book_bank photo + a bank row (office too).
insert into public.staff_registration_attachments (registration_id, purpose, storage_path, uploaded_by)
values ('e0000002-0000-0000-0000-0000000000a2', 'book_bank',
  'technician/d2222222-2222-2222-2222-22222222d264/book_bank/v1.jpg', 'd2222222-2222-2222-2222-22222222d264');
insert into public.staff_registration_bank (registration_id, bank_name, bank_account_number, bank_account_name, updated_by)
values ('e0000002-0000-0000-0000-0000000000a2', 'ธ.ไทยพาณิชย์', '2640000002', 'บัญชี สำนักงาน', 'd2222222-2222-2222-2222-22222222d264');

-- appGuard (→ assignable-role guard): complete.
insert into public.staff_registrations (id, user_id, employee_id, full_name, phone, status)
values ('e0000003-0000-0000-0000-0000000000d3', 'd3333333-3333-3333-3333-33333333d264',
  'PRC-91-0003', 'การ์ด ทดสอบ', '0833333333', 'pending');
insert into public.staff_registration_attachments (registration_id, purpose, storage_path, uploaded_by)
values ('e0000003-0000-0000-0000-0000000000d3', 'id_card',
  'technician/d3333333-3333-3333-3333-33333333d264/id_card/v1.jpg', 'd3333333-3333-3333-3333-33333333d264');
insert into public.staff_consents (registration_id, user_id, kind, recorded_by)
values ('e0000003-0000-0000-0000-0000000000d3', 'd3333333-3333-3333-3333-33333333d264', 'pdpa_data', 'd3333333-3333-3333-3333-33333333d264');

-- appFloor (→ floor: full_name + id_card present, NO consent record).
insert into public.staff_registrations (id, user_id, employee_id, full_name, phone, status)
values ('e0000004-0000-0000-0000-0000000000f4', 'd4444444-4444-4444-4444-44444444d264',
  'PRC-91-0004', 'ฟลอร์ ทดสอบ', '0844444444', 'pending');
insert into public.staff_registration_attachments (registration_id, purpose, storage_path, uploaded_by)
values ('e0000004-0000-0000-0000-0000000000f4', 'id_card',
  'technician/d4444444-4444-4444-4444-44444444d264/id_card/v1.jpg', 'd4444444-4444-4444-4444-44444444d264');

-- appRej (→ reject): complete.
insert into public.staff_registrations (id, user_id, employee_id, full_name, phone, status)
values ('e0000005-0000-0000-0000-0000000000d5', 'd5555555-5555-5555-5555-55555555d264',
  'PRC-91-0005', 'รีเจ็ค ทดสอบ', '0855555555', 'pending');

-- ============================================================================
-- Approver gate — only proc_mgr/PD/super may approve; others DENIED.
-- ============================================================================
set local role authenticated;
-- plain project_manager DENIED
set local "request.jwt.claims" = '{"sub": "dfffffff-ffff-ffff-ffff-ffffffffd264"}';
select throws_ok(
  $$ select public.approve_staff_registration('e0000001-0000-0000-0000-0000000000d1', 'technician') $$,
  '42501', null, 'plain project_manager DENIED approve');
-- the applicant themselves (visitor) DENIED
set local "request.jwt.claims" = '{"sub": "d1111111-1111-1111-1111-11111111d264"}';
select throws_ok(
  $$ select public.approve_staff_registration('e0000001-0000-0000-0000-0000000000d1', 'technician') $$,
  '42501', null, 'visitor applicant DENIED approve');
-- null-role fails closed
set local "request.jwt.claims" = '{}';
select throws_ok(
  $$ select public.approve_staff_registration('e0000001-0000-0000-0000-0000000000d1', 'technician') $$,
  '42501', null, 'null-role caller DENIED approve (fail closed)');
reset role;

-- ============================================================================
-- STAFF_ASSIGNABLE_ROLES guard — visitor/contractor/client/super_admin REJECTED
-- (checked as a proc_mgr approver so the p_role guard, not the approver gate, is
-- what raises).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaad264"}';
select throws_ok(
  $$ select public.approve_staff_registration('e0000003-0000-0000-0000-0000000000d3', 'visitor') $$,
  '42501', null, 'p_role=visitor REJECTED (not assignable)');
select throws_ok(
  $$ select public.approve_staff_registration('e0000003-0000-0000-0000-0000000000d3', 'contractor') $$,
  '42501', null, 'p_role=contractor REJECTED (external, Family B)');
select throws_ok(
  $$ select public.approve_staff_registration('e0000003-0000-0000-0000-0000000000d3', 'client') $$,
  '42501', null, 'p_role=client REJECTED (external, Family B)');
select throws_ok(
  $$ select public.approve_staff_registration('e0000003-0000-0000-0000-0000000000d3', 'super_admin') $$,
  '42501', null, 'p_role=super_admin REJECTED (privilege boundary)');
reset role;
-- The guard-rejected registration is untouched (still pending, no role flip).
select is((select status::text from public.staff_registrations where id='e0000003-0000-0000-0000-0000000000d3'),
  'pending', 'guard-rejected registration still pending');
select is((select role::text from public.users where id='d3333333-3333-3333-3333-33333333d264'),
  'visitor', 'guard-rejected applicant keeps visitor role');

-- ============================================================================
-- Floor — approve refused without a live PDPA consent (appFloor has name+id_card
-- but NO consent record).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaad264"}';
select throws_ok(
  $$ select public.approve_staff_registration('e0000004-0000-0000-0000-0000000000f4', 'technician') $$,
  'P0001', null, 'approve refused without a live PDPA consent record (floor)');
reset role;
select is((select count(*)::int from public.workers where user_id='d4444444-4444-4444-4444-44444444d264'),
  0, 'consent-floor-refused applicant has no workers row');

-- ============================================================================
-- FIELD role (technician) — full role+worker+PII-copy+audits. Approved by PD.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "dddddddd-dddd-dddd-dddd-ddddddddd264"}';
select lives_ok(
  $$ select public.approve_staff_registration('e0000001-0000-0000-0000-0000000000d1', 'technician') $$,
  'project_director approves a technician (field role)');
reset role;
select is((select status::text from public.staff_registrations where id='e0000001-0000-0000-0000-0000000000d1'),
  'approved', 'technician registration approved');
select is((select role::text from public.users where id='d1111111-1111-1111-1111-11111111d264'),
  'technician', 'applicant role flipped to technician');
select is((select count(*)::int from public.workers where user_id='d1111111-1111-1111-1111-11111111d264'),
  1, 'exactly one workers row created for the field role');
select is((select pay_type::text from public.workers where user_id='d1111111-1111-1111-1111-11111111d264'),
  'monthly', 'pay_type = monthly');
select is((select employee_id from public.workers where user_id='d1111111-1111-1111-1111-11111111d264'),
  'PRC-91-0001', 'workers.employee_id carried from the registration');
-- PII COPIED onto the worker (the spec-264 correction).
select is((select phone from public.workers where user_id='d1111111-1111-1111-1111-11111111d264'),
  '0811111111', 'worker.phone copied from the registration');
select is((select date_of_birth from public.workers where user_id='d1111111-1111-1111-1111-11111111d264'),
  date '1992-03-04', 'worker.date_of_birth copied from the registration');
select is((select emergency_contact_name from public.workers where user_id='d1111111-1111-1111-1111-11111111d264'),
  'แม่ ช่าง', 'worker.emergency_contact_name copied');
select is((select emergency_contact_relation from public.workers where user_id='d1111111-1111-1111-1111-11111111d264'),
  'มารดา', 'worker.emergency_contact_relation copied');
select is((select emergency_contact_phone from public.workers where user_id='d1111111-1111-1111-1111-11111111d264'),
  '0820000001', 'worker.emergency_contact_phone copied');
-- audits.
select is((select count(*)::int from public.audit_log
             where action='role_change' and target_table='users'
               and target_id='d1111111-1111-1111-1111-11111111d264'),
  1, 'one role_change audit for the field applicant');
select is((select count(*)::int from public.audit_log
             where action='worker_change' and target_table='workers'
               and payload->>'source'='staff_registration'
               and payload->>'registration_id'='e0000001-0000-0000-0000-0000000000d1'),
  1, 'one worker_change create audit (source=staff_registration)');

-- ============================================================================
-- OFFICE role (accounting) — role flip ONLY, NO workers row, employee_id stays.
-- Approved by super_admin.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "deeeeeee-eeee-eeee-eeee-eeeeeeeed264"}';
select is(
  (select public.approve_staff_registration('e0000002-0000-0000-0000-0000000000a2', 'accounting')),
  null,
  'approving an OFFICE role returns NULL (no worker id)');
reset role;
select is((select role::text from public.users where id='d2222222-2222-2222-2222-22222222d264'),
  'accounting', 'office applicant role flipped to accounting');
select is((select count(*)::int from public.workers where user_id='d2222222-2222-2222-2222-22222222d264'),
  0, 'NO workers row for the office role');
select is((select status::text from public.staff_registrations where id='e0000002-0000-0000-0000-0000000000a2'),
  'approved', 'office registration approved');
select is((select employee_id from public.staff_registrations where id='e0000002-0000-0000-0000-0000000000a2'),
  'PRC-91-0002', 'employee_id stays carried on the office staging row');
select is((select count(*)::int from public.audit_log
             where action='role_change' and target_id='d2222222-2222-2222-2222-22222222d264'),
  1, 'one role_change audit for the office applicant');
select is((select count(*)::int from public.audit_log
             where action='worker_change'
               and payload->>'registration_id'='e0000002-0000-0000-0000-0000000000a2'),
  0, 'no worker_change audit for the office role (no worker created)');

-- ============================================================================
-- Floor — missing full_name and missing id_card (reuse fresh applicants).
-- ============================================================================
insert into auth.users (id, email, raw_user_meta_data) values
  ('d7777777-7777-7777-7777-77777777d264', 'noName@t264.local', '{}'::jsonb),
  ('d8888888-8888-8888-8888-88888888d264', 'noDoc@t264.local',  '{}'::jsonb);
-- no full_name (but id_card + consent present)
insert into public.staff_registrations (id, user_id, employee_id, full_name, phone, status)
values ('e0000007-0000-0000-0000-0000000000d7', 'd7777777-7777-7777-7777-77777777d264',
  'PRC-91-0007', null, '0877777777', 'pending');
insert into public.staff_registration_attachments (registration_id, purpose, storage_path, uploaded_by)
values ('e0000007-0000-0000-0000-0000000000d7', 'id_card',
  'technician/d7777777-7777-7777-7777-77777777d264/id_card/v1.jpg', 'd7777777-7777-7777-7777-77777777d264');
insert into public.staff_consents (registration_id, user_id, kind, recorded_by)
values ('e0000007-0000-0000-0000-0000000000d7', 'd7777777-7777-7777-7777-77777777d264', 'pdpa_data', 'd7777777-7777-7777-7777-77777777d264');
-- full_name + consent but NO id_card
insert into public.staff_registrations (id, user_id, employee_id, full_name, phone, status)
values ('e0000008-0000-0000-0000-0000000000d8', 'd8888888-8888-8888-8888-88888888d264',
  'PRC-91-0008', 'โน ด็อค', '0888888888', 'pending');
insert into public.staff_consents (registration_id, user_id, kind, recorded_by)
values ('e0000008-0000-0000-0000-0000000000d8', 'd8888888-8888-8888-8888-88888888d264', 'pdpa_data', 'd8888888-8888-8888-8888-88888888d264');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "daaaaaaa-aaaa-aaaa-aaaa-aaaaaaaad264"}';
select throws_ok(
  $$ select public.approve_staff_registration('e0000007-0000-0000-0000-0000000000d7', 'technician') $$,
  'P0001', null, 'approve refused when full_name missing (floor)');
select throws_ok(
  $$ select public.approve_staff_registration('e0000008-0000-0000-0000-0000000000d8', 'technician') $$,
  'P0001', null, 'approve refused when id_card missing (floor)');
reset role;

-- ============================================================================
-- Reject (renamed) — status rejected + reason; NO worker, NO role change.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "deeeeeee-eeee-eeee-eeee-eeeeeeeed264"}';
select lives_ok(
  $$ select public.reject_staff_registration('e0000005-0000-0000-0000-0000000000d5', 'เอกสารไม่ครบ') $$,
  'super_admin rejects an applicant (renamed reject RPC)');
reset role;
select is((select status::text from public.staff_registrations where id='e0000005-0000-0000-0000-0000000000d5'),
  'rejected', 'reject flips status to rejected');
select is((select reject_reason from public.staff_registrations where id='e0000005-0000-0000-0000-0000000000d5'),
  'เอกสารไม่ครบ', 'reject_reason stored');
select is((select count(*)::int from public.workers where user_id='d5555555-5555-5555-5555-55555555d264'),
  0, 'rejected applicant has NO workers row');
select is((select role::text from public.users where id='d5555555-5555-5555-5555-55555555d264'),
  'visitor', 'rejected applicant keeps visitor role');

-- ============================================================================
-- Append-only attachments preserved through the rename.
-- ============================================================================
select throws_ok(
  $$ update public.staff_registration_attachments set storage_path='x'
       where registration_id='e0000001-0000-0000-0000-0000000000d1' $$,
  'P0001', null, 'staff_registration_attachments still append-only after rename (update blocked)');

-- ============================================================================
-- record_staff_consent gate — a caller with no registration is rejected.
-- ============================================================================
insert into auth.users (id, email, raw_user_meta_data) values
  ('d9999999-9999-9999-9999-99999999d264', 'noReg@t264.local', '{}'::jsonb);
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "d9999999-9999-9999-9999-99999999d264"}';
select throws_ok(
  $$ select public.record_staff_consent() $$,
  'P0001', null, 'record_staff_consent refused with no registration for the caller');
reset role;

select * from finish();
rollback;
