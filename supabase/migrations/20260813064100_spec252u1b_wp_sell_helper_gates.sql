-- Spec 252 U1b — wp_profit's nested helpers carry their OWN super/PD-only
-- gates (wp_labor_sell, wp_equipment_sell), so 064000's widening alone still
-- refused accounting/PM one call deeper (caught by pgTAP 255 on first run).
-- Same widening: is_manager() ∨ accounting — read-only computations, no writes.
--
-- Bodies sourced VERBATIM from LIVE via pg_get_functiondef (2026-07-03, after
-- 064000) — ONLY the gate lines changed. Own migration because 064000 was
-- already APPLIED (editing an applied migration silently no-ops — house lesson).
-- CREATE OR REPLACE — signatures unchanged, grants preserved.

CREATE OR REPLACE FUNCTION public.wp_labor_sell(p_wp uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_external boolean;
  v_sell     numeric;
begin
  -- Economics read: manager set ∨ accounting (spec 252; NULL role denied).
  if not public.is_manager(public.current_user_role())
     and public.current_user_role() is distinct from 'accounting' then
    raise exception 'wp_labor_sell: role not permitted' using errcode = '42501';
  end if;

  -- SECURITY DEFINER bypasses RLS — probe existence so a typo'd WP errors
  -- rather than returning a misleading 0.
  if not exists (select 1 from public.work_packages where id = p_wp) then
    raise exception 'wp_labor_sell: work package not found' using errcode = 'P0001';
  end if;

  -- Internal unless the WP is explicitly external (no row = internal, U2).
  v_external := coalesce(
    (select is_external from public.wp_economics where work_package_id = p_wp), false);

  -- Σ over CURRENT (non-superseded, non-tombstone) DC labor logs, valued at the
  -- worker's per-level sell rate. The inner join to sell_rate_table drops a DC
  -- with a NULL level (no rate row) → an ungraded DC contributes 0 and can never
  -- silently inflate profit. own-type labor is payroll overhead, not transfer-
  -- priced into the WP profit center (ADR §2 prices DC labor) → excluded by the
  -- worker_type_snapshot filter. Level is the live grade (labor_logs carries no
  -- level snapshot; a level-at-time snapshot is a later refinement). The anti-
  -- join + tombstone filter mirror freeze_wp_labor_cost exactly (ADR 0009).
  select coalesce(sum(
    (case ll.day_fraction when 'full' then 1.0 else 0.5 end)
    * (case when v_external then srt.external_sell else srt.internal_sell end)
  ), 0)
  into v_sell
  from public.labor_logs ll
  join public.workers w on w.id = ll.worker_id
  join public.sell_rate_table srt on srt.level = w.level
  where ll.work_package_id = p_wp
    and ll.worker_type_snapshot = 'dc'
    and ll.day_fraction is not null
    and not exists (select 1 from public.labor_logs newer where newer.superseded_by = ll.id);

  return v_sell;
end;
$function$;

CREATE OR REPLACE FUNCTION public.wp_equipment_sell(p_wp uuid)
 RETURNS numeric
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_charge numeric;
begin
  if not public.is_manager(public.current_user_role())
     and public.current_user_role() is distinct from 'accounting' then
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
$function$;
