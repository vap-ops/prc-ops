-- Spec 161 U3b / ADR 0060 §2 + ADR 0057 — wp_profit(p_wp): the WP profit READ.
-- Assembles profit = budget − labor_sell − materials − equipment, exposing every
-- term so the figure is auditable. MATERIALS cost is DERIVED FROM THE GL
-- (journal_lines) per ADR 0057 — not a re-sum of purchase_requests (no second
-- costing path). Still a pure read: nothing banked (banking-at-completion later),
-- nothing minted (settlement × multiplier = U4, blocked on utilization data).
--
-- EQUIPMENT is a known gap (operator-confirmed 2026-06-20): post_rental_batch_to_gl
-- posts a batch to WIP (1400) at batch grain with NO work_package_id, so equipment
-- cost is not WP-dimensioned in the GL. Splitting a batch across a project's WPs
-- needs a business rule (a follow-up spec touching the equipment poster / ADR 0055).
-- U3b does NOT improvise it — equipment_cost = 0 with equipment_costed = false so
-- the omission is loud, never silently folded into the profit number. (U4 minting is
-- blocked anyway, so no payout rides on the partial figure.)
--
-- MONEY posture: reads zero-grant tables (wp_economics, journal_lines/entries) via
-- the definer. Gate super_admin + project_director only — NO project_manager
-- reference (ADR 0058 pgTAP 90/91 untouched); null-safe `is distinct from` denies a
-- NULL-role caller (rls-self-check-coalesce). Invoked under the caller's authed
-- session like wp_labor_sell / freeze. A read → no audit row, no enum-add.

create function public.wp_profit(p_wp uuid)
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
  v_equipment numeric := 0;       -- equipment rental is not WP-dimensioned in the
  v_eq_costed boolean := false;   -- GL yet (batch grain) — flagged, follow-up spec.
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

  -- Materials cost DERIVED FROM THE GL (ADR 0057): Σ(debit − credit) on the
  -- WIP-construction account (1400) for this WP, restricted to PURCHASE-sourced
  -- entries. Reversal-safe: a reversal carries source_table 'journal_reversal' but
  -- copies work_package_id and swaps debit/credit, so attributing it through
  -- reversal_of to the original's source nets an auto-corrected purchase
  -- (post_purchase_to_gl reverse-and-repost). Labor also debits 1400 but is
  -- excluded (source wp_labor_costs); VAT (1300) and equipment (no WP dim) are
  -- naturally excluded. This reads the ledger — NOT a re-sum of purchase_requests.
  select coalesce(sum(l.debit - l.credit), 0)
    into v_materials
    from public.journal_lines l
    join public.journal_entries e on e.id = l.entry_id
    join public.gl_accounts a on a.id = l.account_id
    left join public.journal_entries orig on orig.id = e.reversal_of
   where l.work_package_id = p_wp
     and a.code = '1400'
     and coalesce(orig.source_table, e.source_table) = 'purchase_requests';

  return query select
    v_budget,
    v_labor,
    v_materials,
    v_equipment,
    v_eq_costed,
    (v_budget - v_labor - v_materials - v_equipment);  -- NULL if budget is NULL
end;
$$;

-- Reads money: anon must not reach it; authenticated callers still hit the
-- internal super/director gate (the wp_labor_sell / freeze posture).
revoke all on function public.wp_profit(uuid) from public;
grant execute on function public.wp_profit(uuid) to authenticated;
