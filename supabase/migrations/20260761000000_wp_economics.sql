-- Spec 161 U2 / ADR 0060 — WP economic identity. The PD-set `budget` (the WP's
-- profit denominator, hidden from non-HT DCs) + the internal/external flag, in
-- their own table so the budget keeps the MONEY posture (zero authenticated
-- grant — the wp_labor_costs / day_rate pattern) instead of leaking through a
-- work_packages column grant. Setters upsert one row per WP. Nothing computes a
-- profit from these yet — that is U3.

create table public.wp_economics (
  work_package_id uuid primary key references public.work_packages(id) on delete cascade,
  budget          numeric(20, 4) null,
  is_external     boolean not null default false,
  updated_by      uuid null references public.users(id),
  updated_at      timestamptz not null default now(),
  constraint wp_economics_budget_nonnegative check (budget is null or budget >= 0)
);

alter table public.wp_economics enable row level security;
-- Zero grant (budget is money): pm/director/super read via the admin client;
-- the SECURITY DEFINER setters are the only writers.
revoke all on public.wp_economics from anon, authenticated;

comment on table public.wp_economics is
  'Per-WP economic identity (spec 161 U2 / ADR 0060): PD-set budget (the profit denominator) + internal/external flag. MONEY — zero authenticated grant; upserted by set_wp_budget / set_wp_external; read by the WP P&L (U3), not built yet.';

-- set_wp_budget — the PD sets the budget (ADR 0060 §1; the anti-favoritism root
-- is benchmarking budget to scope). project_director + super only — NO
-- project_manager reference, so the ADR 0058 pgTAP 90/91 invariants don't apply.
create function public.set_wp_budget(p_wp uuid, p_budget numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
begin
  if public.current_user_role() not in ('project_director', 'super_admin') then
    raise exception 'set_wp_budget: role not permitted' using errcode = '42501';
  end if;
  if p_budget is null or p_budget < 0 then
    raise exception 'set_wp_budget: budget must be non-negative' using errcode = 'P0001';
  end if;
  select true into v_exists from public.work_packages where id = p_wp;
  if not found then
    raise exception 'set_wp_budget: work package not found' using errcode = 'P0001';
  end if;

  insert into public.wp_economics (work_package_id, budget, updated_by, updated_at)
  values (p_wp, p_budget, auth.uid(), now())
  on conflict (work_package_id) do update
    set budget = excluded.budget, updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('update', auth.uid(), public.current_user_role(), 'wp_economics', p_wp,
          jsonb_build_object('field', 'budget', 'value', p_budget));
end;
$$;

-- set_wp_external — the PM classifies the WP internal/external (drives which
-- sell rate applies, U3). project_manager + project_director + super — references
-- project_manager, so project_director is included (ADR 0058 invariant).
create function public.set_wp_external(p_wp uuid, p_is_external boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
begin
  if public.current_user_role()
       not in ('project_manager', 'project_director', 'super_admin') then
    raise exception 'set_wp_external: role not permitted' using errcode = '42501';
  end if;
  if p_is_external is null then
    raise exception 'set_wp_external: is_external is required' using errcode = 'P0001';
  end if;
  select true into v_exists from public.work_packages where id = p_wp;
  if not found then
    raise exception 'set_wp_external: work package not found' using errcode = 'P0001';
  end if;

  insert into public.wp_economics (work_package_id, is_external, updated_by, updated_at)
  values (p_wp, p_is_external, auth.uid(), now())
  on conflict (work_package_id) do update
    set is_external = excluded.is_external, updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('update', auth.uid(), public.current_user_role(), 'wp_economics', p_wp,
          jsonb_build_object('field', 'is_external', 'value', p_is_external));
end;
$$;
