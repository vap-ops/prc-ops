begin;
select plan(19);

-- ============================================================================
-- Spec 161 U5 / ADR 0060 §4 — distribute_project_coins(p_project): the settlement
--   POOL → coin_postings. HT takes a cut off the top (ht_cut_pct); the rest splits
--   by LEVEL WEIGHT among the DCs who worked the project (internal > external;
--   externals a flat, level-blind share). Formulaic from labor_logs (the §5 pillar).
--   A DC's share FOLLOWS THEM across moves (weight reads labor_logs, not project_id).
--   super_admin ONLY (minting = peak authority; reuses post_coins). Idempotent.
--   Dials: ht_cut_pct 0.2, senior 4, mid 2, external_factor 2; pool 10000.
--   HT cut 2000; distributable 8000 over Σweight 8 → senior 4000, mid 2000, ext 2000;
--   ungraded DC weight 0 → no share; total minted = pool 10000.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110106', 'super@dist.local', '{}'::jsonb),
  ('55555555-5555-5555-5555-555555550106', 'dir@dist.local',   '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330106', 'pm@dist.local',    '{}'::jsonb),
  ('88888888-8888-8888-8888-888888880106', 'vis@dist.local',   '{}'::jsonb);
update public.users set role='super_admin'      where id='11111111-1111-1111-1111-111111110106';
update public.users set role='project_director' where id='55555555-5555-5555-5555-555555550106';
update public.users set role='project_manager'  where id='33333333-3333-3333-3333-333333330106';
-- '8888…' stays visitor.

-- P1 = the distributed project (active is fine — distribute reads the settlement row,
-- not project status). P2 = a SEPARATE project: the mid DC's CURRENT assignment (proves
-- the share follows the worker) AND the not-settled rejection target.
insert into public.projects (id, code, name, status) values
  ('a1110106-0106-0106-0106-a1a1a1a10106', 'PRC-106-P1', 'โครงการจ่ายเหรียญ', 'active'),
  ('a2220106-0106-0106-0106-a2a2a2a20106', 'PRC-106-P2', 'โครงการที่ย้ายไป',   'active');
insert into public.work_packages (id, project_id, code, name, status) values
  ('c1110106-0106-0106-0106-c1c1c1c10106', 'a1110106-0106-0106-0106-a1a1a1a10106',
   'WP-1', 'งานหนึ่ง', 'complete');

-- A dc_temporary contractor → the external DC's tenure.
insert into public.contractors (id, name, contractor_category, contractor_subtype, created_by)
  values ('cc550106-0106-0106-0106-cc55cc550106', 'รับเหมาชั่วคราว', 'dc', 'dc_temporary',
          '11111111-1111-1111-1111-111111110106');

-- DCs: HT (senior, internal) + senior + mid (currently on P2) + external + ungraded.
insert into public.workers (id, name, worker_type, contractor_id, user_id,
                            day_rate, active, level, project_id, created_by) values
  ('d0000106-0106-0106-0106-d0d0d0d00106', 'HT อาวุโส', 'dc', null, null, 0, true, 'senior', null,
   '11111111-1111-1111-1111-111111110106'),
  ('d1110106-0106-0106-0106-d1d1d1d10106', 'DC อาวุโส', 'dc', null, null, 0, true, 'senior', null,
   '11111111-1111-1111-1111-111111110106'),
  ('d2220106-0106-0106-0106-d2d2d2d20106', 'DC กลาง',   'dc', null, null, 0, true, 'mid',
   'a2220106-0106-0106-0106-a2a2a2a20106',  -- currently on a DIFFERENT project
   '11111111-1111-1111-1111-111111110106'),
  ('d3330106-0106-0106-0106-d3d3d3d30106', 'DC ภายนอก', 'dc',
   'cc550106-0106-0106-0106-cc55cc550106', null, 0, true, 'senior', null,  -- external; level ignored
   '11111111-1111-1111-1111-111111110106'),
  ('d4440106-0106-0106-0106-d4d4d4d40106', 'DC ไม่จัดระดับ', 'dc', null, null, 0, true, null, null,
   '11111111-1111-1111-1111-111111110106');

-- ADR 0062 U2: external is now the WORKER's ชั่วคราว arrangement, not the
-- contractor's dc_temporary subtype. Mark the external DC accordingly.
update public.workers set dc_arrangement = 'temporary'
 where contractor_id = 'cc550106-0106-0106-0106-cc55cc550106';

-- The HT is this project's Head Technician.
update public.projects set ht_worker_id = 'd0000106-0106-0106-0106-d0d0d0d00106'
 where id = 'a1110106-0106-0106-0106-a1a1a1a10106';

-- One full day each on WP-1 (the HT too — to prove it's EXCLUDED from the split).
insert into public.labor_logs (id, work_package_id, worker_id, work_date,
    day_fraction, day_rate_snapshot, worker_name_snapshot,
    worker_type_snapshot, contractor_id_snapshot, entered_by) values
  ('fa000106-0106-0106-0106-fa00fa000106', 'c1110106-0106-0106-0106-c1c1c1c10106',
   'd0000106-0106-0106-0106-d0d0d0d00106', date '2026-06-10', 'full', 0, 'HT อาวุโส', 'dc', null,
   '11111111-1111-1111-1111-111111110106'),
  ('fa110106-0106-0106-0106-fa11fa110106', 'c1110106-0106-0106-0106-c1c1c1c10106',
   'd1110106-0106-0106-0106-d1d1d1d10106', date '2026-06-10', 'full', 0, 'DC อาวุโส', 'dc', null,
   '11111111-1111-1111-1111-111111110106'),
  ('fa220106-0106-0106-0106-fa22fa220106', 'c1110106-0106-0106-0106-c1c1c1c10106',
   'd2220106-0106-0106-0106-d2d2d2d20106', date '2026-06-10', 'full', 0, 'DC กลาง', 'dc', null,
   '11111111-1111-1111-1111-111111110106'),
  ('fa330106-0106-0106-0106-fa33fa330106', 'c1110106-0106-0106-0106-c1c1c1c10106',
   'd3330106-0106-0106-0106-d3d3d3d30106', date '2026-06-10', 'full', 0, 'DC ภายนอก', 'dc',
   'cc550106-0106-0106-0106-cc55cc550106', '11111111-1111-1111-1111-111111110106'),
  ('fa440106-0106-0106-0106-fa44fa440106', 'c1110106-0106-0106-0106-c1c1c1c10106',
   'd4440106-0106-0106-0106-d4d4d4d40106', date '2026-06-10', 'full', 0, 'DC ไม่จัดระดับ', 'dc', null,
   '11111111-1111-1111-1111-111111110106');

-- The settlement pool (U4b output) — seeded directly to isolate from settle_project.
insert into public.project_settlements (project_id, coin_multiplier, banked_profit_total,
    coin_pool, wp_banked_count, wp_skipped_null_budget_count, equipment_costed, settled_by)
  values ('a1110106-0106-0106-0106-a1a1a1a10106', 2.0, 5000, 10000, 1, 0, true,
          '11111111-1111-1111-1111-111111110106');

-- Dials for clean math.
update public.nova_dials set value = 0.2 where dial_key = 'ht_cut_pct';
update public.nova_dials set value = 4   where dial_key = 'level_weight_senior';
update public.nova_dials set value = 2   where dial_key = 'level_weight_mid';
update public.nova_dials set value = 2   where dial_key = 'external_factor';

-- ============================================================================
-- A. Catalog + money posture (as owner).
-- ============================================================================
select has_table('public', 'project_coin_distributions', 'project_coin_distributions table exists');
select col_is_pk('public', 'project_coin_distributions', 'project_id', 'project_id is the PK');
select is((select prosecdef from pg_proc
            where oid = 'public.distribute_project_coins(uuid)'::regprocedure),
  true, 'distribute_project_coins is SECURITY DEFINER');
select ok(not has_table_privilege('authenticated', 'public.project_coin_distributions', 'SELECT'),
  'authenticated has no SELECT on project_coin_distributions (money)');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;

-- ============================================================================
-- B. Gate — super ONLY. director / pm / visitor → 42501.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555550106"}';
select throws_ok(
  $$ select public.distribute_project_coins('a1110106-0106-0106-0106-a1a1a1a10106') $$,
  '42501', null, 'project_director cannot distribute (minting is super-only)');
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330106"}';
select throws_ok(
  $$ select public.distribute_project_coins('a1110106-0106-0106-0106-a1a1a1a10106') $$,
  '42501', null, 'project_manager cannot distribute');
set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888880106"}';
select throws_ok(
  $$ select public.distribute_project_coins('a1110106-0106-0106-0106-a1a1a1a10106') $$,
  '42501', null, 'visitor cannot distribute');

-- ============================================================================
-- C. Not-settled project → P0001 (P2 has no project_settlements row).
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110106"}';
select throws_ok(
  $$ select public.distribute_project_coins('a2220106-0106-0106-0106-a2a2a2a20106') $$,
  'P0001', null, 'an unsettled project cannot be distributed');

-- ============================================================================
-- D. Super distributes P1.
-- ============================================================================
select lives_ok(
  $$ select public.distribute_project_coins('a1110106-0106-0106-0106-a1a1a1a10106') $$,
  'super_admin distributes the settled project');

reset role;
select is(public.coin_balance('d0000106-0106-0106-0106-d0d0d0d00106'),
  2000.0000::numeric, 'HT balance = the 20% cut (2000) only — no double-dip in the split');
select is(public.coin_balance('d1110106-0106-0106-0106-d1d1d1d10106'),
  4000.0000::numeric, 'senior DC = 8000 × 4/8 = 4000');
select is(public.coin_balance('d2220106-0106-0106-0106-d2d2d2d20106'),
  2000.0000::numeric, 'mid DC = 8000 × 2/8 = 2000 (share follows them — now on another project)');
select is(public.coin_balance('d3330106-0106-0106-0106-d3d3d3d30106'),
  2000.0000::numeric, 'external DC = 8000 × external_factor 2/8 = 2000 (flat, level-blind)');
select is(public.coin_balance('d4440106-0106-0106-0106-d4d4d4d40106'),
  0::numeric, 'ungraded DC = 0 (weight 0 → no share, never inflated)');
select is((select ht_coins from public.project_coin_distributions
            where project_id = 'a1110106-0106-0106-0106-a1a1a1a10106'),
  2000.0000::numeric, 'recorded ht_coins = 2000');
select is((select dc_distributed from public.project_coin_distributions
            where project_id = 'a1110106-0106-0106-0106-a1a1a1a10106'),
  8000.0000::numeric, 'recorded dc_distributed = 8000 (total minted = pool 10000)');
select is((select dc_count from public.project_coin_distributions
            where project_id = 'a1110106-0106-0106-0106-a1a1a1a10106'),
  3, 'recorded dc_count = 3 (senior, mid, external; ungraded excluded)');

-- ============================================================================
-- E. Idempotency + unknown → P0001.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110106"}';
select throws_ok(
  $$ select public.distribute_project_coins('a1110106-0106-0106-0106-a1a1a1a10106') $$,
  'P0001', null, 'idempotent: a re-distribute is rejected');
select throws_ok(
  $$ select public.distribute_project_coins('dddddddd-0106-0106-0106-dddddddd0106') $$,
  'P0001', null, 'an unknown project is rejected');

reset role;

select * from finish();
rollback;
