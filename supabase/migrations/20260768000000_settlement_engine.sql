-- Spec 161 U4b / ADR 0060 §3 (model-b) — the project settlement engine. WPs bank
-- their profit as they complete; the whole project settles ONCE at close:
--   coin_pool = Σ banked WP profit × coin_multiplier (the U4a nova_dials dial).
--
-- BANK-AT-SETTLEMENT with a frozen snapshot (not a completion trigger). A
-- completion trigger would fire under WHOEVER updates the WP status — usually a
-- site_admin on the photo-approval path — and the figure must come from wp_profit,
-- which (with wp_labor_sell) is gated to super_admin/project_director and raises
-- 42501 for any other role; banking-at-completion would force an ungated refactor
-- of the shipped U3/U3b functions and fail the completion tx for a site_admin.
-- Instead settle_project is an explicit super/director action at close that calls
-- wp_profit IN ITS DESIGNED CALLER CONTEXT (the gate passes) and FREEZES each
-- completed WP's profit into wp_profit_bank. After settlement, corrections cannot
-- silently move settled coins — U5 reads the frozen bank, never live wp_profit.
--
-- Only 'complete' WPs bank; a budget-NULL WP (wp_profit.profit NULL) is SKIPPED and
-- COUNTED, never silently 0. Idempotent (one project_settlements row per project),
-- closed-only ('completed'/'archived'). This produces the pool NUMBER; distributing
-- it to workers (HT cut + level-weight split → coin_postings) is U5.
--
-- MONEY posture: project_settlements + wp_profit_bank are zero-grant; the operator
-- reads via the admin client, U5 via the definer. super_admin + project_director
-- gate, null-safe `is distinct from` (NULL-role denied), NO project_manager
-- reference → ADR 0058 pgTAP 90/91 untouched.

-- 1. The once-per-project settlement record (project_id PK = the idempotency key).
create table public.project_settlements (
  project_id                  uuid primary key references public.projects(id) on delete cascade,
  coin_multiplier             numeric(20, 4) not null,
  banked_profit_total         numeric(20, 4) not null,
  coin_pool                   numeric(20, 4) not null,
  wp_banked_count             integer not null,
  wp_skipped_null_budget_count integer not null,
  equipment_costed            boolean not null,
  settled_by                  uuid not null references public.users(id),
  settled_at                  timestamptz not null default now(),
  constraint project_settlements_counts_nonneg
    check (wp_banked_count >= 0 and wp_skipped_null_budget_count >= 0)
);

alter table public.project_settlements enable row level security;
revoke all on public.project_settlements from anon, authenticated;

comment on table public.project_settlements is
  'One row per settled project (spec 161 U4b / ADR 0060 §3). coin_pool = banked_profit_total × coin_multiplier (abstract points, no baht peg). project_id PK enforces once-per-project settlement. equipment_costed=false flags the pool as PROVISIONAL until the equipment-usage-log follow-up. MONEY — zero authenticated grant; read via the admin client / U5 distribution.';

-- 2. The frozen per-WP snapshot written at settlement — the immutable record settled
--    coins trace to (so a later correction to wp_profit can't move what was banked).
create table public.wp_profit_bank (
  id               uuid primary key default gen_random_uuid(),
  project_id       uuid not null references public.projects(id) on delete cascade,
  work_package_id  uuid not null references public.work_packages(id),
  budget           numeric(20, 4),
  labor_sell       numeric(20, 4) not null,
  materials_cost   numeric(20, 4) not null,
  equipment_cost   numeric(20, 4) not null,
  equipment_costed boolean not null,
  profit           numeric(20, 4) not null,
  banked_at        timestamptz not null default now(),
  constraint wp_profit_bank_one_per_wp unique (project_id, work_package_id)
);

create index wp_profit_bank_project_idx on public.wp_profit_bank (project_id);

alter table public.wp_profit_bank enable row level security;
revoke all on public.wp_profit_bank from anon, authenticated;

comment on table public.wp_profit_bank is
  'Frozen per-WP profit snapshot written by settle_project (spec 161 U4b). Each row copies the six wp_profit components at settlement time; settled coins (U5) trace to this, not to live wp_profit. MONEY — zero authenticated grant.';

-- 3. settle_project — the engine. super_admin + project_director, at close, once.
create function public.settle_project(p_project uuid)
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
  v_p          record;  -- one row of the wp_profit components (RETURNS TABLE)
begin
  -- Economics are super_admin/project_director-only (NULL role denied; no PM ref).
  if public.current_user_role() is distinct from 'super_admin'
     and public.current_user_role() is distinct from 'project_director' then
    raise exception 'settle_project: role not permitted' using errcode = '42501';
  end if;

  select status into v_status from public.projects where id = p_project;
  if not found then
    raise exception 'settle_project: project not found' using errcode = 'P0001';
  end if;
  -- Settles ONCE at CLOSE (ADR §3) — only a completed/archived project.
  if v_status not in ('completed', 'archived') then
    raise exception 'settle_project: project is not closed' using errcode = 'P0001';
  end if;
  -- Idempotent: settled coins are never re-minted.
  if exists (select 1 from public.project_settlements where project_id = p_project) then
    raise exception 'settle_project: project already settled' using errcode = 'P0001';
  end if;

  v_mult := (select value from public.nova_dials where dial_key = 'coin_multiplier');

  -- Bank each COMPLETE WP at its wp_profit (the gate passes — caller is super/dir).
  for v_wp in
    select id from public.work_packages
     where project_id = p_project and status = 'complete'
  loop
    select * into v_p from public.wp_profit(v_wp);
    if v_p.profit is null then
      -- budget unset → profit NULL → EXCLUDE + COUNT (never silently 0).
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

revoke all on function public.settle_project(uuid) from public;
grant execute on function public.settle_project(uuid) to authenticated;
