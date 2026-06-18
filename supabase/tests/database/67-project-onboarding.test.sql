begin;
select plan(15);

-- ============================================================================
-- Spec 142 U1 — project onboarding data layer.
--   create_project(p_code, p_name, p_project_type, p_client_id) returns uuid
--     SECURITY DEFINER, role-gated (project_manager / super_admin), auto-adds
--     the creator as a project_members row.
--   suggest_project_code() returns text — next PRC-YYYY-NNN for the current year.
--
-- Setup as postgres (outer role bypasses RLS): four auth.users; the
-- on_auth_user_created trigger creates matching public.users rows (role
-- 'visitor'); promote three to super_admin / site_admin / project_manager.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'super@onb-test.local',   '{}'::jsonb),
  ('22222222-2222-2222-2222-222222222222', 'site@onb-test.local',    '{}'::jsonb),
  ('33333333-3333-3333-3333-333333333333', 'pm@onb-test.local',      '{}'::jsonb),
  ('44444444-4444-4444-4444-444444444444', 'visitor@onb-test.local', '{}'::jsonb);

update public.users set role = 'super_admin'
  where id = '11111111-1111-1111-1111-111111111111';
update public.users set role = 'site_admin'
  where id = '22222222-2222-2222-2222-222222222222';
update public.users set role = 'project_manager'
  where id = '33333333-3333-3333-3333-333333333333';
-- '4444…' keeps the default 'visitor' role from the trigger.

-- Runner records TAP via _tap_buf under the authenticated role (file 06 pattern).
grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- A. Catalog (as postgres).
-- ============================================================================

select ok(
  to_regprocedure('public.create_project(text,text,public.project_type,uuid)') is not null,
  'create_project(text,text,project_type,uuid) exists'
);
select ok(
  to_regprocedure('public.suggest_project_code()') is not null,
  'suggest_project_code() exists'
);
select is(
  (select prosecdef from pg_proc
     where oid = 'public.create_project(text,text,public.project_type,uuid)'::regprocedure),
  true,
  'create_project is SECURITY DEFINER'
);
select is(
  (select prosecdef from pg_proc
     where oid = 'public.suggest_project_code()'::regprocedure),
  true,
  'suggest_project_code is SECURITY DEFINER'
);

-- ============================================================================
-- B. Behaviour under authenticated sessions.
-- ============================================================================

set local role authenticated;

-- B.1 project_manager can create; the returned id is non-null.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
select isnt(
  (select public.create_project('PRC-CP-T-001', 'สร้างโครงการทดสอบ', null, null)),
  null,
  'project_manager create_project returns a new id'
);

-- B.2 The creator is auto-added as a project member of that project.
select is(
  (select count(*)::int
     from public.project_members m
     join public.projects p on p.id = m.project_id
    where p.code = 'PRC-CP-T-001'
      and m.user_id = '33333333-3333-3333-3333-333333333333'),
  1,
  'create_project auto-adds the creator as a project member'
);

-- B.3 super_admin can create too.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';
select isnt(
  (select public.create_project('PRC-CP-T-002', 'โครงการของซุปเปอร์', null, null)),
  null,
  'super_admin create_project returns a new id'
);

-- B.4 site_admin create is denied (role gate → 42501).
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222222222"}';
select throws_ok(
  $$ select public.create_project('PRC-CP-T-SA-DENY', 'x', null, null) $$,
  '42501', null,
  'site_admin create_project is denied (42501)'
);

-- B.5 visitor create is denied.
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444444"}';
select throws_ok(
  $$ select public.create_project('PRC-CP-T-VIS-DENY', 'x', null, null) $$,
  '42501', null,
  'visitor create_project is denied (42501)'
);

-- B.6 Empty name is rejected (22023). Back to PM.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333333333"}';
select throws_ok(
  $$ select public.create_project('PRC-CP-T-EMPTY', '   ', null, null) $$,
  '22023', null,
  'create_project rejects an empty name (22023)'
);

-- B.7 Unknown client is rejected (22023).
select throws_ok(
  $$ select public.create_project('PRC-CP-T-CLI', 'valid name', null,
                                  '00000000-0000-0000-0000-0000000000ff'::uuid) $$,
  '22023', null,
  'create_project rejects an unknown client (22023)'
);

-- B.8 Duplicate code is rejected (unique violation → 23505). Reuses B.1's code.
select throws_ok(
  $$ select public.create_project('PRC-CP-T-001', 'duplicate code', null, null) $$,
  '23505', null,
  'create_project rejects a duplicate code (23505)'
);

-- ============================================================================
-- C. suggest_project_code.
-- ============================================================================

-- C.1 Format is PRC-YYYY-NNN for the current year (PM).
select matches(
  public.suggest_project_code(),
  '^PRC-' || to_char(current_date, 'YYYY') || '-[0-9]{3}$',
  'suggest_project_code returns PRC-YYYY-NNN for the current year'
);

-- C.2 Role-gated: visitor is denied (42501).
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444444"}';
select throws_ok(
  $$ select public.suggest_project_code() $$,
  '42501', null,
  'visitor suggest_project_code is denied (42501)'
);

-- C.3 Collision-proof property: the suggested number equals (current max for the
--     year) + 1. Computed against the same rows the function reads — super_admin
--     RLS shows every project, matching the definer's view.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111111111"}';
select is(
  (select substring(public.suggest_project_code() from '([0-9]+)$')::int),
  (select coalesce(
            max(substring(code from '^PRC-' || to_char(current_date, 'YYYY') || '-([0-9]+)$')::int),
            0)
     from public.projects
    where code ~ ('^PRC-' || to_char(current_date, 'YYYY') || '-[0-9]+$')) + 1,
  'suggest_project_code = current-year max + 1'
);

reset role;

select * from finish();
rollback;
