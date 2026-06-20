-- Spec 161 U3 / ADR 0060 §2 — wp_labor_sell(p_wp): the novel core of the WP
-- profit engine. The §2 formula is
--   WP profit = budget − (equipment rental + DC labor @ SELL + materials);
-- this unit builds ONLY the SELL-priced DC-labor term — the number no existing
-- function produces. freeze_wp_labor_cost already sums DC labor at COST; this
-- sums the SAME current logs at the per-LEVEL sell rate (the markup the company
-- keeps). The full profit assembly + GL reconciliation (ADR 0057) is U3b;
-- settlement × multiplier is U4. This is a pure READ — nothing banked or posted.
--
-- MONEY posture: reads zero-grant money tables (sell_rate_table, wp_economics,
-- labor_logs) — fine, SECURITY DEFINER bypasses RLS. Invoked under the caller's
-- authenticated session (a real super/director JWT so current_user_role()
-- resolves), never the admin client — exactly like freeze_wp_labor_cost.
--
-- Gate: super_admin + project_director only (operator/exec economics). NO
-- project_manager reference → the ADR 0058 pgTAP 90/91 invariants don't apply.
-- The null-safe `is distinct from` form denies a NULL-role caller (the
-- rls-self-check-coalesce trap). A read → no audit row, no enum-add.

create function public.wp_labor_sell(p_wp uuid)
returns numeric
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_external boolean;
  v_sell     numeric;
begin
  -- Economics are super_admin/project_director-only (NULL role denied).
  if public.current_user_role() is distinct from 'super_admin'
     and public.current_user_role() is distinct from 'project_director' then
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
$$;

-- Reads money: anon must not even reach it. authenticated callers still hit the
-- internal super/director gate (the day-rate / freeze posture).
revoke all on function public.wp_labor_sell(uuid) from public;
grant execute on function public.wp_labor_sell(uuid) to authenticated;
