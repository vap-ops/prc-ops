begin;
select plan(16);

-- ============================================================================
-- Spec 348 U1 / ADR 0084 — procurement_manager gains SEE-ALL project visibility.
--
-- The operator's procurement manager trains + supports the site admins, so she
-- must SEE every SA surface on every project. U1 grants the read half by adding
-- `procurement_manager` to the SEE-ALL arm of can_see_project() (alongside
-- super_admin / project_coordinator / project_director — a full peer of
-- project_director for visibility) and to the six cross-project staff-read
-- SELECT policies that used the bare SITE_STAFF array and excluded her.
--
-- DIRECTIONAL: plain `procurement` gains NOTHING (only procurement_manager is
-- added). site_admin is unchanged. This file pins BOTH the grant and the
-- non-grant — a widen that also opened plain procurement would fail here.
--
-- WRITE CONSEQUENCE (operator-granted, 2026-07-23, "match PD"): because the
-- eight crew RPCs and submit_receipt_correction_request gate on
-- is_back_office/membership + can_see_project, and procurement_manager is
-- is_back_office, the see-all grant also lets her run those on any project —
-- exactly as project_director already can (spec 332 U3c had blocked procurement
-- here only because can_see_project returned false for it). create_crew is
-- pinned below as the representative of that intended consequence; the 279
-- create_crew denial assert for this same role is updated to lives_ok in the
-- same PR.
--
-- Assertions run under role=authenticated → grant the runner's _tap_buf
-- collector (+ sequence) to authenticated (pgtap-tapbuf-grant-role-switch).
-- ============================================================================
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ── actors ──────────────────────────────────────────────────────────────────
-- pmgr : procurement_manager  → gains see-all here
-- proc : procurement          → the directional control (stays blind)
-- sadm : site_admin, member of P only
-- worker id is needed for create_crew's lead arg (passed null, but the fn reads
-- the project).
insert into auth.users (id, email, raw_user_meta_data) values
  ('a0000000-0348-0348-0348-a00000000348', 'pmgr@s348.local', '{}'::jsonb),
  ('a1000000-0348-0348-0348-a10000000348', 'proc@s348.local', '{}'::jsonb),
  ('a2000000-0348-0348-0348-a20000000348', 'sadm@s348.local', '{}'::jsonb);
update public.users set role = 'procurement_manager' where id = 'a0000000-0348-0348-0348-a00000000348';
update public.users set role = 'procurement'         where id = 'a1000000-0348-0348-0348-a10000000348';
update public.users set role = 'site_admin'          where id = 'a2000000-0348-0348-0348-a20000000348';

-- P1 has NO members — proves see-all (not membership).
insert into public.projects (id, code, name) values
  ('c0000000-0348-0348-0348-c00000000348', 'TAP-348', 'โครงการทดสอบสิทธิ์ procurement manager');

-- Cross-project staff-read fixtures (bare SITE_STAFF array policies).
insert into public.clients (id, name, created_by) values
  ('c1000000-0348-0348-0348-c10000000348', 'ลูกค้า 348', 'a2000000-0348-0348-0348-a20000000348');
insert into public.service_providers (id, name, created_by) values
  ('c2000000-0348-0348-0348-c20000000348', 'ผู้ให้บริการ 348', 'a2000000-0348-0348-0348-a20000000348');

-- ============================================================================
-- A. can_see_project — the see-all grant + the directional control.
-- ============================================================================
set local role authenticated;

set local "request.jwt.claims" = '{"sub": "a0000000-0348-0348-0348-a00000000348"}';
select is(
  (select public.can_see_project('c0000000-0348-0348-0348-c00000000348')), true,
  'procurement_manager SEES a project it is NOT a member of (see-all grant)');

set local "request.jwt.claims" = '{"sub": "a1000000-0348-0348-0348-a10000000348"}';
select is(
  (select public.can_see_project('c0000000-0348-0348-0348-c00000000348')), false,
  'plain procurement still sees NO project (directional — only pmgr widened)');

set local "request.jwt.claims" = '{"sub": "a2000000-0348-0348-0348-a20000000348"}';
select is(
  (select public.can_see_project('c0000000-0348-0348-0348-c00000000348')), false,
  'site_admin non-member still sees nothing (membership arm unchanged)');

-- ============================================================================
-- B. Cross-project staff reads — the six widened SELECT policies.
--    Runtime-pin two bare-array tables (clients + service_providers) with real
--    RLS-filtered reads, pmgr-sees / procurement-doesn't; the other four
--    (contractor_consents, work_package_members + the two subcontract policies)
--    share the identical array edit and are pinned by qual in section C.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "a0000000-0348-0348-0348-a00000000348"}';
select is(
  (select count(*)::int from public.clients where id = 'c1000000-0348-0348-0348-c10000000348'), 1,
  'procurement_manager reads clients (widened staff-read policy)');
select is(
  (select count(*)::int from public.service_providers where id = 'c2000000-0348-0348-0348-c20000000348'), 1,
  'procurement_manager reads service_providers (widened staff-read policy)');

set local "request.jwt.claims" = '{"sub": "a1000000-0348-0348-0348-a10000000348"}';
select is(
  (select count(*)::int from public.clients where id = 'c1000000-0348-0348-0348-c10000000348'), 0,
  'plain procurement still cannot read clients (directional)');
select is(
  (select count(*)::int from public.service_providers where id = 'c2000000-0348-0348-0348-c20000000348'), 0,
  'plain procurement still cannot read service_providers (directional)');

-- ============================================================================
-- C. The six widened policies each now admit procurement_manager in their qual
--    (static pin — catches a missed table; the runtime reads above prove the
--    array edit actually grants).
-- ============================================================================
reset role;
select is(
  (select count(*)::int from pg_policies
     where cmd='SELECT' and schemaname='public'
       and tablename in ('clients','contractor_consents','service_providers',
                         'subcontract_crew_attachments','subcontract_crew_members','work_package_members')
       and qual ilike '%procurement_manager%'),
  6, 'all six staff-read SELECT policies now name procurement_manager');
select is(
  (select count(*)::int from pg_policies
     where cmd='SELECT' and schemaname='public'
       and tablename in ('clients','contractor_consents','service_providers',
                         'subcontract_crew_attachments','subcontract_crew_members','work_package_members')
       and qual ilike '%site_admin%' and qual not ilike '%procurement_manager%'),
  0, 'no staff-read SELECT policy still names site_admin without procurement_manager');

-- ============================================================================
-- D. can_see_project function body: procurement_manager is in the SEE-ALL arm,
--    NOT the membership arm (peer of project_director), and plain procurement is
--    in NEITHER.
-- ============================================================================
select ok(
  pg_get_functiondef('public.can_see_project'::regproc)
    ~ 'in\s*\(\s*''super_admin''\s*,\s*''project_coordinator''\s*,\s*''project_director''\s*,\s*''procurement_manager''',
  'can_see_project see-all arm names procurement_manager (as a project_director peer)');
select ok(
  (select count(*)::int from regexp_matches(
     pg_get_functiondef('public.can_see_project'::regproc), 'procurement_manager', 'g')) = 1,
  'procurement_manager appears exactly once in can_see_project (see-all only, not membership)');
select ok(
  pg_get_functiondef('public.can_see_project'::regproc) not ilike '%''procurement''%',
  'plain procurement is NOT named anywhere in can_see_project');

-- ============================================================================
-- E. Write consequence (operator-granted): create_crew — is_back_office +
--    can_see_project. procurement_manager now passes both on any project;
--    site_admin (not is_back_office) and plain procurement (blind) still cannot.
-- ============================================================================
set local role authenticated;

set local "request.jwt.claims" = '{"sub": "a0000000-0348-0348-0348-a00000000348"}';
select lives_ok(
  $$ select public.create_crew('c0000000-0348-0348-0348-c00000000348', 'ทีม 348',
       null, 'dc', null) $$,
  'procurement_manager may create_crew on a non-member project (granted see-all write)');

set local "request.jwt.claims" = '{"sub": "a1000000-0348-0348-0348-a10000000348"}';
select throws_ok(
  $$ select public.create_crew('c0000000-0348-0348-0348-c00000000348', 'ทีมต้องห้าม',
       null, 'dc', null) $$,
  '42501', 'not a member of this project',
  'plain procurement still cannot create_crew (blind — directional)');

set local "request.jwt.claims" = '{"sub": "a2000000-0348-0348-0348-a20000000348"}';
select throws_ok(
  $$ select public.create_crew('c0000000-0348-0348-0348-c00000000348', 'ทีมช่าง',
       null, 'dc', null) $$,
  '42501', 'not authorized to create a crew',
  'site_admin still cannot create_crew (not is_back_office — unchanged)');

-- ============================================================================
-- F. audit_log rework-events reader already admits procurement_manager
--    (verified live, no-op in U1) — pin it so a future narrowing is caught.
-- ============================================================================
reset role;
select ok(
  (select qual ilike '%procurement_manager%' from pg_policies
     where tablename='audit_log' and policyname='audit_log select wp rework events'),
  'audit_log rework-events reader already admits procurement_manager (no U1 change needed)');

select * from finish();
rollback;
