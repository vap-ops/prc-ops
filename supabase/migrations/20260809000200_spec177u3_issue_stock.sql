-- Spec 177 U3 — เบิก/Issue (the first OUT flow), at weighted-average cost.
--
-- A work package draws stock from its project's on-site store. The store issues
-- the material OUT at the moving-AVERAGE cost (total_value / qty_on_hand at issue
-- time) — the COST basis. The sell-to-WP margin layer (issuing at a per-item SELL
-- price, flipping wp_profit to at-issue-sell-price) is a LATER phase; cost-first
-- staging is a locked dial, so this unit moves cost only.
--
-- Gate: SITE_STAFF_ROLES (site_admin draws at the WP, plus the PM tier) — NOT
-- procurement, which does รับเข้า (IN), not เบิก (OUT). Issue is TO a work package
-- and materials are a one-way consume (no return; equipment round-trip is later).
-- stock_issues is append-only (CLAUDE.md); a wrong issue is corrected by a later
-- reversal unit. on_hand is decremented in the same definer RPC, under a row lock.

-- ----------------------------------------------------------------------------
-- stock_issues — append-only เบิก events (item drawn TO a WP, at avg cost).
-- ----------------------------------------------------------------------------
create table public.stock_issues (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  catalog_item_id uuid not null references public.catalog_items(id),
  -- The work package the stock was drawn for (one-way consume).
  work_package_id uuid not null references public.work_packages(id) on delete cascade,
  qty             numeric(12, 2) not null,
  -- Snapshot of the catalog item's unit at issue.
  unit            text not null,
  -- Moving-average unit cost at the moment of issue (the cost basis).
  unit_cost       numeric(12, 2) not null,
  total_cost      numeric(16, 2) generated always as (qty * unit_cost) stored,
  note            text,
  issued_by       uuid references public.users(id) default auth.uid(),
  issued_at       timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  constraint stock_issues_qty_positive check (qty > 0),
  constraint stock_issues_unit_cost_nonneg check (unit_cost >= 0)
);

create index stock_issues_project_item_idx on public.stock_issues (project_id, catalog_item_id);
create index stock_issues_wp_idx on public.stock_issues (work_package_id);

alter table public.stock_issues enable row level security;
revoke all on public.stock_issues from anon, authenticated;
grant select on public.stock_issues to authenticated;
-- READ: project viewers PLUS procurement (sees the store fully, like receipts/on-hand).
create policy "stock_issues readable by project viewers or procurement"
  on public.stock_issues for select to authenticated
  using (
    (select public.can_see_project(project_id))
    or (select public.current_user_role()) = 'procurement'
  );
-- Append-only: no INSERT/UPDATE/DELETE policy — issue_stock is the sole writer.

comment on table public.stock_issues is
  'Spec 177 — append-only เบิก (issue-out) events: a catalog item drawn from a project store TO a work package, at the moving-average cost at issue. Written only via issue_stock.';

-- ----------------------------------------------------------------------------
-- issue_stock — draw stock OUT to a WP at moving-avg cost; decrement on_hand.
-- ----------------------------------------------------------------------------
create function public.issue_stock(
  p_project_id      uuid,
  p_catalog_item_id uuid,
  p_work_package_id uuid,
  p_qty             numeric,
  p_note            text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role        public.user_role := public.current_user_role();
  v_unit        text;
  v_qty_on_hand numeric;
  v_value       numeric;
  v_avg         numeric;
  v_decrement   numeric;
  v_note        text := nullif(btrim(coalesce(p_note, '')), '');
  v_id          uuid;
begin
  -- Role: SITE_STAFF_ROLES — site_admin draws at the WP, plus the PM tier.
  if v_role not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
    raise exception 'issue_stock: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_project(p_project_id) then
    raise exception 'issue_stock: not a project member' using errcode = '42501';
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception 'issue_stock: qty must be > 0' using errcode = '22023';
  end if;
  -- The WP must belong to this project (you draw to a WP in the same store).
  if not exists (
    select 1 from public.work_packages w
     where w.id = p_work_package_id and w.project_id = p_project_id
  ) then
    raise exception 'issue_stock: work package not in this project' using errcode = '22023';
  end if;
  -- Catalog item must exist and be active; snapshot its unit.
  select c.unit into v_unit
    from public.catalog_items c
   where c.id = p_catalog_item_id and c.is_active;
  if v_unit is null then
    raise exception 'issue_stock: unknown or inactive catalog item' using errcode = '22023';
  end if;

  -- Lock the on-hand row and check sufficiency.
  select qty_on_hand, total_value into v_qty_on_hand, v_value
    from public.stock_on_hand
   where project_id = p_project_id and catalog_item_id = p_catalog_item_id
   for update;
  if v_qty_on_hand is null or v_qty_on_hand < p_qty then
    raise exception 'issue_stock: insufficient stock on hand' using errcode = '22023';
  end if;

  -- Moving-average cost at issue (the cost basis). Decrement on-hand by qty and
  -- by qty*avg; fully depleting forces value to 0 so rounding dust never lingers.
  v_avg := round(v_value / v_qty_on_hand, 2);
  v_decrement := p_qty * v_avg;
  update public.stock_on_hand
     set qty_on_hand = v_qty_on_hand - p_qty,
         total_value = case when v_qty_on_hand - p_qty = 0 then 0 else v_value - v_decrement end,
         updated_at  = now()
   where project_id = p_project_id and catalog_item_id = p_catalog_item_id;

  insert into public.stock_issues
    (project_id, catalog_item_id, work_package_id, qty, unit, unit_cost, note)
  values
    (p_project_id, p_catalog_item_id, p_work_package_id, p_qty, v_unit, v_avg, v_note)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.issue_stock(uuid, uuid, uuid, numeric, text) from public, anon;
grant execute on function public.issue_stock(uuid, uuid, uuid, numeric, text) to authenticated;

comment on function public.issue_stock(uuid, uuid, uuid, numeric, text) is
  'Spec 177 U3 — draw stock OUT to a work package at moving-average cost (SITE_STAFF tier + project member). Guards qty/WP-in-project/active-item/sufficient on-hand; decrements stock_on_hand under a row lock and records an append-only stock_issues row. Returns the issue id.';
