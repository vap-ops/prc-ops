-- Perf (RUM-aimed TTFB, spec 100 dashboard). Collapse the /dashboard money rollup — 10
-- admin reads spanning every WP of the live portfolio + a per-WP JS aggregation — into ONE
-- SECURITY DEFINER round-trip. Returns per-project external-spend sums + per-work-category
-- net atoms; the page keeps spendBreakdown / budgetStatus / spendByWorkCategory (the netting
-- + sort stay in JS). Cost basis = EXTERNAL SPEND (labor at cost, purchases at supplier
-- amount, store material at cost, WP→store returns netted) — deliberately NOT the
-- GL/transfer-price basis of wp_profit / gl_trial_balance.
--
-- MUST AGREE with src/lib/dashboard/spend.ts (sumMaterials / sumStoreIssues / sumStoreReturns
-- / sumStorePool / spendByWorkCategory atoms) and src/lib/labor/cost.ts (aggregateLaborCost:
-- Σ fraction×rate over CURRENT rows) — mirrors the freeze_wp_labor_cost labor SQL. The money
-- columns are numeric(12,2); this sums them exactly (the JS sums in float, so the two agree at
-- display precision after baht() rounding, which is the equivalence standard).

create or replace function public.dashboard_portfolio_spend(p_project_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_role public.user_role := public.current_user_role();
  v_result jsonb;
begin
  -- Money gate (defence in depth; the page already gates with MONEY_VIEW_ROLES = is_manager
  -- ∪ accounting). Fail CLOSED: an unauthorised / unauthenticated caller gets empty arrays.
  if v_role is null or not (public.is_manager(v_role) or v_role = 'accounting') then
    return jsonb_build_object('projects', '[]'::jsonb, 'categories', '[]'::jsonb);
  end if;

  with
  -- Non-group WPs of the requested projects (labor + WP-bound purchases scope), each carrying
  -- its global work-category for the by-หมวดงาน card (null when the WP has no resolved category).
  leaf_wps as (
    select w.id as wp_id, w.project_id, pc.work_category_id
    from public.work_packages w
    left join public.project_categories pc on pc.id = w.category_id
    where w.is_group = false and w.project_id = any(p_project_ids)
  ),
  -- Reversed issues never charged a WP (a reversal may target a receipt → issue_id null; drop
  -- those). GLOBAL, matching the page's stock_reversals read.
  reversed as (
    select issue_id from public.stock_reversals where issue_id is not null
  ),
  -- PR ids whose goods entered the store (counted at เบิก, excluded from the purchase sum).
  stored_prs as (
    select purchase_request_id
    from public.stock_receipts
    where project_id = any(p_project_ids) and purchase_request_id is not null
  ),
  -- Per-WP labor cost: Σ (day_fraction full→1 / half→0.5) × day_rate_snapshot over CURRENT rows
  -- (supersede anti-join + tombstone). Mirrors aggregateLaborCost().total / freeze_wp_labor_cost.
  labor_atom as (
    select lw.project_id, lw.work_category_id,
           sum((case ll.day_fraction when 'full' then 1.0 else 0.5 end) * ll.day_rate_snapshot) as amt
    from public.labor_logs ll
    join leaf_wps lw on lw.wp_id = ll.work_package_id
    where ll.day_fraction is not null
      and not exists (select 1 from public.labor_logs newer where newer.superseded_by = ll.id)
    group by lw.project_id, lw.work_category_id
  ),
  -- WP-bound material purchases: Σ amount over spend-status PRs that recorded a price,
  -- store-routed PRs excluded (their cost lands at เบิก). Mirrors sumMaterials.
  materials_atom as (
    select lw.project_id, lw.work_category_id, sum(pr.amount) as amt
    from public.purchase_requests pr
    join leaf_wps lw on lw.wp_id = pr.work_package_id
    where pr.status in ('purchased', 'on_route', 'delivered', 'site_purchased')
      and pr.amount is not null
      and pr.id not in (select purchase_request_id from stored_prs)
    group by lw.project_id, lw.work_category_id
  ),
  -- เบิก (store issues), project-scoped, reversed excluded. The WP tag (for the card) may point
  -- at a non-leaf / foreign WP → null work-category bucket (matches the page's wpWorkCat).
  issues_atom as (
    select si.project_id, lw.work_category_id, sum(si.total_cost) as amt
    from public.stock_issues si
    left join leaf_wps lw on lw.wp_id = si.work_package_id
    where si.project_id = any(p_project_ids)
      and si.id not in (select issue_id from reversed)
    group by si.project_id, lw.work_category_id
  ),
  -- WP→store returns, project-scoped — a NEGATIVE atom netted out of the WP level (spec 209).
  returns_atom as (
    select sr.project_id, lw.work_category_id, sum(sr.total_cost) as amt
    from public.stock_returns sr
    left join leaf_wps lw on lw.wp_id = sr.work_package_id
    where sr.project_id = any(p_project_ids)
    group by sr.project_id, lw.work_category_id
  ),
  -- Project store pool (stock on hand at cost) → the unset (null) work-category bucket.
  pool_by_project as (
    select project_id, sum(total_value) as amt
    from public.stock_on_hand
    where project_id = any(p_project_ids)
    group by project_id
  ),
  budget_by_project as (
    select id as project_id, budget_amount_thb
    from public.projects
    where id = any(p_project_ids)
  ),
  -- One row per requested project (even with zero spend — the card still renders).
  proj as (
    select
      b.project_id,
      b.budget_amount_thb as budget,
      coalesce((select sum(amt) from labor_atom la where la.project_id = b.project_id), 0) as labor,
      coalesce((select sum(amt) from materials_atom ma where ma.project_id = b.project_id), 0) as materials_purchase,
      coalesce((select sum(amt) from issues_atom ia where ia.project_id = b.project_id), 0) as store_issues,
      coalesce((select sum(amt) from returns_atom ra where ra.project_id = b.project_id), 0) as store_returns,
      coalesce((select amt from pool_by_project pp where pp.project_id = b.project_id), 0) as store_pool
    from budget_by_project b
  ),
  -- Per-work-category net atoms: labor + materials + issues, minus returns; pool → null bucket.
  -- (spendByWorkCategory re-folds by key + drops zero + sorts + resolves names in JS.)
  cat_raw as (
    select work_category_id, amt from labor_atom
    union all
    select work_category_id, amt from materials_atom
    union all
    select work_category_id, amt from issues_atom
    union all
    select work_category_id, -amt as amt from returns_atom
    union all
    select null::uuid as work_category_id, amt from pool_by_project
  ),
  cat as (
    select cr.work_category_id, sum(cr.amt) as amount
    from cat_raw cr
    group by cr.work_category_id
  )
  select jsonb_build_object(
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'project_id', project_id,
        'budget', budget,
        'labor', labor,
        'materials_purchase', materials_purchase,
        'store_issues', store_issues,
        'store_returns', store_returns,
        'store_pool', store_pool
      )) from proj
    ), '[]'::jsonb),
    'categories', coalesce((
      select jsonb_agg(jsonb_build_object(
        'work_category_id', c.work_category_id,
        'name', wc.name_th,
        'amount', c.amount
      )) from cat c
      left join public.work_categories wc on wc.id = c.work_category_id
    ), '[]'::jsonb)
  )
  into v_result;

  return v_result;
end;
$function$;

-- DEFINER money reader: lock to authenticated (the null-safe role gate denies everyone else
-- anyway; explicit revoke from anon AND public per the spec-284 hygiene lesson).
revoke all on function public.dashboard_portfolio_spend(uuid[]) from public, anon;
grant execute on function public.dashboard_portfolio_spend(uuid[]) to authenticated;
