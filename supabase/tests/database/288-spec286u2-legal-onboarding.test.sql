begin;
select plan(12);

-- ============================================================================
-- Spec 286 U2 — admit `legal` (spec 284's office role) to staff onboarding.
-- approve_staff_registration's assignable-role allowlist gains 'legal'. Legal is
-- an OFFICE role: role flip ONLY, NO workers row (it is NOT in the field branch
-- `p_role in ('technician')`). The allowlist must NOT over-widen — a role still
-- off the list (client) stays rejected 42501. Grant posture unchanged.
-- Mirrors the office-role (accounting) block in 264-staff-registration.test.sql.
-- ============================================================================

-- legal is a real user_role label (spec 284 U1 enum add — the precondition).
select ok(
  exists (
    select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
     where t.typname = 'user_role' and e.enumlabel = 'legal'),
  'user_role has the legal label (spec 284 U1)');

-- --- Actors -----------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('d1111111-1111-1111-1111-1111111286a1', 'appLegal@t286.local', '{}'::jsonb),  -- applicant → legal (office)
  ('d2222222-2222-2222-2222-2222222286a2', 'appNo@t286.local',    '{}'::jsonb),  -- applicant → non-assignable guard
  ('deeeeeee-eeee-eeee-eeee-eeeeeeee286a', 'super@t286.local',    '{}'::jsonb);  -- super_admin (approver)
update public.users set role='super_admin' where id='deeeeeee-eeee-eeee-eeee-eeeeeeee286a';

-- Complete pending registrations (full_name + id_card + live PDPA consent).
insert into public.staff_registrations (id, user_id, employee_id, full_name, phone, status)
values ('e0000286-0000-0000-0000-0000000006e1', 'd1111111-1111-1111-1111-1111111286a1',
  'PRC-91-2861', 'ทนาย สำนักงาน', '0800002861', 'pending');
insert into public.staff_registration_attachments (registration_id, purpose, storage_path, uploaded_by)
values ('e0000286-0000-0000-0000-0000000006e1', 'id_card',
  'technician/d1111111-1111-1111-1111-1111111286a1/id_card/v1.jpg', 'd1111111-1111-1111-1111-1111111286a1');
insert into public.staff_consents (registration_id, user_id, kind, recorded_by)
values ('e0000286-0000-0000-0000-0000000006e1', 'd1111111-1111-1111-1111-1111111286a1', 'pdpa_data', 'd1111111-1111-1111-1111-1111111286a1');

insert into public.staff_registrations (id, user_id, employee_id, full_name, phone, status)
values ('e0000286-0000-0000-0000-0000000006e2', 'd2222222-2222-2222-2222-2222222286a2',
  'PRC-91-2862', 'โน แอสไซน์', '0800002862', 'pending');
insert into public.staff_registration_attachments (registration_id, purpose, storage_path, uploaded_by)
values ('e0000286-0000-0000-0000-0000000006e2', 'id_card',
  'technician/d2222222-2222-2222-2222-2222222286a2/id_card/v1.jpg', 'd2222222-2222-2222-2222-2222222286a2');
insert into public.staff_consents (registration_id, user_id, kind, recorded_by)
values ('e0000286-0000-0000-0000-0000000006e2', 'd2222222-2222-2222-2222-2222222286a2', 'pdpa_data', 'd2222222-2222-2222-2222-2222222286a2');

-- _tap_buf grants so an authenticated role-switched assertion can write (the
-- pgtap-tapbuf-grant-role-switch lesson — else 42501 fails the whole file).
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- OFFICE role (legal) — approving returns NULL (no worker), flips role, NO
-- workers row. Approved by super_admin.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "deeeeeee-eeee-eeee-eeee-eeeeeeee286a"}';
select is(
  (select public.approve_staff_registration('e0000286-0000-0000-0000-0000000006e1', 'legal')),
  null,
  'approving as legal (office role) returns NULL — no worker id');
reset role;

select is((select role::text from public.users where id='d1111111-1111-1111-1111-1111111286a1'),
  'legal', 'applicant role flipped to legal');
select is((select count(*)::int from public.workers where user_id='d1111111-1111-1111-1111-1111111286a1'),
  0, 'NO workers row for the legal (office) role');
select is((select status::text from public.staff_registrations where id='e0000286-0000-0000-0000-0000000006e1'),
  'approved', 'legal registration approved');
select is((select count(*)::int from public.audit_log
             where action='role_change' and target_id='d1111111-1111-1111-1111-1111111286a1'),
  1, 'one role_change audit for the legal applicant');
select is((select count(*)::int from public.audit_log
             where action='worker_change'
               and payload->>'registration_id'='e0000286-0000-0000-0000-0000000006e1'),
  0, 'no worker_change audit for the legal role (no worker created)');

-- ============================================================================
-- Allowlist did NOT over-widen — a role still off the list stays rejected.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "deeeeeee-eeee-eeee-eeee-eeeeeeee286a"}';
select throws_ok(
  $$ select public.approve_staff_registration('e0000286-0000-0000-0000-0000000006e2', 'client') $$,
  '42501', null, 'p_role=client STILL rejected (allowlist not over-widened)');
reset role;
select is((select status::text from public.staff_registrations where id='e0000286-0000-0000-0000-0000000006e2'),
  'pending', 'guard-rejected registration still pending');
select is((select role::text from public.users where id='d2222222-2222-2222-2222-2222222286a2'),
  'visitor', 'guard-rejected applicant keeps visitor role');

-- ============================================================================
-- Grant posture preserved (anon has no EXECUTE; authenticated does).
-- ============================================================================
select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema='public' and routine_name='approve_staff_registration'
      and grantee in ('public','anon')),
  0, 'no PUBLIC/anon EXECUTE on approve_staff_registration');
select function_privs_are('public', 'approve_staff_registration',
  array['uuid','user_role','uuid','pay_type','employment_type'],
  'authenticated', array['EXECUTE'], 'authenticated can execute approve_staff_registration');

select * from finish();
rollback;
