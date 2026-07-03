-- Spec 252 U1 — widen the wp_profit() gate: super_admin/project_director-only
-- → is_manager() ∨ accounting. Operator decision (2026-07-03): the accounting
-- role gets FULL READ of cost surfaces; the spec-253 finance drill is a
-- PM ∪ accounting surface, and the old gate would have refused project_manager
-- too, so the manager wrapper (null-safe, fail-closed — 20260813051000) is the
-- right predicate. READ-only widening: wp_profit computes, mutates nothing.
--
-- Body sourced VERBATIM from LIVE via pg_get_functiondef (2026-07-03, after
-- migration 063500) — ONLY the gate lines changed (db-migration house lesson:
-- never re-source a definer body from a migration file).
-- CREATE OR REPLACE — signature unchanged, existing grants preserved.

CREATE OR REPLACE FUNCTION public.wp_profit(p_wp uuid)
 RETURNS TABLE(budget numeric, labor_sell numeric, materials_cost numeric, equipment_cost numeric, equipment_costed boolean, profit numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_budget    numeric;
  v_labor     numeric;
  v_materials numeric;
  v_store     numeric;
  v_equipment numeric;
begin
  if not public.is_manager(public.current_user_role())
     and public.current_user_role() is distinct from 'accounting' then
    raise exception 'wp_profit: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.work_packages where id = p_wp) then
    raise exception 'wp_profit: work package not found' using errcode = 'P0001';
  end if;

  select we.budget into v_budget
    from public.wp_economics we where we.work_package_id = p_wp;

  v_labor := public.wp_labor_sell(p_wp);

  select coalesce(sum(l.debit - l.credit), 0)
    into v_materials
    from public.journal_lines l
    join public.journal_entries e on e.id = l.entry_id
    join public.gl_accounts a on a.id = l.account_id
    left join public.journal_entries orig on orig.id = e.reversal_of
   where l.work_package_id = p_wp
     and a.code = '1400'
     and coalesce(orig.source_table, e.source_table) = 'purchase_requests';

  -- Store transfer price (spec 178 U4) NET of WP→store returns (spec 209 U1): each
  -- non-reversed issue's sell, minus the returned qty valued at that issue's
  -- sell-per-unit. A fully-returned issue nets to 0; partial returns reduce pro-rata.
  select coalesce(sum(
           coalesce(si.total_sell, si.total_cost)
           - coalesce((select sum(rt.qty) from public.stock_returns rt where rt.issue_id = si.id), 0)
             * coalesce(si.total_sell, si.total_cost) / nullif(si.qty, 0)
         ), 0)
    into v_store
    from public.stock_issues si
   where si.work_package_id = p_wp
     and not exists (
       select 1 from public.stock_reversals r where r.issue_id = si.id);
  v_materials := v_materials + v_store;

  v_equipment := public.wp_equipment_sell(p_wp);

  return query select
    v_budget,
    v_labor,
    v_materials,
    v_equipment,
    true,
    (v_budget - v_labor - v_materials - v_equipment);
end;
$function$;
