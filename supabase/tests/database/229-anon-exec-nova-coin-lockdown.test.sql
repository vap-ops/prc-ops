-- Security (anon-exec definer sweep — MEDIUM Nova/coin/settlement cluster, follow-up
-- to 20260813002400/002500). Closes the last anon-reachable SECURITY DEFINER functions
-- in the public schema. Same defect class as the wp_economics setters and the 8 HIGH
-- equipment/labor rpcs: Supabase's ALTER DEFAULT PRIVILEGES auto-grants EXECUTE to anon
-- on every new public function, and `revoke from public` alone does NOT drop that
-- explicit anon grant. These were MEDIUM (not exploitable today — the gates already use
-- the null-safe `current_user_role() is distinct from 'super_admin'` form, so a null/anon
-- role raises 42501), but the anon grant would become a live hole if a future DROP+CREATE
-- ever re-shaped a gate into the null-unsafe `not in (...)` form. Lock the whole surface
-- to authenticated and pin an invariant so the class can never silently re-open.

begin;
select plan(41);

-- A. Per-function grant lockdown: anon must NOT execute; authenticated MUST retain it
--    (the app's call path runs every one of these on an authenticated session — the
--    Nova worker backend uses the service-role key, never anon).

-- A1. Coin / settlement WRITE cluster (super_admin or director gated).
select is(has_function_privilege('anon', 'public.award_savers_bonus(uuid)', 'EXECUTE'),
  false, 'anon cannot execute award_savers_bonus');
select is(has_function_privilege('authenticated', 'public.award_savers_bonus(uuid)', 'EXECUTE'),
  true, 'authenticated can execute award_savers_bonus');

select is(has_function_privilege('anon', 'public.claw_back_project_coins(uuid, text)', 'EXECUTE'),
  false, 'anon cannot execute claw_back_project_coins');
select is(has_function_privilege('authenticated', 'public.claw_back_project_coins(uuid, text)', 'EXECUTE'),
  true, 'authenticated can execute claw_back_project_coins');

select is(has_function_privilege('anon', 'public.confiscate_coins(uuid, public.confiscation_reason, text)', 'EXECUTE'),
  false, 'anon cannot execute confiscate_coins');
select is(has_function_privilege('authenticated', 'public.confiscate_coins(uuid, public.confiscation_reason, text)', 'EXECUTE'),
  true, 'authenticated can execute confiscate_coins');

select is(has_function_privilege('anon', 'public.distribute_project_coins(uuid)', 'EXECUTE'),
  false, 'anon cannot execute distribute_project_coins');
select is(has_function_privilege('authenticated', 'public.distribute_project_coins(uuid)', 'EXECUTE'),
  true, 'authenticated can execute distribute_project_coins');

select is(has_function_privilege('anon', 'public.post_coins(uuid, public.coin_source, numeric, text, timestamptz, uuid)', 'EXECUTE'),
  false, 'anon cannot execute post_coins');
select is(has_function_privilege('authenticated', 'public.post_coins(uuid, public.coin_source, numeric, text, timestamptz, uuid)', 'EXECUTE'),
  true, 'authenticated can execute post_coins');

select is(has_function_privilege('anon', 'public.redeem_shop_item(uuid, uuid)', 'EXECUTE'),
  false, 'anon cannot execute redeem_shop_item');
select is(has_function_privilege('authenticated', 'public.redeem_shop_item(uuid, uuid)', 'EXECUTE'),
  true, 'authenticated can execute redeem_shop_item');

select is(has_function_privilege('anon', 'public.settle_project(uuid)', 'EXECUTE'),
  false, 'anon cannot execute settle_project');
select is(has_function_privilege('authenticated', 'public.settle_project(uuid)', 'EXECUTE'),
  true, 'authenticated can execute settle_project');

-- A2. Nova dials / sell-rate / worker-level / shop config WRITE setters (super only).
select is(has_function_privilege('anon', 'public.set_nova_dial(text, numeric)', 'EXECUTE'),
  false, 'anon cannot execute set_nova_dial');
select is(has_function_privilege('authenticated', 'public.set_nova_dial(text, numeric)', 'EXECUTE'),
  true, 'authenticated can execute set_nova_dial');

select is(has_function_privilege('anon', 'public.set_sell_rate(public.worker_level, numeric, numeric, numeric)', 'EXECUTE'),
  false, 'anon cannot execute set_sell_rate');
select is(has_function_privilege('authenticated', 'public.set_sell_rate(public.worker_level, numeric, numeric, numeric)', 'EXECUTE'),
  true, 'authenticated can execute set_sell_rate');

select is(has_function_privilege('anon', 'public.set_worker_level(uuid, public.worker_level)', 'EXECUTE'),
  false, 'anon cannot execute set_worker_level');
select is(has_function_privilege('authenticated', 'public.set_worker_level(uuid, public.worker_level)', 'EXECUTE'),
  true, 'authenticated can execute set_worker_level');

select is(has_function_privilege('anon', 'public.set_shop_item_active(uuid, boolean)', 'EXECUTE'),
  false, 'anon cannot execute set_shop_item_active');
select is(has_function_privilege('authenticated', 'public.set_shop_item_active(uuid, boolean)', 'EXECUTE'),
  true, 'authenticated can execute set_shop_item_active');

select is(has_function_privilege('anon', 'public.upsert_shop_item(text, numeric, text, integer, uuid)', 'EXECUTE'),
  false, 'anon cannot execute upsert_shop_item');
select is(has_function_privilege('authenticated', 'public.upsert_shop_item(text, numeric, text, integer, uuid)', 'EXECUTE'),
  true, 'authenticated can execute upsert_shop_item');

-- A3. Read-only economics/coin-balance DEFINERS — bypass RLS, so anon EXECUTE leaks a
--     worker's coin balances / a WP's money figures to an unauthenticated caller. Lock
--     them down too (defense-in-depth; these were the LOW tail of the same audit).
select is(has_function_privilege('anon', 'public.coin_spendable_balance(uuid)', 'EXECUTE'),
  false, 'anon cannot execute coin_spendable_balance');
select is(has_function_privilege('authenticated', 'public.coin_spendable_balance(uuid)', 'EXECUTE'),
  true, 'authenticated can execute coin_spendable_balance');

select is(has_function_privilege('anon', 'public.coin_vested_balance(uuid)', 'EXECUTE'),
  false, 'anon cannot execute coin_vested_balance');
select is(has_function_privilege('authenticated', 'public.coin_vested_balance(uuid)', 'EXECUTE'),
  true, 'authenticated can execute coin_vested_balance');

select is(has_function_privilege('anon', 'public.coin_unvested_balance(uuid)', 'EXECUTE'),
  false, 'anon cannot execute coin_unvested_balance');
select is(has_function_privilege('authenticated', 'public.coin_unvested_balance(uuid)', 'EXECUTE'),
  true, 'authenticated can execute coin_unvested_balance');

select is(has_function_privilege('anon', 'public.wp_profit(uuid)', 'EXECUTE'),
  false, 'anon cannot execute wp_profit');
select is(has_function_privilege('authenticated', 'public.wp_profit(uuid)', 'EXECUTE'),
  true, 'authenticated can execute wp_profit');

select is(has_function_privilege('anon', 'public.wp_labor_sell(uuid)', 'EXECUTE'),
  false, 'anon cannot execute wp_labor_sell');
select is(has_function_privilege('authenticated', 'public.wp_labor_sell(uuid)', 'EXECUTE'),
  true, 'authenticated can execute wp_labor_sell');

select is(has_function_privilege('anon', 'public.wp_equipment_sell(uuid)', 'EXECUTE'),
  false, 'anon cannot execute wp_equipment_sell');
select is(has_function_privilege('authenticated', 'public.wp_equipment_sell(uuid)', 'EXECUTE'),
  true, 'authenticated can execute wp_equipment_sell');

-- A4. update_my_display_name — null-SAFE write (explicit auth.uid() guard) but the anon
--     grant was still missing; close it for parity.
select is(has_function_privilege('anon', 'public.update_my_display_name(text)', 'EXECUTE'),
  false, 'anon cannot execute update_my_display_name');
select is(has_function_privilege('authenticated', 'public.update_my_display_name(text)', 'EXECUTE'),
  true, 'authenticated can execute update_my_display_name');

-- B. Class invariant — the durable guard. No callable (non-trigger) SECURITY DEFINER
--    function in public may grant anon EXECUTE, except current_user_role() (which RLS
--    policies invoke as the requesting role, including anon, so it MUST stay open).
--    Trigger functions are excluded: their EXECUTE bit is never checked when a trigger
--    fires, so an anon grant on them is inert. A new definer rpc that re-opens the hole
--    fails here until it is consciously locked down (or allowlisted).
select is(
  (select count(*)::int
     from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.prorettype <> 'pg_catalog.trigger'::regtype
      and p.proname <> 'current_user_role'
      and has_function_privilege('anon', p.oid, 'EXECUTE')),
  0,
  'no callable SECURITY DEFINER public function grants anon EXECUTE (except current_user_role)');

-- C. Null-safe-gate spot-check — proves the lockdown is belt-and-suspenders, not the
--    sole defense: even reached as an authenticated session with no sub (null role),
--    the role gate still raises 42501 (it never falls through to the money write).
--    Uses uuid-only signatures to avoid enum-coercion noise in the call binding.
grant insert  on _tap_buf to authenticated;
grant select  on _tap_buf to authenticated;
grant usage   on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;
set local "request.jwt.claims" = '{}';
select throws_ok(
  $$ select public.settle_project('dddddddd-dddd-dddd-dddd-dddddddddddd') $$,
  '42501', null, 'a null-role / anon session cannot settle_project (null-safe gate)');
select throws_ok(
  $$ select public.distribute_project_coins('dddddddd-dddd-dddd-dddd-dddddddddddd') $$,
  '42501', null, 'a null-role / anon session cannot distribute_project_coins (null-safe gate)');
reset role;

select * from finish();
rollback;
