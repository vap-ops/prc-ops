-- Spec 68 P2 — wp_labor_costs: the frozen labor-cost snapshot per work
-- package, plus freeze_wp_labor_cost(p_wp) that computes and stores it.
--
-- MONEY POSTURE: own_cost/dc_cost have NO authenticated grant — read only
-- via the service-role admin client behind requireRole(pm/super), exactly
-- like workers.day_rate and labor_logs.day_rate_snapshot. Field sessions
-- can never see a cost (spec 46 principle: no money on any site_admin-
-- reachable screen).
--
-- DELIBERATELY MUTABLE (not append-only): one row per WP, UPSERT on
-- re-freeze. The audit_log carries the change history (old/new cost in
-- the payload), so the snapshot itself need not be immutable. Spec 46 C6:
-- a labor correction after close does NOT silently recompute the snapshot
-- — a pm/super re-freezes explicitly, and every freeze is audited.

create table public.wp_labor_costs (
  work_package_id uuid primary key references public.work_packages(id),
  own_cost        numeric(12,2) not null,
  dc_cost         numeric(12,2) not null,
  computed_at     timestamptz   not null default now(),
  frozen_by       uuid          not null references public.users(id)
);

alter table public.wp_labor_costs enable row level security;
-- Zero grant: money. Written only by the SECURITY DEFINER RPC below; read
-- only via the admin client. With no authenticated grant there is no
-- policy to write (every table still has RLS enabled per the project rule).
revoke all on public.wp_labor_costs from anon, authenticated;

-- ----------------------------------------------------------------------------
-- freeze_wp_labor_cost: recompute own/dc cost from the WP's CURRENT labor
-- logs and snapshot it. Mirrors set_worker_day_rate's role gate + audit
-- write. Invoked under the caller's authenticated session (auth.uid() and
-- current_user_role() must resolve), never the service-role admin client —
-- service-role has no JWT, so current_user_role() would be NULL and the
-- gate would refuse it. See spec 68 "Invocation".
-- ----------------------------------------------------------------------------

create function public.freeze_wp_labor_cost(p_wp uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_own     numeric(12,2);
  v_dc      numeric(12,2);
  v_old_own numeric(12,2);
  v_old_dc  numeric(12,2);
begin
  -- Rate is money: pm/super only (site_admin refused, like set_worker_day_rate).
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'freeze_wp_labor_cost: role not permitted' using errcode = '42501';
  end if;

  -- SECURITY DEFINER bypasses RLS — probe existence explicitly (v1 access
  -- is role-level per ADR 0013, so existence is the only guard available).
  perform 1 from public.work_packages where id = p_wp;
  if not found then
    raise exception 'freeze_wp_labor_cost: work package not found' using errcode = 'P0001';
  end if;

  -- Σ over CURRENT (non-superseded, non-tombstone) labor logs. This MUST
  -- match src/lib/labor/cost.ts aggregateLaborCost (own/dc subtotals shown
  -- in the PM cost view are computed the same way live).
  select
    coalesce(sum(case when ll.worker_type_snapshot = 'own'
      then (case ll.day_fraction when 'full' then 1.0 else 0.5 end) * ll.day_rate_snapshot
      else 0 end), 0),
    coalesce(sum(case when ll.worker_type_snapshot = 'dc'
      then (case ll.day_fraction when 'full' then 1.0 else 0.5 end) * ll.day_rate_snapshot
      else 0 end), 0)
  into v_own, v_dc
  from public.labor_logs ll
  where ll.work_package_id = p_wp
    and ll.day_fraction is not null
    and not exists (select 1 from public.labor_logs newer where newer.superseded_by = ll.id);

  -- Prior snapshot (NULL on first freeze) for the audit payload.
  select own_cost, dc_cost into v_old_own, v_old_dc
    from public.wp_labor_costs where work_package_id = p_wp;

  insert into public.wp_labor_costs (work_package_id, own_cost, dc_cost, computed_at, frozen_by)
  values (p_wp, v_own, v_dc, now(), auth.uid())
  on conflict (work_package_id) do update
    set own_cost    = excluded.own_cost,
        dc_cost     = excluded.dc_cost,
        computed_at = excluded.computed_at,
        frozen_by   = excluded.frozen_by;

  insert into public.audit_log (action, actor_id, actor_role, target_table,
                                target_id, payload)
  values ('labor_cost_freeze', auth.uid(), public.current_user_role(),
          'wp_labor_costs', p_wp,
          jsonb_build_object('own_cost', v_own, 'dc_cost', v_dc,
                             'old_own_cost', v_old_own, 'old_dc_cost', v_old_dc));
end;
$$;

-- This function WRITES money. Tighten beyond the P1 labor RPCs (which keep
-- PUBLIC execute and rely solely on the internal gate): anon must not even
-- reach it. authenticated callers still hit the internal pm/super gate.
revoke all on function public.freeze_wp_labor_cost(uuid) from public;
grant execute on function public.freeze_wp_labor_cost(uuid) to authenticated;
