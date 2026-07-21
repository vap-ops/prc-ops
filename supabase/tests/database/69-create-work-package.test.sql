begin;
select plan(12);

-- ============================================================================
-- Spec 142 U4 — create_work_package(p_project_id, p_code, p_name, p_description)
--   returns uuid. SECURITY DEFINER, PM/super only (the sanctioned in-app WP
--   create path; the work_packages INSERT policy stays PM/super, but a definer
--   RPC sidesteps the table-grant question and matches create_project, U1).
--   code is unique WITHIN a project (composite unique) → duplicate raises 23505.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'super@cwp-test.local',   '{}'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'site@cwp-test.local',    '{}'::jsonb),
  ('33333333-3333-3333-3333-333333333333', 'pm@cwp-test.local',      '{}'::jsonb),
  ('44444444-4444-4444-4444-444444444444', 'visitor@cwp-test.local', '{}'::jsonb);

update public.users set role = 'super_admin'     where id = '11111111-1111-1111-1111-111111111111';
update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-222222222222';
update public.users set role = 'project_manager' where id = '33333333-3333-3333-3333-333333333333';
-- '4444…' stays 'visitor'.

insert into public.projects (id, code, name) values
  ('abababab-abab-abab-abab-abababababab', 'PRC-CWP-T', 'โครงการทดสอบงาน');

-- Spec 143 / ADR 0056: visibility is now membership-scoped — enrol this
-- fixture's PM/site_admin users so they can read the project.
insert into public.project_members (project_id, user_id, added_by)
  select p.id, u.id, u.id from public.projects p, public.users u
   where p.code in ('PRC-CWP-T')
     and u.id in (select au.id from auth.users au where au.email like '%@cwp-test.local')
     and u.role in ('project_manager', 'site_admin')
on conflict (project_id, user_id) do nothing;

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Catalog. Spec 270 U4: the canonical signature gained a trailing
-- p_parent_id (default null) — 4-arg positional calls below keep working.
select ok(
  to_regprocedure('public.create_work_package(uuid,text,text,text,uuid,uuid)') is not null,
  'create_work_package(uuid,text,text,text,uuid,uuid) exists');
select is(
  (select prosecdef from pg_proc
     where oid = 'public.create_work_package(uuid,text,text,text,uuid,uuid)'::regprocedure),
  true, 'create_work_package is SECURITY DEFINER');

-- B. Behaviour.
set local role authenticated;

-- B.1 PM creates a WP → non-null id.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
select isnt(
  (select public.create_work_package('abababab-abab-abab-abab-abababababab', 'WP-A', 'งานเอ', null)),
  null, 'project_manager create_work_package returns a new id');

-- B.2 The WP exists under the project.
select is(
  (select count(*)::int from public.work_packages
     where project_id = 'abababab-abab-abab-abab-abababababab' and code = 'WP-A'),
  1, 'create_work_package inserted the row under the project');

-- B.3 super_admin can create too.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';
select isnt(
  (select public.create_work_package('abababab-abab-abab-abab-abababababab', 'WP-B', 'งานบี', 'รายละเอียด')),
  null, 'super_admin create_work_package returns a new id');

-- B.4 site_admin denied (42501).
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222222"}';
select throws_ok(
  $$ select public.create_work_package('abababab-abab-abab-abab-abababababab', 'WP-X', 'x', null) $$,
  '42501', null, 'site_admin create_work_package is denied (42501)');

-- B.5 visitor denied (42501).
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444444"}';
select throws_ok(
  $$ select public.create_work_package('abababab-abab-abab-abab-abababababab', 'WP-Y', 'y', null) $$,
  '42501', null, 'visitor create_work_package is denied (42501)');

-- B.6 Empty name rejected (22023). Back to PM.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
select throws_ok(
  $$ select public.create_work_package('abababab-abab-abab-abab-abababababab', 'WP-Z', '   ', null) $$,
  '22023', null, 'create_work_package rejects an empty name (22023)');

-- B.7 Empty code rejected (22023).
select throws_ok(
  $$ select public.create_work_package('abababab-abab-abab-abab-abababababab', '  ', 'valid', null) $$,
  '22023', null, 'create_work_package rejects an empty code (22023)');

-- B.8 Unknown project rejected (22023).
select throws_ok(
  $$ select public.create_work_package('00000000-0000-0000-0000-0000000000ff', 'WP-Q', 'valid', null) $$,
  '22023', null, 'create_work_package rejects an unknown project (22023)');

-- B.9 Duplicate (project, code) rejected (23505). Reuses B.1's WP-A.
select throws_ok(
  $$ select public.create_work_package('abababab-abab-abab-abab-abababababab', 'WP-A', 'ซ้ำ', null) $$,
  '23505', null, 'create_work_package rejects a duplicate code within the project (23505)');

-- B.10 Same code under a DIFFERENT project is allowed (composite uniqueness).
select isnt(
  (select public.create_work_package(
     (select id from public.projects where code = 'PRC-CWP-T'), 'WP-A2', 'งานเอสอง', null)),
  null, 'create_work_package allows a fresh code in the same project');

reset role;

select * from finish();
rollback;
