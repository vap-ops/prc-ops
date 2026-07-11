begin;
select plan(29);

-- ============================================================================
-- Spec 264 G1 (ADR 0072) — the self-serve write path + RLS of the RENAMED
-- staff substrate (ported from the spec-263 263-technician-registration test to
-- the staff_* names; `consent` doc-purpose dropped). Covers the parts NOT in
-- 264-staff-registration: PRC-YY-NNNN mint (format + per-year gapless increment),
-- one-live-per-user, cross-user isolation on update_own/add_doc, the supersede
-- chain (append-only), and the RLS reader matrix (applicant own-only, back-office
-- read-all, SA/site_owner pending read-only, plain procurement sees nothing).
--
-- The approve/reject/role-parametric/guard/floor coverage lives in the sibling
-- 264-staff-registration.test.sql.
-- ============================================================================

-- --- Actors -----------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('f1111111-1111-1111-1111-11111111f264', 'appA@t264b.local', '{}'::jsonb),   -- visitor applicant A
  ('f2222222-2222-2222-2222-22222222f264', 'appB@t264b.local', '{}'::jsonb),   -- visitor applicant B
  ('f3333333-3333-3333-3333-33333333f264', 'pmgr@t264b.local', '{}'::jsonb),   -- procurement_manager (back office)
  ('f4444444-4444-4444-4444-44444444f264', 'sa@t264b.local',   '{}'::jsonb),   -- site_admin (read-only)
  ('f5555555-5555-5555-5555-55555555f264', 'proc@t264b.local', '{}'::jsonb),   -- plain procurement (NOT a reader)
  ('f6666666-6666-6666-6666-66666666f264', 'own@t264b.local',  '{}'::jsonb);   -- site_owner (read-only)
update public.users set role='procurement_manager' where id='f3333333-3333-3333-3333-33333333f264';
update public.users set role='site_admin'          where id='f4444444-4444-4444-4444-44444444f264';
update public.users set role='procurement'         where id='f5555555-5555-5555-5555-55555555f264';
update public.users set role='site_owner'          where id='f6666666-6666-6666-6666-66666666f264';

create temporary table _fix (k text primary key, v text) on commit drop;
grant select on _fix to authenticated;
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- Capture the current per-year counter BEFORE these mints so the assertions are
-- relative (the live PRC-26-0001 row already consumed seq 1 for year 26).
insert into _fix values ('startNext',
  coalesce((select next_val from public.employee_id_counters
              where year = (to_char((now() at time zone 'Asia/Bangkok'), 'YY'))::int)::text, '1'));

-- ============================================================================
-- START — visitor gate + mint format + one-live-per-user.
-- ============================================================================
-- Non-visitor cannot start.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "f3333333-3333-3333-3333-33333333f264"}';
select throws_ok(
  $$ select public.start_staff_registration('มานะ', '0810000000') $$,
  '42501', null, 'non-visitor (procurement_manager) cannot start');
reset role;

-- unbound caller fails closed.
set local role authenticated;
set local "request.jwt.claims" = '{}';
select throws_ok(
  $$ select public.start_staff_registration('x', '0800000000') $$,
  '42501', null, 'unbound caller cannot start (fail closed)');
reset role;

-- Applicant A starts.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "f1111111-1111-1111-1111-11111111f264"}';
select lives_ok(
  $$ select public.start_staff_registration('สมชาย ช่างดี', '0811111111') $$,
  'visitor A starts staff registration');
reset role;
insert into _fix values ('empA',
  (select employee_id from public.staff_registrations where user_id='f1111111-1111-1111-1111-11111111f264'));
insert into _fix values ('regA',
  (select id::text from public.staff_registrations where user_id='f1111111-1111-1111-1111-11111111f264'));

-- Employee id matches PRC-YY-NNNN with the current Bangkok year + the expected seq.
select is(
  (select v from _fix where k='empA'),
  'PRC-' || to_char((now() at time zone 'Asia/Bangkok'), 'YY') || '-'
    || lpad((select v::int from _fix where k='startNext')::text, 4, '0'),
  'A minted PRC-YY-NNNN at the expected next sequence (Bangkok year)');
select is((select status::text from public.staff_registrations where user_id='f1111111-1111-1111-1111-11111111f264'),
  'pending', 'A row is pending');
select is((select full_name from public.staff_registrations where user_id='f1111111-1111-1111-1111-11111111f264'),
  'สมชาย ช่างดี', 'A full_name captured at start');

-- One-live-per-user: A cannot start again.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "f1111111-1111-1111-1111-11111111f264"}';
select throws_ok(
  $$ select public.start_staff_registration('สมชาย', '0811111111') $$,
  null, null, 'A cannot start a second registration (one-live-per-user)');
reset role;

-- Applicant B starts → next per-year number (gapless increment).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "f2222222-2222-2222-2222-22222222f264"}';
select lives_ok(
  $$ select public.start_staff_registration('Aung', '0822222222') $$,
  'visitor B starts staff registration');
reset role;
select is(
  (select employee_id from public.staff_registrations where user_id='f2222222-2222-2222-2222-22222222f264'),
  'PRC-' || to_char((now() at time zone 'Asia/Bangkok'), 'YY') || '-'
    || lpad(((select v::int from _fix where k='startNext') + 1)::text, 4, '0'),
  'B minted the next per-year number (gapless increment)');

-- ============================================================================
-- update_own — own row, pending-only, self fields, cross-user isolation.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "f1111111-1111-1111-1111-11111111f264"}';
select lives_ok(
  $$ select public.update_own_staff_registration(
       p_full_name := 'สมชาย ช่างเอก',
       p_date_of_birth := date '1990-05-01',
       p_emergency_contact_name := 'สมหญิง') $$,
  'A updates own registration self-fields');
reset role;
select is((select date_of_birth from public.staff_registrations where user_id='f1111111-1111-1111-1111-11111111f264'),
  date '1990-05-01', 'A dob updated');
select is((select employee_id from public.staff_registrations where user_id='f1111111-1111-1111-1111-11111111f264'),
  (select v from _fix where k='empA'), 'A employee_id unchanged by update_own');

-- Cross-user: B's self-update does not touch A's row.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "f2222222-2222-2222-2222-22222222f264"}';
select lives_ok(
  $$ select public.update_own_staff_registration(p_full_name := 'Aung Min') $$,
  'B updates own row');
reset role;
select is((select full_name from public.staff_registrations where user_id='f1111111-1111-1111-1111-11111111f264'),
  'สมชาย ช่างเอก', 'A full_name NOT affected by B update (cross-user isolation)');

-- update_own with no row for the caller rejected.
insert into auth.users (id, email, raw_user_meta_data) values
  ('f7777777-7777-7777-7777-77777777f264', 'noreg@t264b.local', '{}'::jsonb);
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "f7777777-7777-7777-7777-77777777f264"}';
select throws_ok(
  $$ select public.update_own_staff_registration(p_full_name := 'x') $$,
  null, null, 'update_own with no registration row is rejected');
reset role;

-- ============================================================================
-- add_doc — supersede (append-only) + cross-user isolation.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "f1111111-1111-1111-1111-11111111f264"}';
select lives_ok(
  $$ select public.add_staff_registration_doc('id_card', 'technician/f1111111-1111-1111-1111-11111111f264/id_card/v1.jpg') $$,
  'A adds an id_card doc');
reset role;
insert into _fix values ('docA1',
  (select id::text from public.staff_registration_attachments
     where registration_id=(select v::uuid from _fix where k='regA') and purpose='id_card'));

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "f1111111-1111-1111-1111-11111111f264"}';
select lives_ok(
  $$ select public.add_staff_registration_doc('id_card', 'technician/f1111111-1111-1111-1111-11111111f264/id_card/v2.jpg') $$,
  'A re-uploads id_card (supersede)');
reset role;

-- Exactly ONE live head id_card row via the anti-join.
select is(
  (select count(*)::int from public.staff_registration_attachments a
    where a.registration_id=(select v::uuid from _fix where k='regA')
      and a.purpose='id_card'
      and not exists (select 1 from public.staff_registration_attachments n
                       where n.superseded_by = a.id)),
  1, 'exactly one live id_card head row after supersede (anti-join)');
-- New head points at the old row.
select is(
  (select count(*)::int from public.staff_registration_attachments
    where superseded_by = (select v::uuid from _fix where k='docA1')),
  1, 'the re-upload row supersedes the original id_card row');
-- Both physical rows persist (append-only).
select is(
  (select count(*)::int from public.staff_registration_attachments a
    where a.registration_id=(select v::uuid from _fix where k='regA') and a.purpose='id_card'),
  2, 'both id_card rows persist (append-only)');

-- Cross-user: B adds own doc, A's set is unchanged.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "f2222222-2222-2222-2222-22222222f264"}';
select lives_ok(
  $$ select public.add_staff_registration_doc('profile_photo', 'technician/f2222222-2222-2222-2222-22222222f264/profile_photo/v1.jpg') $$,
  'B adds own profile_photo doc');
reset role;
select is(
  (select count(*)::int from public.staff_registration_attachments a
     join public.staff_registrations r on r.id=a.registration_id
    where r.user_id='f1111111-1111-1111-1111-11111111f264'),
  2, 'A attachment set NOT grown by B (cross-user isolation)');

-- ============================================================================
-- RLS reader matrix.
-- ============================================================================
-- Applicant A reads ONLY own registration.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "f1111111-1111-1111-1111-11111111f264"}';
select is((select count(*)::int from public.staff_registrations where user_id='f2222222-2222-2222-2222-22222222f264'), 0,
  'applicant A cannot read B registration (cross-user read denied)');
reset role;

-- Spec 295: the SA/site_owner pending-read seam is now PROJECT-SCOPED (an SA sees
-- only pending applicants referred — invited_project_id — to a project they can
-- see). Refer both applicants to a project the read-only SA + site_owner are
-- members of, so the read-only-seam assertions below still hold under the scoped
-- rule. (295's own test owns the cross-project / unreferred negative cases.)
insert into public.projects (id, code, name) values
  ('f9000000-0000-0000-0000-00000000f264', 'TAP-264B', 'Spec 264b fixture project');
insert into public.project_members (project_id, user_id, added_by) values
  ('f9000000-0000-0000-0000-00000000f264', 'f4444444-4444-4444-4444-44444444f264', 'f3333333-3333-3333-3333-33333333f264'),
  ('f9000000-0000-0000-0000-00000000f264', 'f6666666-6666-6666-6666-66666666f264', 'f3333333-3333-3333-3333-33333333f264');
update public.staff_registrations set invited_project_id='f9000000-0000-0000-0000-00000000f264'
  where user_id in ('f1111111-1111-1111-1111-11111111f264','f2222222-2222-2222-2222-22222222f264');

-- Back-office (procurement_manager) reads ALL of these applicants' registrations.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "f3333333-3333-3333-3333-33333333f264"}';
select ok(
  (select count(*)::int from public.staff_registrations
    where user_id in ('f1111111-1111-1111-1111-11111111f264','f2222222-2222-2222-2222-22222222f264')) = 2,
  'procurement_manager reads both applicant registrations (back-office read-all)');
reset role;

-- SA gets a read-only view of the pending queue (both are pending).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "f4444444-4444-4444-4444-44444444f264"}';
select ok(
  (select count(*)::int from public.staff_registrations
    where user_id in ('f1111111-1111-1111-1111-11111111f264','f2222222-2222-2222-2222-22222222f264')) = 2,
  'site_admin reads the pending applicant queue (read-only seam)');
reset role;

-- site_owner likewise read-only.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "f6666666-6666-6666-6666-66666666f264"}';
select ok(
  (select count(*)::int from public.staff_registrations
    where user_id in ('f1111111-1111-1111-1111-11111111f264','f2222222-2222-2222-2222-22222222f264')) = 2,
  'site_owner reads the pending applicant queue (read-only seam)');
reset role;

-- plain procurement is NOT a reader and not the owner → sees none of these.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "f5555555-5555-5555-5555-55555555f264"}';
select is(
  (select count(*)::int from public.staff_registrations
    where user_id in ('f1111111-1111-1111-1111-11111111f264','f2222222-2222-2222-2222-22222222f264')),
  0, 'plain procurement reads zero of these registrations (not in reader set)');
reset role;

-- Storage policies (renamed) exist.
select ok(
  exists (select 1 from pg_policies
           where schemaname='storage' and tablename='objects'
             and policyname='staff doc uploads by applicant'),
  'renamed storage INSERT policy for staff docs exists');
select ok(
  exists (select 1 from pg_policies
           where schemaname='storage' and tablename='objects'
             and policyname='staff doc reads by applicant'),
  'renamed storage SELECT policy for staff docs exists');

select * from finish();
rollback;
