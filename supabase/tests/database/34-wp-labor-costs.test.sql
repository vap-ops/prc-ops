begin;
select plan(20);

-- ============================================================================
-- Spec 68 P2 — wp_labor_costs snapshot + freeze_wp_labor_cost RPC.
-- Pins: catalog/RLS, the zero-grant money posture (no authenticated
-- read/write of the snapshot), the freeze RPC (pm/super only; site_admin
-- AND visitor refused 42501; own/dc computed from CURRENT labor logs;
-- exactly one labor_cost_freeze audit row; WP-existence guard; idempotent
-- re-freeze UPSERT carrying the prior values, C6).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110068', 'pm@labcost.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220068', 'sa@labcost.local', '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330068', 'vi@labcost.local', '{}'::jsonb);
update public.users set role = 'project_manager' where id = '11111111-1111-1111-1111-111111110068';
update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-222222220068';
-- third user stays visitor

insert into public.projects (id, code, name) values
  ('cc000001-0000-4000-8000-000000000001', 'TAP-LABCOST', 'Labor cost fixture');
insert into public.work_packages (id, project_id, code, name, status) values
  ('ee000001-0000-4000-8000-000000000001',
   'cc000001-0000-4000-8000-000000000001', 'WP-LC-1', 'Open WP', 'in_progress');

insert into public.contractors (id, name, created_by) values
  ('dd000001-0000-4000-8000-000000000001', 'DC Crew',
   '11111111-1111-1111-1111-111111110068');

insert into public.workers (id, name, pay_type, employment_type, contractor_id, user_id,
                            day_rate, active, created_by) values
  ('aa000001-0000-4000-8000-000000000001', 'Own A', 'monthly', 'permanent', null, null,
   500.00, true, '11111111-1111-1111-1111-111111110068'),
  ('aa000003-0000-4000-8000-000000000003', 'DC C', 'daily', 'permanent',
   'dd000001-0000-4000-8000-000000000001', null, 380.00, true,
   '11111111-1111-1111-1111-111111110068');

-- Labor logs seeded directly (owner bypasses the zero-grant posture; the
-- app can only write through log_labor_day / correct_labor_log).
--   own A: 06-10 full (current 500), 06-12 full→half correction (current 250)
--   dc  C: 06-11 full (current 380)
-- Expected first freeze: own = 500 + 250 = 750.00, dc = 380.00.
insert into public.labor_logs (id, work_package_id, worker_id, work_date,
    day_fraction, day_rate_snapshot, worker_name_snapshot,
    pay_type_snapshot, entered_by) values
  ('fa000001-0000-4000-8000-000000000001',
   'ee000001-0000-4000-8000-000000000001', 'aa000001-0000-4000-8000-000000000001',
   date '2026-06-10', 'full', 500.00, 'Own A', 'monthly',
   '11111111-1111-1111-1111-111111110068'),
  ('fa000002-0000-4000-8000-000000000002',
   'ee000001-0000-4000-8000-000000000001', 'aa000003-0000-4000-8000-000000000003',
   date '2026-06-11', 'full', 380.00, 'DC C', 'daily',
   '11111111-1111-1111-1111-111111110068'),
  ('fa000003-0000-4000-8000-000000000003',
   'ee000001-0000-4000-8000-000000000001', 'aa000001-0000-4000-8000-000000000001',
   date '2026-06-12', 'full', 500.00, 'Own A', 'monthly',
   '11111111-1111-1111-1111-111111110068');
-- correction supersedes fa...03 (full -> half).
insert into public.labor_logs (id, work_package_id, worker_id, work_date,
    day_fraction, day_rate_snapshot, worker_name_snapshot,
    pay_type_snapshot, entered_by,
    superseded_by, correction_reason) values
  ('fa000004-0000-4000-8000-000000000004',
   'ee000001-0000-4000-8000-000000000001', 'aa000001-0000-4000-8000-000000000001',
   date '2026-06-12', 'half', 500.00, 'Own A', 'monthly',
   '11111111-1111-1111-1111-111111110068',
   'fa000003-0000-4000-8000-000000000003', 'แก้เป็นครึ่งวัน');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Catalog + posture.
-- ============================================================================
select has_table('public', 'wp_labor_costs', 'wp_labor_costs exists');
select col_is_pk('public', 'wp_labor_costs', 'work_package_id',
  'work_package_id is the PK (one snapshot per WP)');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.wp_labor_costs'::regclass),
  'RLS enabled on wp_labor_costs');
select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'wp_labor_costs'),
  0::bigint, 'wp_labor_costs has no policies (zero grant — RPC/admin only)');

-- ============================================================================
-- B. Money posture: authenticated cannot read or write the snapshot.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220068"}';

select throws_ok(
  $$ select own_cost from public.wp_labor_costs limit 1 $$,
  '42501', null, 'authenticated cannot read wp_labor_costs (zero grant)');
select throws_ok(
  $$ insert into public.wp_labor_costs (work_package_id, own_cost, dc_cost, frozen_by)
     values ('ee000001-0000-4000-8000-000000000001', 1, 1,
             '22222222-2222-2222-2222-222222220068') $$,
  '42501', null, 'authenticated cannot INSERT wp_labor_costs directly');

-- ============================================================================
-- C. freeze RPC role gate: site_admin refused (rate is money), visitor too.
-- ============================================================================
select throws_ok(
  $$ select public.freeze_wp_labor_cost('ee000001-0000-4000-8000-000000000001') $$,
  '42501', null, 'freeze_wp_labor_cost refuses site_admin');

set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330068"}';
select throws_ok(
  $$ select public.freeze_wp_labor_cost('ee000001-0000-4000-8000-000000000001') $$,
  '42501', null, 'freeze_wp_labor_cost refuses visitor');

-- ============================================================================
-- D. freeze happy path (project_manager).
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110068"}';
select lives_ok(
  $$ select public.freeze_wp_labor_cost('ee000001-0000-4000-8000-000000000001') $$,
  'project_manager freezes the WP labor cost');
select throws_ok(
  $$ select public.freeze_wp_labor_cost('ee000099-0000-4000-8000-000000000099') $$,
  'P0001', null, 'freeze refuses a non-existent work package');

reset role;
select is(
  (select own_cost from public.wp_labor_costs
    where work_package_id = 'ee000001-0000-4000-8000-000000000001'),
  750.00, 'own_cost = sum of current own (full 500 + corrected half 250)');
select is(
  (select dc_cost from public.wp_labor_costs
    where work_package_id = 'ee000001-0000-4000-8000-000000000001'),
  380.00, 'dc_cost = current dc (full 380)');
select is(
  (select frozen_by from public.wp_labor_costs
    where work_package_id = 'ee000001-0000-4000-8000-000000000001'),
  '11111111-1111-1111-1111-111111110068'::uuid, 'frozen_by = the PM actor');
select is(
  (select count(*) from public.audit_log
    where action = 'labor_cost_freeze'
      and target_id = 'ee000001-0000-4000-8000-000000000001'),
  1::bigint, 'exactly one labor_cost_freeze audit row');

-- ============================================================================
-- E. Re-freeze: supersede a current row, re-freeze. The snapshot UPSERTs
--    (still one row), recomputes, and the second freeze is audited with the
--    prior values (C6: corrections never recompute silently).
-- ============================================================================
-- Supersede fa...01 (06-10 full) with a half correction -> own now 250+250=500.
insert into public.labor_logs (id, work_package_id, worker_id, work_date,
    day_fraction, day_rate_snapshot, worker_name_snapshot,
    pay_type_snapshot, entered_by,
    superseded_by, correction_reason) values
  ('fa000005-0000-4000-8000-000000000005',
   'ee000001-0000-4000-8000-000000000001', 'aa000001-0000-4000-8000-000000000001',
   date '2026-06-10', 'half', 500.00, 'Own A', 'monthly',
   '11111111-1111-1111-1111-111111110068',
   'fa000001-0000-4000-8000-000000000001', 'แก้ย้อนหลัง');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110068"}';
select lives_ok(
  $$ select public.freeze_wp_labor_cost('ee000001-0000-4000-8000-000000000001') $$,
  'project_manager re-freezes after a post-close correction');

reset role;
select is(
  (select own_cost from public.wp_labor_costs
    where work_package_id = 'ee000001-0000-4000-8000-000000000001'),
  500.00, 're-freeze recomputes own_cost (half 250 + half 250)');
select is(
  (select count(*) from public.wp_labor_costs
    where work_package_id = 'ee000001-0000-4000-8000-000000000001'),
  1::bigint, 're-freeze UPSERTs — still exactly one snapshot row per WP');
select is(
  (select count(*) from public.audit_log
    where action = 'labor_cost_freeze'
      and target_id = 'ee000001-0000-4000-8000-000000000001'),
  2::bigint, 're-freeze is audited (two freeze rows now)');
-- created_at is constant within the txn, so identify the rows by payload,
-- not by ordering: the first freeze recorded no prior cost, the second 750.
select is(
  (select count(*) from public.audit_log
    where action = 'labor_cost_freeze'
      and target_id = 'ee000001-0000-4000-8000-000000000001'
      and payload->>'old_own_cost' is null),
  1::bigint, 'first freeze recorded a null prior own_cost');
select is(
  (select count(*) from public.audit_log
    where action = 'labor_cost_freeze'
      and target_id = 'ee000001-0000-4000-8000-000000000001'
      and (payload->>'old_own_cost')::numeric = 750.00),
  1::bigint, 're-freeze recorded the prior own_cost (750) in its payload');

select * from finish();
rollback;
