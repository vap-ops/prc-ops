-- Spec 146 U3 / ADR 0060 §2 + ADR 0057 — wp_profit REPLACE: fold the equipment
-- charge in. U3b shipped wp_profit with equipment_cost = 0 / equipment_costed =
-- false (a loud flag) because equipment was not WP-dimensioned. Spec 146 U3 adds
-- wp_equipment_sell(p_wp) — the live per-WP charge-out — so equipment_cost is now
-- real and equipment_costed = true. Same return signature (CREATE OR REPLACE keeps
-- the grants); only the two equipment lines + the comment change.
--
-- The three cost terms keep their established sources, each auditable:
--   labor_sell   = wp_labor_sell    (live, transfer price — DC labor @ SELL)
--   materials    = GL journal_lines (actual cost, reversal-safe, ADR 0057)
--   equipment    = wp_equipment_sell (live, transfer price — the §2 "equipment
--                  rental" term; the GL holds only the batch COST at batch grain).
-- Gate super_admin + project_director (no PM ref → 90/91 untouched), null-safe.

create or replace function public.wp_profit(p_wp uuid)
returns table (
  budget           numeric,
  labor_sell       numeric,
  materials_cost   numeric,
  equipment_cost   numeric,
  equipment_costed boolean,
  profit           numeric
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_budget    numeric;
  v_labor     numeric;
  v_materials numeric;
  v_equipment numeric;
begin
  if public.current_user_role() is distinct from 'super_admin'
     and public.current_user_role() is distinct from 'project_director' then
    raise exception 'wp_profit: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.work_packages where id = p_wp) then
    raise exception 'wp_profit: work package not found' using errcode = 'P0001';
  end if;

  -- Budget — the profit denominator (NULL until the PD sets it → profit NULL).
  select we.budget into v_budget
    from public.wp_economics we where we.work_package_id = p_wp;

  -- DC labor @ SELL — reuse the U3 SSOT (definer-to-definer: the caller's role
  -- still resolves so its identical super/director gate passes).
  v_labor := public.wp_labor_sell(p_wp);

  -- Materials cost DERIVED FROM THE GL (ADR 0057): Σ(debit − credit) on the WIP
  -- account (1400) for this WP, restricted to PURCHASE-sourced entries, reversal-
  -- safe via reversal_of → the original's source. Labor also debits 1400 but is
  -- excluded (source wp_labor_costs); VAT (1300) and equipment (no WP dim) excluded.
  select coalesce(sum(l.debit - l.credit), 0)
    into v_materials
    from public.journal_lines l
    join public.journal_entries e on e.id = l.entry_id
    join public.gl_accounts a on a.id = l.account_id
    left join public.journal_entries orig on orig.id = e.reversal_of
   where l.work_package_id = p_wp
     and a.code = '1400'
     and coalesce(orig.source_table, e.source_table) = 'purchase_requests';

  -- Equipment rental @ CHARGE-OUT — the live per-WP charge from the check-out /
  -- check-in usage logs (spec 146 U3; transfer price, like labor @ SELL).
  v_equipment := public.wp_equipment_sell(p_wp);

  return query select
    v_budget,
    v_labor,
    v_materials,
    v_equipment,
    true,                                              -- equipment_costed: gap closed
    (v_budget - v_labor - v_materials - v_equipment);  -- NULL if budget is NULL
end;
$$;

revoke all on function public.wp_profit(uuid) from public;
grant execute on function public.wp_profit(uuid) to authenticated;
