begin;
select plan(13);

-- ============================================================================
-- Spec 348 U3 / ADR 0084 — procurement_manager gains SA WRITE parity.
--
-- Every WRITE gate that admits site_admin now also admits procurement_manager
-- (25 write RPCs + 3 role helpers + 5 non-SELECT policies), generated from the
-- live defs byte-for-byte except 'procurement_manager' added to the site_admin
-- role array. This file pins the EFFECT for a representative of each gate shape,
-- BOTH the skips (site_admin excluded → she stays excluded) and the directional
-- control (plain procurement stays refused). The byte-for-byte correctness of
-- all 28 functions is proven separately by the migration byte-diff.
--
-- Fixture-light: most asserts use the "fake uuid passes role + see-all, then
-- fails on existence" trick — a procurement_manager who now clears the role gate
-- reaches the P0001/22023 existence error, where before she got 42501.
--
-- Assertions run under role=authenticated → grant the _tap_buf collector
-- (pgtap-tapbuf-grant-role-switch).
-- ============================================================================
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ── actors ──────────────────────────────────────────────────────────────────
insert into auth.users (id, email, raw_user_meta_data) values
  ('b0000000-0348-0348-0348-b00000000348', 'pmgr@s348b.local', '{}'::jsonb),
  ('b1000000-0348-0348-0348-b10000000348', 'proc@s348b.local', '{}'::jsonb),
  ('b2000000-0348-0348-0348-b20000000348', 'sadm@s348b.local', '{}'::jsonb);
update public.users set role = 'procurement_manager' where id = 'b0000000-0348-0348-0348-b00000000348';
update public.users set role = 'procurement'         where id = 'b1000000-0348-0348-0348-b10000000348';
update public.users set role = 'site_admin'          where id = 'b2000000-0348-0348-0348-b20000000348';

-- P has NO members — proves the writes ride on see-all, not membership.
insert into public.projects (id, code, name) values
  ('c0000000-0348-0348-0348-c00000000348', 'TAP-348B', 'โครงการทดสอบสิทธิ์เขียน');
insert into public.workers (id, name, pay_type, employment_type, day_rate, active, project_id, created_by) values
  ('d0000000-0348-0348-0348-d00000000348', 'ช่างนำ 348b', 'daily', 'permanent', 500, true,
   'c0000000-0348-0348-0348-c00000000348', 'b2000000-0348-0348-0348-b20000000348');
-- a COMPLETE WP — reopen needs a complete WP; also the reopen client/internal pair.
insert into public.work_packages (id, project_id, code, name, status) values
  ('e0000000-0348-0348-0348-e00000000348', 'c0000000-0348-0348-0348-c00000000348',
   'WP-348B', 'ชุดงานทดสอบ', 'complete');

-- ============================================================================
-- A. is_site_staff — deferred from U1, widened here (it gates only write RPCs).
-- ============================================================================
select is(public.is_site_staff('procurement_manager'::public.user_role), true,
  'is_site_staff now admits procurement_manager (SA write parity)');
select is(public.is_site_staff('procurement'::public.user_role), false,
  'is_site_staff still refuses plain procurement (directional)');
select is(public.is_site_staff('site_admin'::public.user_role), true,
  'is_site_staff still admits site_admin (unchanged)');

-- ============================================================================
-- B. report_site_issue — a SITE_STAFF-4tuple write RPC. pmgr now clears the
--    role gate (reaches the P0001 project-existence error); proc still 42501.
-- ============================================================================
set local role authenticated;

set local "request.jwt.claims" = '{"sub": "b0000000-0348-0348-0348-b00000000348"}';
select throws_ok(
  $$ select public.report_site_issue('00000000-0000-0000-0000-0000000f0348', null, 'safety', 'x') $$,
  'P0001', 'report_site_issue: project not found',
  'procurement_manager clears report_site_issue role gate (fails later on existence, not 42501)');

set local "request.jwt.claims" = '{"sub": "b1000000-0348-0348-0348-b10000000348"}';
select throws_ok(
  $$ select public.report_site_issue('00000000-0000-0000-0000-0000000f0348', null, 'safety', 'x') $$,
  '42501', 'report_site_issue: role not permitted',
  'plain procurement is still refused report_site_issue at the role gate (directional)');

-- ============================================================================
-- C. open_muster_team — the ('site_admin','super_admin') muster gate shape.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "b0000000-0348-0348-0348-b00000000348"}';
select lives_ok(
  $$ select public.open_muster_team('c0000000-0348-0348-0348-c00000000348', current_date,
       'd0000000-0348-0348-0348-d00000000348') $$,
  'procurement_manager may open a muster team (muster write parity, see-all project)');

set local "request.jwt.claims" = '{"sub": "b1000000-0348-0348-0348-b10000000348"}';
select throws_ok(
  $$ select public.open_muster_team('c0000000-0348-0348-0348-c00000000348', current_date,
       'd0000000-0348-0348-0348-d00000000348') $$,
  '42501', null,
  'plain procurement still cannot open a muster team (directional)');

-- ============================================================================
-- D. reopen_work_package_for_defect — the SPECIAL 2-arm case. pmgr mirrors
--    site_admin EXACTLY: files an INTERNAL defect, but is REFUSED for a CLIENT
--    defect (a PM-tier act, spec 337 U5b). Client-source FIRST (WP still
--    complete), then internal on the same WP.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "b0000000-0348-0348-0348-b00000000348"}';
select throws_ok(
  $$ select public.reopen_work_package_for_defect('e0000000-0348-0348-0348-e00000000348',
       'ลูกค้าแจ้ง', 'client') $$,
  '42501', 'reopen_work_package_for_defect: only PM tier may file a client defect',
  'procurement_manager is REFUSED a client-source defect (mirrors site_admin, below PM tier)');
select lives_ok(
  $$ select public.reopen_work_package_for_defect('e0000000-0348-0348-0348-e00000000348',
       'พบข้อบกพร่อง', 'internal') $$,
  'procurement_manager MAY file an internal-source defect (admit arm widened)');

set local "request.jwt.claims" = '{"sub": "b1000000-0348-0348-0348-b10000000348"}';
select throws_ok(
  $$ select public.reopen_work_package_for_defect('e0000000-0348-0348-0348-e00000000348',
       'x', 'internal') $$,
  '42501', 'reopen_work_package_for_defect: role not permitted',
  'plain procurement is still refused defect-reopen at the role gate (directional)');

-- ============================================================================
-- E. SKIP proof — decide_work_package gates on the PM tier (site_admin only in
--    a comment). procurement_manager must NOT be admitted (no over-widen).
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "b0000000-0348-0348-0348-b00000000348"}';
select throws_ok(
  $$ select public.decide_work_package('00000000-0000-0000-0000-0000000f0348', 'approved', 'x') $$,
  '42501', 'decide_work_package: role not permitted',
  'procurement_manager still CANNOT decide a work package (deliberate skip — not an SA power)');

-- ============================================================================
-- F. Policies — the 5 non-SELECT policies each now name procurement_manager.
-- ============================================================================
reset role;
select is(
  (select count(*)::int from pg_policies
     where cmd='INSERT'
       and policyname in ('photo_logs insert by sa/pm/super',
                          'photo_markups insert content or own tombstone',
                          'photos uploads by sa/pm/super',
                          'po attachment uploads by back office',
                          'sa bank-capture uploads by site_admin')
       and coalesce(qual,with_check) ilike '%procurement_manager%'),
  5, 'all five non-SELECT policies now admit procurement_manager');
select ok(
  not exists (select 1 from pg_policies
     where cmd<>'SELECT'
       and coalesce(qual,'')||coalesce(with_check,'') ilike '%site_admin%'
       and coalesce(qual,'')||coalesce(with_check,'') not ilike '%procurement_manager%'),
  'no non-SELECT policy still names site_admin without procurement_manager');

select * from finish();
rollback;
