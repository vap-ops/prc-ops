begin;
select plan(20);

-- ============================================================================
-- Spec 161 U4b / ADR 0060 §3 (model-b) — settle_project(p_project): the project
--   settlement engine. At close, coin_pool = Σ banked WP profit × coin_multiplier
--   (the U4a dial). BANK-AT-SETTLEMENT with a frozen snapshot: settle_project (a
--   super/director action) calls the gated wp_profit in its designed caller context
--   and FREEZES each completed WP's profit into wp_profit_bank, so later corrections
--   cannot move settled coins (U5 reads the frozen bank). Only 'complete' WPs bank;
--   a budget-NULL WP is SKIPPED + COUNTED (never silently 0). Idempotent (one row per
--   project), closed-only, super+director gate (no PM ref → 90/91 untouched).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110104', 'super@stl.local', '{}'::jsonb),
  ('55555555-5555-5555-5555-555555550104', 'dir@stl.local',   '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330104', 'pm@stl.local',    '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220104', 'sa@stl.local',    '{}'::jsonb),
  ('88888888-8888-8888-8888-888888880104', 'vis@stl.local',   '{}'::jsonb);
update public.users set role='super_admin'      where id='11111111-1111-1111-1111-111111110104';
update public.users set role='project_director' where id='55555555-5555-5555-5555-555555550104';
update public.users set role='project_manager'  where id='33333333-3333-3333-3333-333333330104';
update public.users set role='site_admin'       where id='22222222-2222-2222-2222-222222220104';
-- '8888…' stays visitor.

-- P1 = the main settlement case. P2 = a project for the director gate. P3 = the
-- not-closed rejection. Seeded ACTIVE so WPs can be added (the spec-145 trigger
-- blocks WP inserts on a closed project); P1/P2 are CLOSED below, after WP seeding.
insert into public.projects (id, code, name, status) values
  ('a1110104-0104-0104-0104-a1a1a1a10104', 'PRC-104-P1', 'โครงการปิดงาน', 'active'),
  ('a2220104-0104-0104-0104-a2a2a2a20104', 'PRC-104-P2', 'โครงการสอง',     'active'),
  ('a3330104-0104-0104-0104-a3a3a3a30104', 'PRC-104-P3', 'โครงการเปิดอยู่', 'active');

-- P1 WPs: WP-1 (budget 5000 + senior full day → labor_sell 800 → profit 4200);
-- WP-2 (budget 4000, no labor → profit 4000); WP-3 (complete, NO budget → SKIPPED);
-- WP-4 (in_progress → ignored, never banks though its budget is high).
insert into public.work_packages (id, project_id, code, name, status) values
  ('c1110104-0104-0104-0104-c1c1c1c10104', 'a1110104-0104-0104-0104-a1a1a1a10104',
   'WP-1', 'งานเต็ม',   'complete'),
  ('c2220104-0104-0104-0104-c2c2c2c20104', 'a1110104-0104-0104-0104-a1a1a1a10104',
   'WP-2', 'งานสอง',    'complete'),
  ('c3330104-0104-0104-0104-c3c3c3c30104', 'a1110104-0104-0104-0104-a1a1a1a10104',
   'WP-3', 'ไม่มีงบ',   'complete'),
  ('c4440104-0104-0104-0104-c4c4c4c40104', 'a1110104-0104-0104-0104-a1a1a1a10104',
   'WP-4', 'ยังไม่จบ',  'in_progress'),
  ('c5550104-0104-0104-0104-c5c5c5c50104', 'a2220104-0104-0104-0104-a2a2a2a20104',
   'WP-P2', 'งานโครงการสอง', 'complete');

-- Budgets (zero-grant — seeded directly as owner). WP-3 gets NO row → budget NULL.
insert into public.wp_economics (work_package_id, budget) values
  ('c1110104-0104-0104-0104-c1c1c1c10104', 5000),
  ('c2220104-0104-0104-0104-c2c2c2c20104', 4000),
  ('c4440104-0104-0104-0104-c4c4c4c40104', 9999),  -- in_progress; must be ignored
  ('c5550104-0104-0104-0104-c5c5c5c50104', 1000);

-- A senior DC, one full day on WP-1 → wp_labor_sell = senior internal_sell (800).
insert into public.workers (id, name, worker_type, contractor_id, user_id,
                            day_rate, active, level, created_by) values
  ('d1110104-0104-0104-0104-d1d1d1d10104', 'DC อาวุโส', 'dc', null, null, 0, true, 'senior',
   '11111111-1111-1111-1111-111111110104');
insert into public.labor_logs (id, work_package_id, worker_id, work_date,
    day_fraction, day_rate_snapshot, worker_name_snapshot,
    worker_type_snapshot, contractor_id_snapshot, entered_by) values
  ('fa110104-0104-0104-0104-fa1fa1f10104', 'c1110104-0104-0104-0104-c1c1c1c10104',
   'd1110104-0104-0104-0104-d1d1d1d10104', date '2026-06-10', 'full', 0, 'DC อาวุโส', 'dc', null,
   '11111111-1111-1111-1111-111111110104');

-- Close P1 + P2 now that their WPs exist (settlement is "at close"). P3 stays active.
update public.projects set status = 'completed'
 where id in ('a1110104-0104-0104-0104-a1a1a1a10104', 'a2220104-0104-0104-0104-a2a2a2a20104');

-- Multiplier 2.0 (proves the pool reads the dial, not a hardcoded 1).
update public.nova_dials set value = 2.0 where dial_key = 'coin_multiplier';

-- ============================================================================
-- A. Catalog + money posture (as owner).
-- ============================================================================
select has_table('public', 'project_settlements', 'project_settlements table exists');
select col_is_pk('public', 'project_settlements', 'project_id', 'project_id is the PK');
select has_table('public', 'wp_profit_bank', 'wp_profit_bank table exists');
select is((select prosecdef from pg_proc
            where oid = 'public.settle_project(uuid)'::regprocedure),
  true, 'settle_project is SECURITY DEFINER');
select ok(not has_table_privilege('authenticated', 'public.project_settlements', 'SELECT'),
  'authenticated has no SELECT on project_settlements (money)');
select ok(not has_table_privilege('authenticated', 'public.wp_profit_bank', 'SELECT'),
  'authenticated has no SELECT on wp_profit_bank (money)');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;

-- ============================================================================
-- B. Gate — pm / site_admin / visitor cannot settle (42501). No write occurs.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330104"}';
select throws_ok(
  $$ select public.settle_project('a1110104-0104-0104-0104-a1a1a1a10104') $$,
  '42501', null, 'project_manager cannot settle');
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220104"}';
select throws_ok(
  $$ select public.settle_project('a1110104-0104-0104-0104-a1a1a1a10104') $$,
  '42501', null, 'site_admin cannot settle');
set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888880104"}';
select throws_ok(
  $$ select public.settle_project('a1110104-0104-0104-0104-a1a1a1a10104') $$,
  '42501', null, 'visitor cannot settle');

-- ============================================================================
-- C. Super settles P1 (writes the frozen record), then read it back as owner.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110104"}';
select lives_ok(
  $$ select public.settle_project('a1110104-0104-0104-0104-a1a1a1a10104') $$,
  'super_admin settles the closed project');

reset role;
select is((select banked_profit_total from public.project_settlements
            where project_id = 'a1110104-0104-0104-0104-a1a1a1a10104'),
  8200.00::numeric, 'banked_profit_total = 4200 + 4000 (WP-3 null budget skipped)');
select is((select coin_pool from public.project_settlements
            where project_id = 'a1110104-0104-0104-0104-a1a1a1a10104'),
  16400.00::numeric, 'coin_pool = 8200 × multiplier 2.0');
select is((select wp_banked_count from public.project_settlements
            where project_id = 'a1110104-0104-0104-0104-a1a1a1a10104'),
  2, 'wp_banked_count = 2 (WP-1, WP-2)');
select is((select wp_skipped_null_budget_count from public.project_settlements
            where project_id = 'a1110104-0104-0104-0104-a1a1a1a10104'),
  1, 'wp_skipped_null_budget_count = 1 (WP-3)');
select is((select equipment_costed from public.project_settlements
            where project_id = 'a1110104-0104-0104-0104-a1a1a1a10104'),
  true, 'equipment_costed = true (wp_profit now folds in wp_equipment_sell, spec 146 U3)');
select is((select count(*)::int from public.wp_profit_bank
            where project_id = 'a1110104-0104-0104-0104-a1a1a1a10104'),
  2, 'wp_profit_bank holds 2 frozen snapshots');

-- ============================================================================
-- D. Director settles a second closed project (gate allows director).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555550104"}';
select lives_ok(
  $$ select public.settle_project('a2220104-0104-0104-0104-a2a2a2a20104') $$,
  'project_director settles a closed project');

-- ============================================================================
-- E. Idempotency, not-closed, unknown → P0001.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110104"}';
select throws_ok(
  $$ select public.settle_project('a1110104-0104-0104-0104-a1a1a1a10104') $$,
  'P0001', null, 'idempotent: a re-settle of a settled project is rejected');
select throws_ok(
  $$ select public.settle_project('a3330104-0104-0104-0104-a3a3a3a30104') $$,
  'P0001', null, 'an open (active) project cannot be settled');
select throws_ok(
  $$ select public.settle_project('dddddddd-0104-0104-0104-dddddddd0104') $$,
  'P0001', null, 'an unknown project is rejected');

reset role;

select * from finish();
rollback;
