-- Spec 161 hardening (post-arc adversarial review, 2026-06-21) — three fixes to the
-- coin engine. All are create-or-replace of shipped functions (same signatures →
-- grants preserved); behaviour is unchanged for the existing tests (104-108), only
-- the edge/race cases below change.
--
--   A. settle_project: a MISSING coin_multiplier dial produced a silent NULL pool.
--      Guard it → P0001 (the dial is seeded + RPC-protected, but a deleted dial must
--      fail loud, not bank a worthless settlement).
--   B. distribute_project_coins: per-worker round() drifted — Σ shares could exceed
--      (over-mint) or undershoot the pool. Allocate the LAST share as the exact
--      remainder (pool − Σ others) so Σ(minted) == pool EXACTLY. Never over-mints.
--   C. redeem_shop_item / confiscate_coins / award_savers_bonus: a balance-check-
--      then-post TOCTOU race let two concurrent calls both pass the check and both
--      post (overspend / double-confiscate / double-bonus). A per-worker advisory
--      xact lock serializes them (the log_labor_day pattern; auto-released at commit).

-- ===========================================================================
-- A. settle_project — guard a missing multiplier.
-- ===========================================================================
create or replace function public.settle_project(p_project uuid)
returns table (
  coin_pool                    numeric,
  banked_profit_total          numeric,
  coin_multiplier              numeric,
  wp_banked_count              integer,
  wp_skipped_null_budget_count integer,
  equipment_costed             boolean
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status     public.project_status;
  v_mult       numeric;
  v_total      numeric := 0;
  v_banked     integer := 0;
  v_skipped    integer := 0;
  v_all_costed boolean := true;
  v_wp         uuid;
  v_p          record;
begin
  if public.current_user_role() is distinct from 'super_admin'
     and public.current_user_role() is distinct from 'project_director' then
    raise exception 'settle_project: role not permitted' using errcode = '42501';
  end if;

  select status into v_status from public.projects where id = p_project;
  if not found then
    raise exception 'settle_project: project not found' using errcode = 'P0001';
  end if;
  if v_status not in ('completed', 'archived') then
    raise exception 'settle_project: project is not closed' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.project_settlements where project_id = p_project) then
    raise exception 'settle_project: project already settled' using errcode = 'P0001';
  end if;

  v_mult := (select value from public.nova_dials where dial_key = 'coin_multiplier');
  -- The dial is seeded + update-only, but a deleted dial must fail loud, never
  -- silently bank a NULL pool.
  if v_mult is null then
    raise exception 'settle_project: coin_multiplier dial missing' using errcode = 'P0001';
  end if;

  for v_wp in
    select id from public.work_packages
     where project_id = p_project and status = 'complete'
  loop
    select * into v_p from public.wp_profit(v_wp);
    if v_p.profit is null then
      v_skipped := v_skipped + 1;
      continue;
    end if;
    insert into public.wp_profit_bank (project_id, work_package_id, budget, labor_sell,
        materials_cost, equipment_cost, equipment_costed, profit)
    values (p_project, v_wp, v_p.budget, v_p.labor_sell, v_p.materials_cost,
        v_p.equipment_cost, v_p.equipment_costed, v_p.profit);
    v_total      := v_total + v_p.profit;
    v_banked     := v_banked + 1;
    v_all_costed := v_all_costed and v_p.equipment_costed;
  end loop;

  insert into public.project_settlements (project_id, coin_multiplier, banked_profit_total,
      coin_pool, wp_banked_count, wp_skipped_null_budget_count, equipment_costed, settled_by)
  values (p_project, v_mult, v_total, v_total * v_mult, v_banked, v_skipped,
      v_all_costed, auth.uid());

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('update', auth.uid(), public.current_user_role(), 'project_settlements', p_project,
          jsonb_build_object('coin_multiplier', v_mult, 'banked_profit_total', v_total,
            'coin_pool', v_total * v_mult, 'wp_banked_count', v_banked,
            'wp_skipped_null_budget_count', v_skipped, 'equipment_costed', v_all_costed));

  return query select v_total * v_mult, v_total, v_mult, v_banked, v_skipped, v_all_costed;
end;
$$;

-- ===========================================================================
-- B. distribute_project_coins — exact remainder allocation (no over-mint).
-- ===========================================================================
create or replace function public.distribute_project_coins(p_project uuid)
returns table (
  ht_coins          numeric,
  dc_distributed    numeric,
  dc_count          integer,
  total_distributed numeric
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pool     numeric;
  v_code     text;
  v_ht       uuid;
  v_ht_cut   numeric;
  v_ht_coins numeric;
  v_dist     numeric;
  v_w_sen    numeric;
  v_w_mid    numeric;
  v_w_jun    numeric;
  v_w_app    numeric;
  v_ext      numeric;
  v_dc_total numeric := 0;
  v_dc_count integer := 0;
  v_coins    numeric;
  r          record;
begin
  if public.current_user_role() is distinct from 'super_admin' then
    raise exception 'distribute_project_coins: role not permitted' using errcode = '42501';
  end if;

  select code into v_code from public.projects where id = p_project;
  if not found then
    raise exception 'distribute_project_coins: project not found' using errcode = 'P0001';
  end if;
  select coin_pool into v_pool from public.project_settlements where project_id = p_project;
  if not found then
    raise exception 'distribute_project_coins: project not settled' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.project_coin_distributions where project_id = p_project) then
    raise exception 'distribute_project_coins: project already distributed' using errcode = 'P0001';
  end if;

  v_ht_cut := coalesce((select value from public.nova_dials where dial_key = 'ht_cut_pct'), 0);
  v_w_sen  := coalesce((select value from public.nova_dials where dial_key = 'level_weight_senior'), 0);
  v_w_mid  := coalesce((select value from public.nova_dials where dial_key = 'level_weight_mid'), 0);
  v_w_jun  := coalesce((select value from public.nova_dials where dial_key = 'level_weight_junior'), 0);
  v_w_app  := coalesce((select value from public.nova_dials where dial_key = 'level_weight_apprentice'), 0);
  v_ext    := coalesce((select value from public.nova_dials where dial_key = 'external_factor'), 0);

  v_ht := (select ht_worker_id from public.projects where id = p_project);

  v_ht_coins := round(v_pool * v_ht_cut, 4);
  if v_ht is not null and v_ht_coins > 0 then
    perform public.post_coins(v_ht, 'profit_share', v_ht_coins,
      'Profit-share HT cut, project ' || coalesce(v_code, ''));
  else
    v_ht_coins := 0;
  end if;

  v_dist := v_pool - v_ht_coins;

  -- Split among non-HT DCs by weight. The LAST worker (by worker_id) gets the exact
  -- remainder (v_dist − Σ already allocated) so Σ(minted) == v_dist EXACTLY — per-row
  -- round() alone drifts and could over-mint. row_number/count partition the loop.
  for r in
    with worker_days as (
      select ll.worker_id,
             sum(case ll.day_fraction when 'full' then 1.0 else 0.5 end) as days
        from public.labor_logs ll
        join public.work_packages wp on wp.id = ll.work_package_id
       where wp.project_id = p_project
         and ll.worker_type_snapshot = 'dc'
         and ll.day_fraction is not null
         and not exists (select 1 from public.labor_logs n where n.superseded_by = ll.id)
         and (v_ht is null or ll.worker_id <> v_ht)
       group by ll.worker_id
    ),
    weighted as (
      select wd.worker_id,
             (case when exists (
                     select 1 from public.contractors c
                      where c.id = w.contractor_id and c.contractor_subtype = 'dc_temporary')
                   then v_ext
                   else coalesce(case w.level
                          when 'senior'     then v_w_sen
                          when 'mid'        then v_w_mid
                          when 'junior'     then v_w_jun
                          when 'apprentice' then v_w_app
                          else 0 end, 0)
              end) * wd.days as weight
        from worker_days wd
        join public.workers w on w.id = wd.worker_id
    )
    select worker_id, weight,
           sum(weight) over ()                       as sumw,
           row_number() over (order by worker_id)    as rn,
           count(*) over ()                          as cnt
      from weighted
     where weight > 0
  loop
    if r.sumw <= 0 then
      continue;
    end if;
    if r.rn = r.cnt then
      v_coins := round(v_dist - v_dc_total, 4);   -- last takes the exact remainder
    else
      v_coins := round(v_dist * r.weight / r.sumw, 4);
    end if;
    if v_coins > 0 then
      perform public.post_coins(r.worker_id, 'profit_share', v_coins,
        'Profit-share, project ' || coalesce(v_code, ''));
      v_dc_total := v_dc_total + v_coins;
      v_dc_count := v_dc_count + 1;
    end if;
  end loop;

  insert into public.project_coin_distributions (project_id, coin_pool, ht_worker_id,
      ht_coins, dc_distributed, dc_count, distributed_by)
  values (p_project, v_pool, v_ht, v_ht_coins, v_dc_total, v_dc_count, auth.uid());

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('update', auth.uid(), public.current_user_role(), 'project_coin_distributions',
          p_project, jsonb_build_object('coin_pool', v_pool, 'ht_coins', v_ht_coins,
            'dc_distributed', v_dc_total, 'dc_count', v_dc_count));

  return query select v_ht_coins, v_dc_total, v_dc_count, v_ht_coins + v_dc_total;
end;
$$;

-- ===========================================================================
-- C. Per-worker advisory locks on the balance-check-then-post RPCs.
-- ===========================================================================
create or replace function public.redeem_shop_item(p_worker uuid, p_item uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_price     numeric;
  v_active    boolean;
  v_name      text;
  v_spendable numeric;
  v_posting   uuid;
  v_id        uuid;
begin
  if public.current_user_role() is distinct from 'super_admin' then
    raise exception 'redeem_shop_item: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.workers where id = p_worker) then
    raise exception 'redeem_shop_item: worker not found' using errcode = 'P0001';
  end if;

  -- Serialize coin debits for this worker — the spendable check + the post must not
  -- race a concurrent redeem/confiscate (else both pass and overspend).
  perform pg_advisory_xact_lock(hashtextextended('nova_coin:' || p_worker::text, 0));

  select price_coins, active, name into v_price, v_active, v_name
    from public.shop_items where id = p_item;
  if not found then
    raise exception 'redeem_shop_item: item not found' using errcode = 'P0001';
  end if;
  if not v_active then
    raise exception 'redeem_shop_item: item is not available' using errcode = 'P0001';
  end if;

  v_spendable := public.coin_spendable_balance(p_worker);
  if v_spendable < v_price then
    raise exception 'redeem_shop_item: insufficient spendable balance' using errcode = 'P0001';
  end if;

  v_posting := public.post_coins(p_worker, 'shop_redemption', -v_price,
    'Shop redemption: ' || v_name);

  insert into public.shop_redemptions (worker_id, item_id, price_coins, posting_id, redeemed_by)
  values (p_worker, p_item, v_price, v_posting, auth.uid())
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.confiscate_coins(
  p_worker uuid,
  p_reason public.confiscation_reason,
  p_note text default null
)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_unvested numeric;
  v_note     text := nullif(trim(coalesce(p_note, '')), '');
  v_posting  uuid;
begin
  if public.current_user_role() is distinct from 'super_admin' then
    raise exception 'confiscate_coins: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.workers where id = p_worker) then
    raise exception 'confiscate_coins: worker not found' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('nova_coin:' || p_worker::text, 0));

  v_unvested := public.coin_unvested_balance(p_worker);
  if v_unvested <= 0 then
    raise exception 'confiscate_coins: no unvested coins to confiscate (vested coins are kept)'
      using errcode = 'P0001';
  end if;

  v_posting := public.post_coins(p_worker, 'confiscation', -v_unvested,
    'Confiscation (' || p_reason::text || ')' || coalesce(': ' || v_note, ''));

  insert into public.coin_confiscations (worker_id, reason, amount, note, posting_id, confiscated_by)
  values (p_worker, p_reason, v_unvested, v_note, v_posting, auth.uid());
  return v_unvested;
end;
$$;

create or replace function public.award_savers_bonus(p_worker uuid)
returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate       numeric;
  v_bal        numeric;
  v_last_bonus timestamptz;
  v_bonus      numeric;
  v_posting    uuid;
begin
  if public.current_user_role() is distinct from 'super_admin' then
    raise exception 'award_savers_bonus: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.workers where id = p_worker) then
    raise exception 'award_savers_bonus: worker not found' using errcode = 'P0001';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('nova_coin:' || p_worker::text, 0));

  v_bal := public.coin_balance(p_worker);
  if v_bal <= 0 then
    raise exception 'award_savers_bonus: no balance to reward' using errcode = 'P0001';
  end if;

  v_last_bonus := (select max(occurred_at) from public.coin_postings
                    where worker_id = p_worker and source = 'savers_bonus');
  if v_last_bonus is not null and exists (
    select 1 from public.coin_postings
     where worker_id = p_worker and source = 'shop_redemption' and occurred_at > v_last_bonus
  ) then
    raise exception 'award_savers_bonus: spent since last bonus' using errcode = 'P0001';
  end if;

  v_rate := coalesce((select value from public.nova_dials where dial_key = 'savers_bonus_rate'), 0);
  v_bonus := round(v_bal * v_rate, 4);
  if v_bonus <= 0 then
    raise exception 'award_savers_bonus: bonus is zero (rate not set)' using errcode = 'P0001';
  end if;

  v_posting := public.post_coins(p_worker, 'savers_bonus', v_bonus, 'Saver bonus');
  return v_bonus;
end;
$$;
