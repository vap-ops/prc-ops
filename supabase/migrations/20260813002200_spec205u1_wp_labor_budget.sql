-- Spec 205 U1 — per-WP labor budget. A money (baht) cost ceiling for labor,
-- distinct from wp_economics.budget (the ADR 0060 profit denominator, PD-only):
-- this is a cost-side planning target the PM OR PD sets, compared against the
-- frozen/live labor cost on the PM review page. It lives on wp_economics to keep
-- the MONEY posture (zero authenticated grant) and the one-row-per-WP upsert
-- setter pattern. It does NOT feed wp_profit — a display target only.

alter table public.wp_economics
  add column labor_budget numeric(20, 4) null;

alter table public.wp_economics
  add constraint wp_economics_labor_budget_nonnegative
  check (labor_budget is null or labor_budget >= 0);

comment on table public.wp_economics is
  'Per-WP economic identity (spec 161 U2 / ADR 0060): PD-set budget (the profit denominator) + internal/external flag + PM/PD-set labor_budget (spec 205 — a labor cost ceiling, a display target NOT read into wp_profit). MONEY — zero authenticated grant; upserted by set_wp_budget / set_wp_external / set_wp_labor_budget, read by the PM WP review page.';

-- set_wp_labor_budget — the PM or PD sets the labor cost ceiling. The gate names
-- project_manager, so project_director rides along (ADR 0058 / pgTAP 90) and
-- super is admitted. This deliberately widens beyond set_wp_budget (PD-only): the
-- PM owns day-to-day crew cost. Upserts one row per WP, preserving budget +
-- is_external. Mirrors set_wp_external.
create function public.set_wp_labor_budget(p_wp uuid, p_budget numeric)
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
    raise exception 'set_wp_labor_budget: role not permitted' using errcode = '42501';
  end if;
  if p_budget is null or p_budget < 0 then
    raise exception 'set_wp_labor_budget: labor budget must be non-negative' using errcode = 'P0001';
  end if;
  select true into v_exists from public.work_packages where id = p_wp;
  if not found then
    raise exception 'set_wp_labor_budget: work package not found' using errcode = 'P0001';
  end if;

  insert into public.wp_economics (work_package_id, labor_budget, updated_by, updated_at)
  values (p_wp, p_budget, auth.uid(), now())
  on conflict (work_package_id) do update
    set labor_budget = excluded.labor_budget, updated_by = excluded.updated_by,
        updated_at = excluded.updated_at;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('update', auth.uid(), public.current_user_role(), 'wp_economics', p_wp,
          jsonb_build_object('field', 'labor_budget', 'value', p_budget));
end;
$$;

revoke all on function public.set_wp_labor_budget(uuid, numeric) from public;
grant execute on function public.set_wp_labor_budget(uuid, numeric) to authenticated;
