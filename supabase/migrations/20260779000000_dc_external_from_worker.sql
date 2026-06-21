-- Spec 170 / ADR 0062 U2 — Nova "external" comes from the WORKER, not the party.
--
-- The external/internal split drove off the worker's contractor being a
-- dc_temporary party (contractor_subtype = 'dc_temporary'). ADR 0062 makes a DC a
-- worker with its own arrangement, so "external" is now worker.dc_arrangement =
-- 'temporary' (ชั่วคราว) — no contractor lookup. Repoints the two functions that
-- read it: distribute_project_coins (coin weight) and coin_unvested_balance (the
-- external lock). Both CREATE OR REPLACE — signatures unchanged, grants preserved.
-- Bodies reproduced from 20260773000100 (distribute) and 20260771000100
-- (coin_unvested_balance); only the external test changes.

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
             -- ADR 0062 U2: external = the worker's own ชั่วคราว arrangement.
             (case when w.dc_arrangement = 'temporary'
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

create or replace function public.coin_unvested_balance(p_worker uuid)
returns numeric
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_balance  numeric;
  v_external boolean;
  v_recent   numeric;
  v_tail     numeric;
begin
  if public.current_user_role() is distinct from 'super_admin'
     and public.current_user_role() is distinct from 'project_director' then
    raise exception 'coin_unvested_balance: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.workers where id = p_worker) then
    raise exception 'coin_unvested_balance: worker not found' using errcode = 'P0001';
  end if;

  v_balance := public.coin_balance(p_worker);

  -- External (ADR 0062 U2: the worker's ชั่วคราว arrangement): the whole balance
  -- is locked/unvested until the worker is invited internal (§4, generalized).
  v_external := exists (
    select 1 from public.workers w
     where w.id = p_worker and w.dc_arrangement = 'temporary');
  if v_external then
    return greatest(v_balance, 0);
  end if;

  -- Internal: recently-earned coins still inside the warranty/defect tail are unvested.
  v_tail := coalesce((select value from public.nova_dials where dial_key = 'vesting_tail_days'), 0);
  select coalesce(sum(amount), 0) into v_recent
    from public.coin_postings
   where worker_id = p_worker and amount > 0
     and occurred_at > now() - (v_tail || ' days')::interval;

  return least(greatest(v_balance, 0), v_recent);
end;
$$;
