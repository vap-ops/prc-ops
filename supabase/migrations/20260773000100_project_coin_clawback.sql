-- Spec 161 U10 — the per-project defect clawback (ADR 0060 design-rule 1: a defect
-- reopen claws back). Two parts:
--   1. distribute_project_coins now TAGS its profit_share postings with the project
--      (source_project_id) so they can be clawed precisely later.
--   2. claw_back_project_coins(p_project) — super_admin only; for each worker who
--      still holds UNVESTED profit_share from the project, posts a negative
--      'confiscation' (reason defect_rework) for the lesser of {the project's
--      remaining coins, the worker's total unvested}. VESTED coins (past the warranty
--      tail) and OTHER projects' coins are never touched (the trust invariant). It
--      NETS prior clawbacks (the project's signed sum within the tail) → idempotent.
--
-- Deliberately MANUAL, not auto-fired from spec-144 reopen_work_package_for_defect:
-- (a) a single-WP defect auto-clawing a whole project's distribution is too blunt;
-- (b) reopen is callable by site_admin/PM, but minting/forfeiting is super-only — an
-- auto-call would hit the super gate (42501) or force an ungated bypass of post_coins.
-- The operator claws back via this RPC (or its UI) when a defect warrants it.

-- 1. distribute_project_coins — tag postings with the project.
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
      'Profit-share HT cut, project ' || coalesce(v_code, ''), now(), p_project);
  else
    v_ht_coins := 0;
  end if;

  v_dist := v_pool - v_ht_coins;

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
           sum(weight) over ()                    as sumw,
           row_number() over (order by worker_id) as rn,
           count(*) over ()                       as cnt
      from weighted
     where weight > 0
  loop
    if r.sumw <= 0 then
      continue;
    end if;
    if r.rn = r.cnt then
      v_coins := round(v_dist - v_dc_total, 4);
    else
      v_coins := round(v_dist * r.weight / r.sumw, 4);
    end if;
    if v_coins > 0 then
      perform public.post_coins(r.worker_id, 'profit_share', v_coins,
        'Profit-share, project ' || coalesce(v_code, ''), now(), p_project);
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

-- 2. claw_back_project_coins — forfeit the project's still-unvested profit_share.
create function public.claw_back_project_coins(p_project uuid, p_note text default null)
returns table (clawed_workers integer, clawed_total numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code     text;
  v_tail     numeric;
  v_note     text := nullif(trim(coalesce(p_note, '')), '');
  v_clawable numeric;
  v_posting  uuid;
  v_count    integer := 0;
  v_total    numeric := 0;
  r          record;
begin
  if public.current_user_role() is distinct from 'super_admin' then
    raise exception 'claw_back_project_coins: role not permitted' using errcode = '42501';
  end if;
  select code into v_code from public.projects where id = p_project;
  if not found then
    raise exception 'claw_back_project_coins: project not found' using errcode = 'P0001';
  end if;

  v_tail := coalesce((select value from public.nova_dials where dial_key = 'vesting_tail_days'), 0);

  -- Per worker: the project's REMAINING coins within the tail = signed Σ of this
  -- project's postings in-window (profit_share + / prior clawbacks −). > 0 = still
  -- unvested + unclawed → netting makes a re-run idempotent.
  for r in
    select cp.worker_id, greatest(sum(cp.amount), 0) as proj_remaining
      from public.coin_postings cp
     where cp.source_project_id = p_project
       and cp.occurred_at > now() - (v_tail || ' days')::interval
     group by cp.worker_id
    having greatest(sum(cp.amount), 0) > 0
  loop
    perform pg_advisory_xact_lock(hashtextextended('nova_coin:' || r.worker_id::text, 0));
    -- Never claw more than the worker actually holds unvested (vested coins are safe).
    v_clawable := least(r.proj_remaining, public.coin_unvested_balance(r.worker_id));
    if v_clawable > 0 then
      v_posting := public.post_coins(r.worker_id, 'confiscation', -v_clawable,
        'Defect clawback, project ' || coalesce(v_code, ''), now(), p_project);
      insert into public.coin_confiscations (worker_id, reason, amount, note, posting_id, confiscated_by)
      values (r.worker_id, 'defect_rework', v_clawable, v_note, v_posting, auth.uid());
      v_total := v_total + v_clawable;
      v_count := v_count + 1;
    end if;
  end loop;

  return query select v_count, v_total;
end;
$$;

revoke all on function public.claw_back_project_coins(uuid, text) from public;
grant execute on function public.claw_back_project_coins(uuid, text) to authenticated;
