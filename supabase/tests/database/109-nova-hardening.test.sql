begin;
select plan(6);

-- ============================================================================
-- Spec 161 hardening (post-arc review) — three fixes:
--   A. settle_project guards a MISSING coin_multiplier (was: silent NULL pool).
--   B. distribute_project_coins allocates the LAST share as an exact remainder so
--      Σ(minted) == pool EXACTLY (no rounding drift / over-mint) even when the pool
--      doesn't divide evenly by the weights.
--   (C. per-worker advisory locks in redeem/confiscate/savers — behavioural, not
--       asserted here; the existing 107/108 confirm single-caller behaviour holds.)
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110109', 'super@hard.local', '{}'::jsonb);
update public.users set role='super_admin' where id='11111111-1111-1111-1111-111111110109';

-- ---------------------------------------------------------------------------
-- A. NULL coin_multiplier → settle_project raises (not a silent NULL pool).
-- ---------------------------------------------------------------------------
insert into public.projects (id, code, name, status) values
  ('a1110109-0109-0109-0109-a1a1a1a10109', 'PRC-109-A', 'โครงการไม่มีตัวคูณ', 'completed');
delete from public.nova_dials where dial_key = 'coin_multiplier';  -- isolated to this tx

-- ---------------------------------------------------------------------------
-- B. Distribute a pool that does NOT divide evenly: 10000 over 3 equal weights.
-- ---------------------------------------------------------------------------
insert into public.projects (id, code, name, status) values
  ('a2220109-0109-0109-0109-a2a2a2a20109', 'PRC-109-B', 'โครงการหารไม่ลงตัว', 'active');
insert into public.work_packages (id, project_id, code, name, status) values
  ('c2220109-0109-0109-0109-c2c2c2c20109', 'a2220109-0109-0109-0109-a2a2a2a20109',
   'WP-B', 'งาน', 'complete');
insert into public.workers (id, name, pay_type, employment_type, contractor_id, user_id, day_rate, active, level, created_by) values
  ('d1110109-0109-0109-0109-d1d1d1d10109', 'DC1', 'daily', 'permanent', null, null, 0, true, 'senior', '11111111-1111-1111-1111-111111110109'),
  ('d2220109-0109-0109-0109-d2d2d2d20109', 'DC2', 'daily', 'permanent', null, null, 0, true, 'senior', '11111111-1111-1111-1111-111111110109'),
  ('d3330109-0109-0109-0109-d3d3d3d30109', 'DC3', 'daily', 'permanent', null, null, 0, true, 'senior', '11111111-1111-1111-1111-111111110109');
insert into public.labor_logs (id, work_package_id, worker_id, work_date, day_fraction,
    day_rate_snapshot, worker_name_snapshot, pay_type_snapshot, entered_by) values
  ('fa110109-0109-0109-0109-fa11fa110109', 'c2220109-0109-0109-0109-c2c2c2c20109', 'd1110109-0109-0109-0109-d1d1d1d10109', date '2026-06-10', 'full', 0, 'DC1', 'daily', '11111111-1111-1111-1111-111111110109'),
  ('fa220109-0109-0109-0109-fa22fa220109', 'c2220109-0109-0109-0109-c2c2c2c20109', 'd2220109-0109-0109-0109-d2d2d2d20109', date '2026-06-10', 'full', 0, 'DC2', 'daily', '11111111-1111-1111-1111-111111110109'),
  ('fa330109-0109-0109-0109-fa33fa330109', 'c2220109-0109-0109-0109-c2c2c2c20109', 'd3330109-0109-0109-0109-d3d3d3d30109', date '2026-06-10', 'full', 0, 'DC3', 'daily', '11111111-1111-1111-1111-111111110109');
-- Settlement pool seeded directly (no HT → full pool distributes).
insert into public.project_settlements (project_id, coin_multiplier, banked_profit_total,
    coin_pool, wp_banked_count, wp_skipped_null_budget_count, equipment_costed, settled_by)
  values ('a2220109-0109-0109-0109-a2a2a2a20109', 1.0, 10000, 10000, 1, 0, true, '11111111-1111-1111-1111-111111110109');
-- ht_cut 0, equal weights → 10000 / 3 = 3333.3333.. (does not divide evenly).
update public.nova_dials set value = 0 where dial_key = 'ht_cut_pct';
update public.nova_dials set value = 1 where dial_key = 'level_weight_senior';

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110109"}';

-- A. The guard.
select throws_ok(
  $$ select public.settle_project('a1110109-0109-0109-0109-a1a1a1a10109') $$,
  'P0001', null, 'settle_project rejects a missing coin_multiplier dial');

-- B. Exact allocation.
select lives_ok(
  $$ select public.distribute_project_coins('a2220109-0109-0109-0109-a2a2a2a20109') $$,
  'distribute succeeds on a non-evenly-divisible pool');

reset role;
select is(
  public.coin_balance('d1110109-0109-0109-0109-d1d1d1d10109')
  + public.coin_balance('d2220109-0109-0109-0109-d2d2d2d20109')
  + public.coin_balance('d3330109-0109-0109-0109-d3d3d3d30109'),
  10000::numeric, 'Σ minted == pool 10000 EXACTLY (last share = remainder, no drift)');
select is(
  (select dc_distributed from public.project_coin_distributions
    where project_id = 'a2220109-0109-0109-0109-a2a2a2a20109'),
  10000.0000::numeric, 'recorded dc_distributed == pool exactly');
select ok(
  public.coin_balance('d1110109-0109-0109-0109-d1d1d1d10109') > 3333::numeric
  and public.coin_balance('d1110109-0109-0109-0109-d1d1d1d10109') < 3334::numeric,
  'each share is ~3333.33 (evenly split bar the remainder cent)');
select is(
  (select count(*)::int from public.coin_postings
    where worker_id in ('d1110109-0109-0109-0109-d1d1d1d10109',
                        'd2220109-0109-0109-0109-d2d2d2d20109',
                        'd3330109-0109-0109-0109-d3d3d3d30109')
      and source = 'profit_share'),
  3, 'all three DCs received a profit_share posting');

select * from finish();
rollback;
