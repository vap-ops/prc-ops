begin;
select plan(10);

-- ============================================================================
-- Spec 295 — SA pending-applicant queue scoped to the SA's project.
--
-- can_see_staff_registration's SA/site_owner arm was `status='pending'` ONLY —
-- so EVERY site_admin saw the entire firm-wide pending applicant queue,
-- including applicants for projects they are not a member of (feedback
-- b0ff6cea). The project edge already exists: staff_registrations.invited_project_id
-- is stamped from the SA's per-project self-onboard QR (spec 279 F2a/F2b).
--
-- Fix = the SA/site_owner arm gains `invited_project_id IS NOT NULL AND
-- can_see_project(invited_project_id)`. An SA now sees only pending applicants
-- who registered via a QR for a project they can see; unreferred (NULL) pending
-- rows are visible to BACK-OFFICE ONLY (least-privilege — option A). The
-- back-office arm (procurement_manager/project_director/super_admin) is UNCHANGED
-- and still sees every registration.
--
-- Proves the full scope matrix below. RED before the fix on the cross-project +
-- NULL-referred cases (the SA currently sees those pending rows).
-- Mirrors 289 (membership-scope role switching) + 282 (invited_project_id seed).
-- ============================================================================

-- --- Actors ----------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('5a000000-0000-0000-0000-000000000295', 'sax@s295.local',    '{}'::jsonb),  -- site_admin, member of X
  ('5a000000-1111-0000-0000-000000000295', 'say@s295.local',    '{}'::jsonb),  -- site_admin, member of Y (not X)
  ('50000000-0000-0000-0000-000000000295', 'ownerx@s295.local', '{}'::jsonb),  -- site_owner, member of X
  ('b0000000-0000-0000-0000-000000000295', 'pm@s295.local',     '{}'::jsonb),  -- procurement_manager (back-office)
  -- applicants (each needs its own auth.users row: user_id is UNIQUE + FK)
  ('a1000000-0000-0000-0000-000000000295', 'appx@s295.local',   '{}'::jsonb),
  ('a2000000-0000-0000-0000-000000000295', 'appy@s295.local',   '{}'::jsonb),
  ('a3000000-0000-0000-0000-000000000295', 'appn@s295.local',   '{}'::jsonb),
  ('a4000000-0000-0000-0000-000000000295', 'appxa@s295.local',  '{}'::jsonb);
update public.users set role='site_admin'         where id='5a000000-0000-0000-0000-000000000295';
update public.users set role='site_admin'         where id='5a000000-1111-0000-0000-000000000295';
update public.users set role='site_owner'         where id='50000000-0000-0000-0000-000000000295';
update public.users set role='procurement_manager' where id='b0000000-0000-0000-0000-000000000295';

insert into public.projects (id, code, name) values
  ('cc000000-0000-0000-0000-000000000295', 'S295-X', 'โครงการ X'),
  ('cc000000-1111-0000-0000-000000000295', 'S295-Y', 'โครงการ Y');

-- Memberships: sax + ownerx in X; say in Y. (Nobody is the project lead.)
insert into public.project_members (project_id, user_id, added_by) values
  ('cc000000-0000-0000-0000-000000000295', '5a000000-0000-0000-0000-000000000295', '50000000-0000-0000-0000-000000000295'),
  ('cc000000-0000-0000-0000-000000000295', '50000000-0000-0000-0000-000000000295', '50000000-0000-0000-0000-000000000295'),
  ('cc000000-1111-0000-0000-000000000295', '5a000000-1111-0000-0000-000000000295', '50000000-0000-0000-0000-000000000295');

-- Registrations: pending→X, pending→Y, pending→NULL, approved→X.
insert into public.staff_registrations (id, user_id, employee_id, status, invited_project_id) values
  ('e1000000-0000-0000-0000-000000000295', 'a1000000-0000-0000-0000-000000000295', 'PRC-95-0001', 'pending',  'cc000000-0000-0000-0000-000000000295'),
  ('e2000000-0000-0000-0000-000000000295', 'a2000000-0000-0000-0000-000000000295', 'PRC-95-0002', 'pending',  'cc000000-1111-0000-0000-000000000295'),
  ('e3000000-0000-0000-0000-000000000295', 'a3000000-0000-0000-0000-000000000295', 'PRC-95-0003', 'pending',  null),
  ('e4000000-0000-0000-0000-000000000295', 'a4000000-0000-0000-0000-000000000295', 'PRC-95-0004', 'approved', 'cc000000-0000-0000-0000-000000000295');

-- Assertions run while role=authenticated → grant the runner's _tap_buf collector
-- (+ sequence) to authenticated, else the first wrapped insert 42501-aborts the
-- file (pgtap-tapbuf-grant-role-switch).
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- Structure — the helper is not anon-executable (RLS-internal).
-- ============================================================================
select is(has_function_privilege('anon', 'public.can_see_staff_registration(uuid)', 'EXECUTE'),
  false, 'anon cannot execute can_see_staff_registration');

set local role authenticated;

-- ============================================================================
-- SA scope (the fix). sax is a member of X only.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "5a000000-0000-0000-0000-000000000295"}';
select is(public.can_see_staff_registration('e1000000-0000-0000-0000-000000000295'), true,
  'site_admin sees a pending applicant referred to their project (X)');
select is(public.can_see_staff_registration('e2000000-0000-0000-0000-000000000295'), false,
  'site_admin does NOT see a pending applicant referred to a project they are not in (Y)');
select is(public.can_see_staff_registration('e3000000-0000-0000-0000-000000000295'), false,
  'site_admin does NOT see an UNREFERRED (NULL) pending applicant');
select is(public.can_see_staff_registration('e4000000-0000-0000-0000-000000000295'), false,
  'site_admin does NOT see a non-pending (approved) applicant, even referred to X');

-- say is a member of Y only — the mirror.
set local "request.jwt.claims" = '{"sub": "5a000000-1111-0000-0000-000000000295"}';
select is(public.can_see_staff_registration('e2000000-0000-0000-0000-000000000295'), true,
  'the Y site_admin sees the Y-referred pending applicant');
select is(public.can_see_staff_registration('e1000000-0000-0000-0000-000000000295'), false,
  'the Y site_admin does NOT see the X-referred applicant');

-- site_owner rides the same arm; ownerx is a member of X.
set local "request.jwt.claims" = '{"sub": "50000000-0000-0000-0000-000000000295"}';
select is(public.can_see_staff_registration('e1000000-0000-0000-0000-000000000295'), true,
  'site_owner (member of X) sees the X-referred pending applicant');

-- ============================================================================
-- Back-office arm UNCHANGED — procurement_manager sees every registration,
-- including the unreferred (NULL) and the non-pending ones.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "b0000000-0000-0000-0000-000000000295"}';
select is(public.can_see_staff_registration('e3000000-0000-0000-0000-000000000295'), true,
  'back-office (procurement_manager) still sees the UNREFERRED pending applicant');
select is(public.can_see_staff_registration('e4000000-0000-0000-0000-000000000295'), true,
  'back-office still sees a non-pending (approved) registration');

reset role;

select * from finish();
rollback;
