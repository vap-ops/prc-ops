-- Spec 178 U4 — flip wp_profit: fold the store-issue SELL into the materials line.
--
-- The keystone of the margin layer. Until now wp_profit's materials_cost came only
-- from the GL (acct 1400, purchase_requests-sourced) — direct-to-WP buys. Store
-- issues (เบิก) charge the WP the store's transfer SELL price, and they are NOT in
-- the GL, so the two sources are disjoint: ADD the per-WP Σ of non-reversed
-- stock_issues' sell (coalesce(total_sell, total_cost) — unpriced sells at cost)
-- to v_materials. No double-count; a WP now pays the sell price for store stock AND
-- the purchase price for direct buys. Reversed issues (a stock_reversals row on the
-- issue) never charged the WP → excluded.
--
-- SAME return signature → CREATE OR REPLACE (body only): grants + the pgTAP 102
-- structure pins + the 90/91 gate invariants (no PM ref) all hold; settle_project
-- banks the new profit automatically (it reads wp_profit.profit). Body sourced from
-- the LIVE function (pg_get_functiondef) + the store-sell term.

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
  v_store     numeric;
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

  -- Store transfer price (spec 178 U4): Σ of non-reversed stock_issues drawn to
  -- this WP, valued at the SELL snapshot (unpriced/legacy → cost). Disjoint from the
  -- GL sum above (store issues are not posted to the GL) → additive, no double-count.
  select coalesce(sum(coalesce(si.total_sell, si.total_cost)), 0)
    into v_store
    from public.stock_issues si
   where si.work_package_id = p_wp
     and not exists (
       select 1 from public.stock_reversals r where r.issue_id = si.id);
  v_materials := v_materials + v_store;

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

comment on function public.wp_profit(uuid) is
  'Spec 161 U3b + 146 U3 + 178 U4 — WP P&L: budget − labor_sell − materials_cost − equipment_cost. materials_cost = GL acct-1400 purchase cost PLUS the store transfer-price (Σ non-reversed stock_issues at sell). Gate super_admin/project_director.';
