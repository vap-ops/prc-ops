-- Spec 146 U3 / ADR 0060 §2 — wp_equipment_sell(p_wp): the live per-WP equipment
-- charge. The §2 formula's "equipment rental" term — what the WP profit center pays
-- for equipment, symmetric with wp_labor_sell (DC labor @ SELL). The GL holds
-- equipment at the BATCH cost (batch grain, intercompany AP, no WP dim); this is the
-- per-item CHARGE-OUT (transfer price) the GL does not hold, so it is computed LIVE
-- from the usage logs — NOT a second costing path (exactly the wp_labor_sell vs
-- GL-labor-COST relationship). PRC keeps the margin (charges − batch cost; Case A).
--
-- Charge = Σ over CURRENT (non-superseded) usage rows for the WP of
--   billable_days × daily_rate_snapshot,
-- billable_days = whole days on site, inclusive (same-day = 1); an OPEN checkout
-- accrues to current_date. No internal/external branch (equipment has one charge-out
-- rate per item, unlike level-graded labor).
--
-- MONEY posture: reads the zero-grant daily_rate_snapshot via the definer. Gate
-- super_admin + project_director only — NO project_manager reference (ADR 0058 pgTAP
-- 90/91 untouched); null-safe `is distinct from` denies a NULL-role caller
-- (rls-self-check-coalesce). Invoked under the caller's authed session like
-- wp_labor_sell / freeze. A read → no audit, no enum-add.

create function public.wp_equipment_sell(p_wp uuid)
returns numeric
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_charge numeric;
begin
  if public.current_user_role() is distinct from 'super_admin'
     and public.current_user_role() is distinct from 'project_director' then
    raise exception 'wp_equipment_sell: role not permitted' using errcode = '42501';
  end if;

  if not exists (select 1 from public.work_packages where id = p_wp) then
    raise exception 'wp_equipment_sell: work package not found' using errcode = 'P0001';
  end if;

  -- Σ over CURRENT (non-superseded) usage rows. An open checkout (checked_in_on
  -- NULL) accrues to current_date. greatest(...,0) guards a future-dated open row.
  select coalesce(sum(
    greatest((coalesce(ul.checked_in_on, current_date) - ul.checked_out_on) + 1, 0)
    * ul.daily_rate_snapshot
  ), 0)
  into v_charge
  from public.equipment_usage_logs ul
  where ul.work_package_id = p_wp
    and not exists (select 1 from public.equipment_usage_logs n where n.superseded_by = ul.id);

  return v_charge;
end;
$$;

-- Reads money: anon must not reach it; authenticated callers still hit the internal
-- super/director gate (the wp_labor_sell / freeze posture).
revoke all on function public.wp_equipment_sell(uuid) from public;
grant execute on function public.wp_equipment_sell(uuid) to authenticated;
