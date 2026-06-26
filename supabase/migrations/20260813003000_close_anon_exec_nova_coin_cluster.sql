-- Security (anon-exec definer sweep — MEDIUM Nova/coin/settlement cluster). Final
-- follow-up to 20260813002400 (wp_economics setters) and 20260813002500 (the 8 HIGH
-- equipment/labor rpcs). Closes the last anon-reachable SECURITY DEFINER functions in
-- the public schema.
--
-- Defect class (see those migrations): Supabase's ALTER DEFAULT PRIVILEGES auto-grants
-- EXECUTE to `anon` on every new public function, and `revoke ... from public` alone
-- does NOT drop that explicit anon grant. These functions were MEDIUM, not HIGH: their
-- role gates already use the null-SAFE form `current_user_role() is distinct from
-- 'super_admin'` (NULL is distinct from 'super_admin' = TRUE → an anon/null-role caller
-- raises 42501), so they are NOT exploitable today — unlike the HIGH set, which had the
-- null-UNSAFE `not in (...)` gate that fell through for anon. The risk closed here is
-- latent: the standing anon grant would become a live unauthenticated write the moment a
-- future DROP+CREATE re-shaped any gate into the null-unsafe form. So this is a pure
-- grant lockdown — NO function bodies are touched (verified the gates live via
-- pg_get_functiondef before writing this). Forward-only / additive (privilege changes
-- only, no DROP / type change / data mutation).
--
-- Scope = every callable (non-trigger) SECURITY DEFINER public function that still
-- granted anon, EXCEPT current_user_role() (which RLS policies invoke as the requesting
-- role, anon included, so it MUST stay open). That is: the coin/settlement WRITE rpcs,
-- the Nova dial / sell-rate / worker-level / shop-config setters, the read-only
-- economics/coin-balance definers (anon EXECUTE there leaked a worker's balances / a WP's
-- money figures to an unauthenticated caller), and update_my_display_name (already
-- null-safe via an explicit auth.uid() guard, locked for parity). The app calls every
-- one of these on an authenticated session; the Nova worker backend uses the service-role
-- key, never anon — so granting authenticated is the complete call path. pgTAP file 229
-- pins each grant AND an invariant that no callable definer may re-open the anon hole.

-- Coin / settlement WRITE cluster ───────────────────────────────────────────────────
revoke all on function public.award_savers_bonus(uuid) from public, anon;
grant execute on function public.award_savers_bonus(uuid) to authenticated;

revoke all on function public.claw_back_project_coins(uuid, text) from public, anon;
grant execute on function public.claw_back_project_coins(uuid, text) to authenticated;

revoke all on function public.confiscate_coins(uuid, public.confiscation_reason, text) from public, anon;
grant execute on function public.confiscate_coins(uuid, public.confiscation_reason, text) to authenticated;

revoke all on function public.distribute_project_coins(uuid) from public, anon;
grant execute on function public.distribute_project_coins(uuid) to authenticated;

revoke all on function public.post_coins(uuid, public.coin_source, numeric, text, timestamptz, uuid) from public, anon;
grant execute on function public.post_coins(uuid, public.coin_source, numeric, text, timestamptz, uuid) to authenticated;

revoke all on function public.redeem_shop_item(uuid, uuid) from public, anon;
grant execute on function public.redeem_shop_item(uuid, uuid) to authenticated;

revoke all on function public.settle_project(uuid) from public, anon;
grant execute on function public.settle_project(uuid) to authenticated;

-- Nova dials / sell-rate / worker-level / shop-config setters ─────────────────────────
revoke all on function public.set_nova_dial(text, numeric) from public, anon;
grant execute on function public.set_nova_dial(text, numeric) to authenticated;

revoke all on function public.set_sell_rate(public.worker_level, numeric, numeric, numeric) from public, anon;
grant execute on function public.set_sell_rate(public.worker_level, numeric, numeric, numeric) to authenticated;

revoke all on function public.set_worker_level(uuid, public.worker_level) from public, anon;
grant execute on function public.set_worker_level(uuid, public.worker_level) to authenticated;

revoke all on function public.set_shop_item_active(uuid, boolean) from public, anon;
grant execute on function public.set_shop_item_active(uuid, boolean) to authenticated;

revoke all on function public.upsert_shop_item(text, numeric, text, integer, uuid) from public, anon;
grant execute on function public.upsert_shop_item(text, numeric, text, integer, uuid) to authenticated;

-- Read-only economics / coin-balance definers (RLS-bypassing reads) ──────────────────
revoke all on function public.coin_spendable_balance(uuid) from public, anon;
grant execute on function public.coin_spendable_balance(uuid) to authenticated;

revoke all on function public.coin_vested_balance(uuid) from public, anon;
grant execute on function public.coin_vested_balance(uuid) to authenticated;

revoke all on function public.coin_unvested_balance(uuid) from public, anon;
grant execute on function public.coin_unvested_balance(uuid) to authenticated;

revoke all on function public.wp_profit(uuid) from public, anon;
grant execute on function public.wp_profit(uuid) to authenticated;

revoke all on function public.wp_labor_sell(uuid) from public, anon;
grant execute on function public.wp_labor_sell(uuid) to authenticated;

revoke all on function public.wp_equipment_sell(uuid) from public, anon;
grant execute on function public.wp_equipment_sell(uuid) to authenticated;

-- Null-safe write, locked for parity ─────────────────────────────────────────────────
revoke all on function public.update_my_display_name(text) from public, anon;
grant execute on function public.update_my_display_name(text) to authenticated;
