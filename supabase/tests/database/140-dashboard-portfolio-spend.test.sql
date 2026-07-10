begin;
select plan(11);

-- ============================================================================
-- Perf U3 — dashboard_portfolio_spend(uuid[]): the /dashboard money rollup as ONE
-- SECURITY DEFINER round-trip. Returns per-project external-spend sums + per-work-
-- category net atoms; the page keeps spendBreakdown/budgetStatus/spendByWorkCategory.
--
-- This test proves: the function exists + is DEFINER + fails closed for the wrong
-- role, and its portfolio aggregates equal an INDEPENDENT reference SQL over the LIVE
-- ledger (self-consistency — the JS-equivalence proof is the before/after browser
-- check). Cost cols (day_rate_snapshot/amount/total_cost/total_value) are zero-grant to
-- authenticated, so the reference sums are computed in the privileged setup role and
-- stashed; the RPC (DEFINER) reads them for real.
-- ============================================================================

-- Two role-scoped callers.
insert into auth.users (id, email, raw_user_meta_data) values
  ('da500000-0000-0000-0000-000000000001', 'super@dash.local', '{}'::jsonb),
  ('da500000-0000-0000-0000-000000000002', 'sa@dash.local',    '{}'::jsonb),
  ('da500000-0000-0000-0000-000000000003', 'acct@dash.local',  '{}'::jsonb);
update public.users set role='super_admin' where id='da500000-0000-0000-0000-000000000001';
update public.users set role='site_admin'  where id='da500000-0000-0000-0000-000000000002';
update public.users set role='accounting'  where id='da500000-0000-0000-0000-000000000003';

-- The live portfolio (what the dashboard reads) + the reference aggregates over it,
-- computed here (privileged) with the SAME rules the RPC must implement.
create temp table _live as
  select id from public.projects where status in ('active', 'on_hold');

create temp table _exp as
  select
    coalesce((
      select sum((case ll.day_fraction when 'full' then 1.0 else 0.5 end) * ll.day_rate_snapshot)
      from public.labor_logs ll
      join public.work_packages w on w.id = ll.work_package_id
      where w.is_group = false and w.project_id in (select id from _live)
        and ll.day_fraction is not null
        and not exists (select 1 from public.labor_logs n where n.superseded_by = ll.id)
    ), 0) as labor,
    coalesce((
      select sum(pr.amount)
      from public.purchase_requests pr
      join public.work_packages w on w.id = pr.work_package_id
      where w.is_group = false and w.project_id in (select id from _live)
        and pr.status in ('purchased', 'on_route', 'delivered', 'site_purchased')
        and pr.amount is not null
        and pr.id not in (
          select purchase_request_id from public.stock_receipts
          where project_id in (select id from _live) and purchase_request_id is not null
        )
    ), 0) as materials,
    coalesce((
      select sum(si.total_cost)
      from public.stock_issues si
      where si.project_id in (select id from _live)
        and si.id not in (select issue_id from public.stock_reversals where issue_id is not null)
    ), 0) as issues,
    coalesce((
      select sum(sr.total_cost) from public.stock_returns sr
      where sr.project_id in (select id from _live)
    ), 0) as returns,
    coalesce((
      select sum(soh.total_value) from public.stock_on_hand soh
      where soh.project_id in (select id from _live)
    ), 0) as pool;

-- ---- A. Catalog -----------------------------------------------------------
select has_function(
  'public', 'dashboard_portfolio_spend', ARRAY['uuid[]'],
  'dashboard_portfolio_spend(uuid[]) exists');
select is(
  (select prosecdef from pg_proc where oid = 'public.dashboard_portfolio_spend(uuid[])'::regprocedure),
  true, 'dashboard_portfolio_spend is SECURITY DEFINER');

-- The gate is JWT-based (current_user_role() via auth.uid), and the RPC is DEFINER, so the
-- caller's DB role is irrelevant — set request.jwt.claims only (no set role authenticated,
-- which would also block the privileged temp-table reads below).

-- ---- B. Gate (fail closed) ------------------------------------------------
set local "request.jwt.claims" = '{"sub": "da500000-0000-0000-0000-000000000002"}';
select is(
  public.dashboard_portfolio_spend(array(select id from _live)),
  jsonb_build_object('projects', '[]'::jsonb, 'categories', '[]'::jsonb),
  'site_admin (not a money role) → empty arrays');

-- ---- C. Populated: portfolio aggregates == reference SQL -------------------
set local "request.jwt.claims" = '{"sub": "da500000-0000-0000-0000-000000000001"}';

select ok(
  public.dashboard_portfolio_spend(array(select id from _live)) ? 'projects'
    and public.dashboard_portfolio_spend(array(select id from _live)) ? 'categories',
  'super_admin call returns projects + categories');

select is(
  (select coalesce(sum((e->>'labor')::numeric), 0)
   from jsonb_array_elements(public.dashboard_portfolio_spend(array(select id from _live))->'projects') e),
  (select labor from _exp),
  'Σ RPC labor == reference over the live portfolio');
select is(
  (select coalesce(sum((e->>'materials_purchase')::numeric), 0)
   from jsonb_array_elements(public.dashboard_portfolio_spend(array(select id from _live))->'projects') e),
  (select materials from _exp),
  'Σ RPC materials_purchase == reference');
select is(
  (select coalesce(sum((e->>'store_issues')::numeric), 0)
   from jsonb_array_elements(public.dashboard_portfolio_spend(array(select id from _live))->'projects') e),
  (select issues from _exp),
  'Σ RPC store_issues == reference (reversed excluded)');
select is(
  (select coalesce(sum((e->>'store_returns')::numeric), 0)
   from jsonb_array_elements(public.dashboard_portfolio_spend(array(select id from _live))->'projects') e),
  (select returns from _exp),
  'Σ RPC store_returns == reference');
select is(
  (select coalesce(sum((e->>'store_pool')::numeric), 0)
   from jsonb_array_elements(public.dashboard_portfolio_spend(array(select id from _live))->'projects') e),
  (select pool from _exp),
  'Σ RPC store_pool == reference');

-- ---- D. The other gate arms: accounting (the ∨ accounting arm) allows; null denies ----
set local "request.jwt.claims" = '{"sub": "da500000-0000-0000-0000-000000000003"}';
select isnt(
  public.dashboard_portfolio_spend(array(select id from _live)),
  jsonb_build_object('projects', '[]'::jsonb, 'categories', '[]'::jsonb),
  'accounting (a money role) → populated, not empty');
set local "request.jwt.claims" = '';
select is(
  public.dashboard_portfolio_spend(array(select id from _live)),
  jsonb_build_object('projects', '[]'::jsonb, 'categories', '[]'::jsonb),
  'null / anon caller → empty (fail-closed null branch)');

select * from finish();
rollback;
