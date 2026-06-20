-- Spec 161 U5 / ADR 0060 §4 — coin distribution. Turns the U4b settlement POOL
-- into postings on the spec-160 coin ledger: the HT takes a cut off the top
-- (ht_cut_pct dial); the rest splits by LEVEL WEIGHT among the DCs who worked the
-- project (Senior→Apprentice; internal > external; externals a flat, level-blind
-- share). FORMULAIC from measured facts (labor_logs) — the anti-favoritism pillar
-- (§5): no subjective input. A DC's share FOLLOWS THEM across project moves — the
-- weight reads labor_logs (where the work was done), never workers.project_id.
--
-- Gate super_admin ONLY (minting = peak operator authority — the post_coins /
-- set_nova_dial gate). Distribution REUSES post_coins (ADR 0061 invariant 2/3),
-- which is super-only; a director computing the pool (U4b) is fine, but MINTING is
-- super. Null-safe `is distinct from`; NO project_manager reference → ADR 0058
-- pgTAP 90/91 untouched.
--
-- Internal vs external = the DC's tenure: a worker whose contractor is
-- contractor_subtype 'dc_temporary' is EXTERNAL; null/other contractor is INTERNAL
-- (ADR 0060 §1; a no-contractor DC defaults internal, like wp_economics.is_external).
--
-- Every economic dial is an editable, SEEDED nova_dials row (decision a). U5 adds
-- the HT cut %, the four level weights, and the external factor — all PLACEHOLDERS
-- the operator must calibrate before go-live.

-- 1. The new dials (placeholders; tuned via set_nova_dial, U4a). external_factor < every
--    internal level weight, so internal > external (the flat external share, level-blind).
insert into public.nova_dials (dial_key, value) values
  ('ht_cut_pct',              0.15),
  ('level_weight_senior',     4),
  ('level_weight_mid',        3),
  ('level_weight_junior',     2),
  ('level_weight_apprentice', 1),
  ('external_factor',         1);

-- 2. The once-per-project distribution record (project_id PK = the idempotency key).
create table public.project_coin_distributions (
  project_id     uuid primary key references public.projects(id) on delete cascade,
  coin_pool      numeric(20, 4) not null,
  ht_worker_id   uuid null references public.workers(id),
  ht_coins       numeric(20, 4) not null,
  dc_distributed numeric(20, 4) not null,
  dc_count       integer not null,
  distributed_by uuid not null references public.users(id),
  distributed_at timestamptz not null default now(),
  constraint project_coin_distributions_nonneg
    check (ht_coins >= 0 and dc_distributed >= 0 and dc_count >= 0)
);

alter table public.project_coin_distributions enable row level security;
revoke all on public.project_coin_distributions from anon, authenticated;

comment on table public.project_coin_distributions is
  'One row per distributed project (spec 161 U5 / ADR 0060 §4). Records the pool split: HT cut + Σ to DCs (by level weight, internal>external). project_id PK enforces once-per-project distribution. The actual coins live in coin_postings (source profit_share). MONEY — zero authenticated grant.';

-- 3. distribute_project_coins — the split. super_admin only, once, after settlement.
create function public.distribute_project_coins(p_project uuid)
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
  v_dist     numeric;       -- distributable after the HT cut
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
  -- Minting coins is peak operator authority (the post_coins gate; NULL role denied).
  if public.current_user_role() is distinct from 'super_admin' then
    raise exception 'distribute_project_coins: role not permitted' using errcode = '42501';
  end if;

  select code into v_code from public.projects where id = p_project;
  if not found then
    raise exception 'distribute_project_coins: project not found' using errcode = 'P0001';
  end if;
  -- The pool comes from U4b — the project must be settled first.
  select coin_pool into v_pool from public.project_settlements where project_id = p_project;
  if not found then
    raise exception 'distribute_project_coins: project not settled' using errcode = 'P0001';
  end if;
  -- Idempotent: coins are never double-minted.
  if exists (select 1 from public.project_coin_distributions where project_id = p_project) then
    raise exception 'distribute_project_coins: project already distributed' using errcode = 'P0001';
  end if;

  -- Dials (decision a). coalesce so a missing dial = 0, never a crash.
  v_ht_cut := coalesce((select value from public.nova_dials where dial_key = 'ht_cut_pct'), 0);
  v_w_sen  := coalesce((select value from public.nova_dials where dial_key = 'level_weight_senior'), 0);
  v_w_mid  := coalesce((select value from public.nova_dials where dial_key = 'level_weight_mid'), 0);
  v_w_jun  := coalesce((select value from public.nova_dials where dial_key = 'level_weight_junior'), 0);
  v_w_app  := coalesce((select value from public.nova_dials where dial_key = 'level_weight_apprentice'), 0);
  v_ext    := coalesce((select value from public.nova_dials where dial_key = 'external_factor'), 0);

  v_ht := (select ht_worker_id from public.projects where id = p_project);

  -- HT cut off the top (§4). No HT or zero cut → nothing off the top.
  v_ht_coins := round(v_pool * v_ht_cut, 4);
  if v_ht is not null and v_ht_coins > 0 then
    perform public.post_coins(v_ht, 'profit_share', v_ht_coins,
      'Profit-share HT cut, project ' || coalesce(v_code, ''));
  else
    v_ht_coins := 0;
  end if;

  v_dist := v_pool - v_ht_coins;

  -- Split the distributable among the NON-HT DCs by weight (the HT's reward is the
  -- cut — no double-dip). weight = (external? external_factor : level_weight[level])
  -- × days; an ungraded internal DC (level NULL → weight 0) is filtered out → no
  -- share, never silently inflated. A window sum gives Σweight over the weight>0 set
  -- (so ungraded days never dilute). days/level read labor_logs (work-done), so a
  -- moved DC keeps the share earned here.
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
    select worker_id, weight, sum(weight) over () as sumw
      from weighted
     where weight > 0
  loop
    if r.sumw > 0 then
      v_coins := round(v_dist * r.weight / r.sumw, 4);
      if v_coins > 0 then
        perform public.post_coins(r.worker_id, 'profit_share', v_coins,
          'Profit-share, project ' || coalesce(v_code, ''));
        v_dc_total := v_dc_total + v_coins;
        v_dc_count := v_dc_count + 1;
      end if;
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

revoke all on function public.distribute_project_coins(uuid) from public;
grant execute on function public.distribute_project_coins(uuid) to authenticated;
