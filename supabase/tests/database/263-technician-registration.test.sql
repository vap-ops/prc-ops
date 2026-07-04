begin;
select plan(64);

-- ============================================================================
-- Spec 263 U1b — technician self-registration data layer + self-serve write
-- path (ADR 0071). Covers: two new enums (registration_status,
-- technician_doc_purpose); three tables (technician_registrations,
-- technician_registration_attachments [append-only supersede], and
-- employee_id_counters); workers.employee_id partial-unique add; the three
-- self-serve SECURITY DEFINER RPCs (start / update_own / add_doc); the
-- can_see_technician_registration helper; RLS (applicant own-only, back-office
-- read-all, SA/site_owner read-only, cross-user denial, anon/authenticated no
-- direct write grant); the technician/<uid>/<purpose> storage policy;
-- PRC-YY-NNNN mint (format + per-year increment + gapless + rollback-safe) +
-- one-live-per-user.
--
-- Approver/write RPCs (approve/reject) are U1c — NOT tested here.
-- ============================================================================

-- --- Actors -----------------------------------------------------------------
-- Fresh auth.users insert auto-creates a public.users row defaulting to
-- 'visitor' (handle_new_user trigger), which is exactly the START gate.
insert into auth.users (id, email, raw_user_meta_data) values
  ('a1111111-1111-1111-1111-111111111263', 'appA@t263.local', '{}'::jsonb),   -- visitor applicant A
  ('a2222222-2222-2222-2222-222222222263', 'appB@t263.local', '{}'::jsonb),   -- visitor applicant B
  ('a3333333-3333-3333-3333-333333333263', 'pmgr@t263.local', '{}'::jsonb),   -- procurement_manager (back office)
  ('a4444444-4444-4444-4444-444444444263', 'sa@t263.local',   '{}'::jsonb),   -- site_admin (read-only)
  ('a5555555-5555-5555-5555-555555555263', 'proc@t263.local', '{}'::jsonb),   -- plain procurement (NOT back-office reader here)
  ('a6666666-6666-6666-6666-666666666263', 'own@t263.local',  '{}'::jsonb);   -- site_owner (read-only)
update public.users set role='procurement_manager' where id='a3333333-3333-3333-3333-333333333263';
update public.users set role='site_admin'          where id='a4444444-4444-4444-4444-444444444263';
update public.users set role='procurement'         where id='a5555555-5555-5555-5555-555555555263';
update public.users set role='site_owner'          where id='a6666666-6666-6666-6666-666666666263';
-- applicant A and B stay 'visitor' (trigger default).

create temporary table _fix (k text primary key, v text) on commit drop;
grant select on _fix to authenticated;
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- Enums
-- ============================================================================
select has_type('public', 'registration_status', 'registration_status enum exists');
select enum_has_labels('public', 'registration_status',
  array['pending','approved','rejected'], 'registration_status labels');
select has_type('public', 'technician_doc_purpose', 'technician_doc_purpose enum exists');
select enum_has_labels('public', 'technician_doc_purpose',
  array['id_card','consent','profile_photo'], 'technician_doc_purpose labels');

-- ============================================================================
-- Tables + columns
-- ============================================================================
select has_table('public', 'technician_registrations', 'technician_registrations exists');
select col_is_pk('public', 'technician_registrations', 'id', 'registrations pk');
select col_type_is('public', 'technician_registrations', 'user_id', 'uuid', 'registrations.user_id uuid');
select col_type_is('public', 'technician_registrations', 'employee_id', 'text', 'registrations.employee_id text');
select col_type_is('public', 'technician_registrations', 'status', 'registration_status', 'registrations.status enum');
select col_not_null('public', 'technician_registrations', 'employee_id', 'employee_id NOT NULL');
select col_default_is('public', 'technician_registrations', 'status', 'pending'::public.registration_status, 'status defaults pending');
select col_is_unique('public', 'technician_registrations', 'user_id', 'user_id UNIQUE (one per person)');
select col_is_unique('public', 'technician_registrations', 'employee_id', 'employee_id UNIQUE');

select has_table('public', 'technician_registration_attachments', 'attachments table exists');
select col_type_is('public', 'technician_registration_attachments', 'purpose', 'technician_doc_purpose', 'attachments.purpose enum');
select col_type_is('public', 'technician_registration_attachments', 'superseded_by', 'uuid', 'attachments.superseded_by uuid (supersede chain)');

select has_table('public', 'employee_id_counters', 'employee_id_counters exists');
select col_is_pk('public', 'employee_id_counters', 'year', 'counters pk year');

-- workers.employee_id partial-unique add (existing table)
select has_column('public', 'workers', 'employee_id', 'workers.employee_id added');
select col_type_is('public', 'workers', 'employee_id', 'text', 'workers.employee_id text');

-- RLS enabled on all three new tables
select is((select relrowsecurity from pg_class where oid='public.technician_registrations'::regclass), true,
  'RLS on technician_registrations');
select is((select relrowsecurity from pg_class where oid='public.technician_registration_attachments'::regclass), true,
  'RLS on technician_registration_attachments');
select is((select relrowsecurity from pg_class where oid='public.employee_id_counters'::regclass), true,
  'RLS on employee_id_counters');

-- ============================================================================
-- No direct write grant for anon/authenticated on the PII tables (writes are
-- RPC-only). SELECT stays granted to authenticated (RLS-scoped).
-- ============================================================================
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema='public' and table_name='technician_registrations'
      and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE')),
  0, 'no direct INSERT/UPDATE/DELETE grant on technician_registrations for anon/authenticated');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema='public' and table_name='technician_registration_attachments'
      and grantee in ('anon','authenticated') and privilege_type in ('INSERT','UPDATE','DELETE')),
  0, 'no direct write grant on technician_registration_attachments for anon/authenticated');
select is(
  (select count(*)::int from information_schema.role_table_grants
    where table_schema='public' and table_name='technician_registrations'
      and grantee='authenticated' and privilege_type='SELECT'),
  1, 'authenticated has SELECT on technician_registrations (RLS-scoped)');

-- ============================================================================
-- START — requires visitor + binds uid + mints PRC-YY-NNNN
-- ============================================================================
-- Non-visitor (procurement_manager) cannot start.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a3333333-3333-3333-3333-333333333263"}';
select throws_ok(
  $$ select public.start_technician_registration('มานะ', '0810000000') $$,
  '42501', null, 'non-visitor (procurement_manager) cannot start');
reset role;

-- unbound caller fails closed.
set local role authenticated;
set local "request.jwt.claims" = '{}';
select throws_ok(
  $$ select public.start_technician_registration('x', '0800000000') $$,
  '42501', null, 'unbound caller cannot start (fail closed)');
reset role;

-- Applicant A starts → gets an employee id.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111263"}';
select lives_ok(
  $$ select public.start_technician_registration('สมชาย ช่างดี', '0811111111') $$,
  'visitor A starts registration');
reset role;
insert into _fix values ('empA',
  (select employee_id from public.technician_registrations where user_id='a1111111-1111-1111-1111-111111111263'));
insert into _fix values ('regA',
  (select id::text from public.technician_registrations where user_id='a1111111-1111-1111-1111-111111111263'));

-- Employee id matches PRC-YY-NNNN with the CURRENT Asia/Bangkok 2-digit year.
select is(
  (select v from _fix where k='empA'),
  'PRC-' || to_char((now() at time zone 'Asia/Bangkok'), 'YY') || '-0001',
  'A minted PRC-YY-0001 (first of the year, Bangkok year)');

-- Row is pending, bound to A's uid, full_name captured.
select is((select status::text from public.technician_registrations where user_id='a1111111-1111-1111-1111-111111111263'),
  'pending', 'A row is pending');
select is((select full_name from public.technician_registrations where user_id='a1111111-1111-1111-1111-111111111263'),
  'สมชาย ช่างดี', 'A full_name captured at start');

-- One-live-per-user: A cannot start again.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111263"}';
select throws_ok(
  $$ select public.start_technician_registration('สมชาย', '0811111111') $$,
  null, null, 'A cannot start a second registration (one-live-per-user)');
reset role;

-- Applicant B starts → next per-year number (gapless increment).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a2222222-2222-2222-2222-222222222263"}';
select lives_ok(
  $$ select public.start_technician_registration('Aung', '0822222222') $$,
  'visitor B starts registration');
reset role;
select is(
  (select employee_id from public.technician_registrations where user_id='a2222222-2222-2222-2222-222222222263'),
  'PRC-' || to_char((now() at time zone 'Asia/Bangkok'), 'YY') || '-0002',
  'B minted PRC-YY-0002 (per-year increment, gapless)');

-- Counter next_val advanced to 3 for this year.
select is(
  (select next_val from public.employee_id_counters
    where year = (to_char((now() at time zone 'Asia/Bangkok'), 'YY'))::int),
  3, 'counter next_val = 3 after two mints this year');

-- ============================================================================
-- update_own — applicant, own row, pending-only, self fields only
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111263"}';
select lives_ok(
  $$ select public.update_own_technician_registration(
       p_full_name := 'สมชาย ช่างเอก',
       p_phone := '0819999999',
       p_date_of_birth := date '1990-05-01',
       p_emergency_contact_name := 'สมหญิง',
       p_emergency_contact_relation := 'พี่สาว',
       p_emergency_contact_phone := '0820000000') $$,
  'A updates own registration self-fields');
reset role;
select is((select date_of_birth from public.technician_registrations where user_id='a1111111-1111-1111-1111-111111111263'),
  date '1990-05-01', 'A dob updated');
select is((select emergency_contact_name from public.technician_registrations where user_id='a1111111-1111-1111-1111-111111111263'),
  'สมหญิง', 'A emergency contact name updated');
-- employee_id + status must be untouched by update_own.
select is((select employee_id from public.technician_registrations where user_id='a1111111-1111-1111-1111-111111111263'),
  (select v from _fix where k='empA'), 'A employee_id unchanged by update_own');

-- CROSS-USER DENIAL: B cannot update A's row (B updates only their own; A's
-- row is untouched — verify A's dob is unchanged after B's self-update).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a2222222-2222-2222-2222-222222222263"}';
select lives_ok(
  $$ select public.update_own_technician_registration(p_full_name := 'Aung Min') $$,
  'B updates own row');
reset role;
select is((select full_name from public.technician_registrations where user_id='a1111111-1111-1111-1111-111111111263'),
  'สมชาย ช่างเอก', 'A full_name NOT affected by B update (cross-user isolation)');
select is((select full_name from public.technician_registrations where user_id='a2222222-2222-2222-2222-222222222263'),
  'Aung Min', 'B own full_name updated');

-- update_own with no live row for the caller is rejected (a fresh visitor with
-- no registration).
insert into auth.users (id, email, raw_user_meta_data) values
  ('a7777777-7777-7777-7777-777777777263', 'noreg@t263.local', '{}'::jsonb);
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a7777777-7777-7777-7777-777777777263"}';
select throws_ok(
  $$ select public.update_own_technician_registration(p_full_name := 'x') $$,
  null, null, 'update_own with no registration row is rejected');
reset role;

-- ============================================================================
-- add_doc — applicant own row pending-only + supersede (append-only)
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111263"}';
select lives_ok(
  $$ select public.add_technician_registration_doc('id_card', 'technician/a1111111-1111-1111-1111-111111111263/id_card/v1.jpg') $$,
  'A adds an id_card doc');
reset role;
insert into _fix values ('docA1',
  (select id::text from public.technician_registration_attachments
     where registration_id=(select v::uuid from _fix where k='regA') and purpose='id_card'));

-- Re-upload same purpose supersedes: a new row whose superseded_by points at
-- the prior row (skill canonical direction: new.superseded_by = old.id).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111263"}';
select lives_ok(
  $$ select public.add_technician_registration_doc('id_card', 'technician/a1111111-1111-1111-1111-111111111263/id_card/v2.jpg') $$,
  'A re-uploads id_card (supersede)');
reset role;

-- Exactly ONE live (head) id_card row for A's registration via the anti-join.
select is(
  (select count(*)::int from public.technician_registration_attachments a
    where a.registration_id=(select v::uuid from _fix where k='regA')
      and a.purpose='id_card'
      and not exists (select 1 from public.technician_registration_attachments n
                       where n.superseded_by = a.id)),
  1, 'exactly one live id_card head row after supersede (anti-join)');
-- The new head points at the old row.
select is(
  (select count(*)::int from public.technician_registration_attachments
    where superseded_by = (select v::uuid from _fix where k='docA1')),
  1, 'the re-upload row supersedes the original id_card row');
-- Two physical rows total (append-only, nothing deleted).
select is(
  (select count(*)::int from public.technician_registration_attachments a
    where a.registration_id=(select v::uuid from _fix where k='regA') and a.purpose='id_card'),
  2, 'both id_card rows persist (append-only)');

-- Append-only: even a superuser UPDATE is blocked on attachments.
select throws_ok(
  $$ update public.technician_registration_attachments set storage_path='x'
       where id = (select v::uuid from _fix where k='docA1') $$,
  'P0001', null, 'technician_registration_attachments rows are append-only (update blocked)');

-- CROSS-USER DENIAL: B cannot add a doc onto A's registration (add_doc always
-- targets the CALLER's own registration; B has their own, so B's add lands on
-- B's row, never A's). Verify A's attachment count is unchanged.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a2222222-2222-2222-2222-222222222263"}';
select lives_ok(
  $$ select public.add_technician_registration_doc('consent', 'technician/a2222222-2222-2222-2222-222222222263/consent/v1.jpg') $$,
  'B adds own consent doc');
reset role;
select is(
  (select count(*)::int from public.technician_registration_attachments a
     join public.technician_registrations r on r.id=a.registration_id
    where r.user_id='a1111111-1111-1111-1111-111111111263'),
  2, 'A attachment set NOT grown by B (cross-user isolation)');

-- ============================================================================
-- RLS reads
-- ============================================================================
-- Applicant A reads ONLY own registration.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a1111111-1111-1111-1111-111111111263"}';
select is((select count(*)::int from public.technician_registrations), 1,
  'applicant A sees exactly 1 registration (own)');
select is((select count(*)::int from public.technician_registrations where user_id='a2222222-2222-2222-2222-222222222263'), 0,
  'applicant A cannot read B registration (cross-user read denied)');
select is((select count(*)::int from public.technician_registration_attachments a
             join public.technician_registrations r on r.id=a.registration_id
            where r.user_id='a2222222-2222-2222-2222-222222222263'), 0,
  'applicant A cannot read B attachments');
reset role;

-- Back-office (procurement_manager) reads ALL registrations + attachments.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a3333333-3333-3333-3333-333333333263"}';
select is((select count(*)::int from public.technician_registrations), 2,
  'procurement_manager reads all registrations (2)');
select ok((select count(*)::int from public.technician_registration_attachments) >= 3,
  'procurement_manager reads all attachments');
reset role;

-- SA gets a read-only view of applicants (pending queue via can_see helper).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a4444444-4444-4444-4444-444444444263"}';
select is((select count(*)::int from public.technician_registrations), 2,
  'site_admin reads the pending applicant queue (read-only seam)');
reset role;

-- site_owner likewise read-only.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a6666666-6666-6666-6666-666666666263"}';
select is((select count(*)::int from public.technician_registrations), 2,
  'site_owner reads the pending applicant queue (read-only seam)');
reset role;

-- plain procurement is NOT in the back-office reader set here and is not the
-- owner → sees nothing.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "a5555555-5555-5555-5555-555555555263"}';
select is((select count(*)::int from public.technician_registrations), 0,
  'plain procurement reads zero registrations (not in reader set)');
reset role;

-- can_see_technician_registration helper exists + has no PUBLIC/anon execute.
select has_function('public', 'can_see_technician_registration', array['uuid'],
  'can_see_technician_registration helper exists');

-- ============================================================================
-- DEFINER grant posture — no PUBLIC/anon EXECUTE on any of the new functions.
-- ============================================================================
select is(
  (select count(*)::int from information_schema.role_routine_grants
    where routine_schema='public'
      and routine_name in (
        'start_technician_registration','update_own_technician_registration',
        'add_technician_registration_doc','can_see_technician_registration')
      and grantee in ('public','anon')),
  0, 'no PUBLIC/anon EXECUTE on any spec-263 self-serve function');

-- ============================================================================
-- Storage — path-bound policies on contact-docs (technician/<uid>/<purpose>)
-- ============================================================================
select ok(
  exists (select 1 from pg_policies
           where schemaname='storage' and tablename='objects'
             and policyname='technician doc uploads by applicant'),
  'storage INSERT policy for technician docs exists');
select ok(
  exists (select 1 from pg_policies
           where schemaname='storage' and tablename='objects'
             and policyname='technician doc reads by applicant'),
  'storage SELECT policy for technician docs exists');

select * from finish();
rollback;
