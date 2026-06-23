-- Spec 178 U3 — Store P&L read (the margin-layer observability).
--
-- The store is a transfer-pricing BU; this is its profit-and-loss, per item, per
-- project: what was issued (qty), at what cost, at what sell (transfer price), the
-- margin, and the shrinkage (count variance valued at cost). Store P&L =
-- Σ(sell − cost) − shrinkage. Reversed issues are excluded (anti-join
-- stock_reversals on issue_id — a reversed เบิก never charged the WP).
--
-- Money gate: super_admin / project_director (mirrors wp_profit — operator/exec
-- economics; NOT procurement, NOT site_admin/PM). SECURITY DEFINER so it reads the
-- store tables regardless of the caller's grant; called on the user session so the
-- role gate resolves (the admin client has no JWT → 42501).

create function public.store_pnl(p_project_id uuid)
returns table (
  catalog_item_id uuid,
  qty_issued      numeric,
  cost_total      numeric,
  sell_total      numeric,
  margin          numeric,
  shrinkage_value numeric
)
language plpgsql
security definer
stable
set search_path = public
as $$
begin
  if public.current_user_role() is distinct from 'super_admin'
     and public.current_user_role() is distinct from 'project_director' then
    raise exception 'store_pnl: role not permitted' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects where id = p_project_id) then
    raise exception 'store_pnl: project not found' using errcode = '22023';
  end if;

  return query
  with issues as (
    select si.catalog_item_id                                   as item,
           sum(si.qty)                                          as qty_issued,
           sum(si.total_cost)                                   as cost_total,
           -- Unpriced / legacy (null sell_price → null total_sell) sells at cost.
           sum(coalesce(si.total_sell, si.total_cost))          as sell_total
      from public.stock_issues si
     where si.project_id = p_project_id
       and not exists (
         select 1 from public.stock_reversals r where r.issue_id = si.id)
     group by si.catalog_item_id
  ),
  counts as (
    select sc.catalog_item_id          as item,
           sum(sc.variance_value)      as shrinkage_value
      from public.stock_counts sc
     where sc.project_id = p_project_id
     group by sc.catalog_item_id
  )
  select
    coalesce(i.item, c.item),
    coalesce(i.qty_issued, 0),
    coalesce(i.cost_total, 0),
    coalesce(i.sell_total, 0),
    coalesce(i.sell_total, 0) - coalesce(i.cost_total, 0),
    coalesce(c.shrinkage_value, 0)
  from issues i
  full outer join counts c on c.item = i.item;
end;
$$;

revoke all on function public.store_pnl(uuid) from public, anon;
grant execute on function public.store_pnl(uuid) to authenticated, service_role;

comment on function public.store_pnl(uuid) is
  'Spec 178 U3 — per-item Store P&L for a project: qty_issued, cost_total, sell_total (unpriced sells at cost), margin, shrinkage_value (Σ count variance). Reversed issues excluded. Money gate super_admin/project_director; SECURITY DEFINER, call on the user session.';
