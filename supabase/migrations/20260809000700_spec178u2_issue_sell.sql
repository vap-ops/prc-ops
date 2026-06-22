-- Spec 178 U2 — issue snapshots the SELL price (transfer pricing at issue).
--
-- Operator dial: the WP "buys" the stock at the moment of issue. So issue_stock
-- snapshots a sell_price beside the moving-average unit_cost it already records.
-- The sell price = the item's per-item rate (spec 178 U1), falling back to the
-- moving-average COST when no rate is set — an unpriced item sells AT COST (zero
-- store margin), never null, so wp_profit (U4) is never understated. The snapshot
-- is immutable (append-only): changing a rate only affects FUTURE issues.
--
-- stock_issues gains sell_price (nullable — legacy rows + the cost-only era have
-- none) + total_sell (generated qty*sell_price). issue_stock keeps its 6-arg
-- signature, so CREATE OR REPLACE (body-only change) preserves grants and the
-- pgTAP 182/183 signature pins; no DROP, no re-grant.

alter table public.stock_issues
  add column sell_price numeric(12, 2),
  add column total_sell numeric(16, 2) generated always as (qty * sell_price) stored;

comment on column public.stock_issues.sell_price is
  'Spec 178 U2 — the per-unit SELL price snapshot at issue (store transfer price): the item''s sell rate, or the moving-avg cost when unpriced. Immutable; null on legacy/cost-only rows.';
comment on column public.stock_issues.total_sell is
  'Spec 178 U2 — generated qty * sell_price: the WP''s material charge for this draw (what wp_profit folds into its materials line).';

-- ----------------------------------------------------------------------------
-- issue_stock — same 6-arg signature; body reconstructed from the live U6 def +
-- the sell-price snapshot (v_sell = item rate, else the moving-avg cost).
-- ----------------------------------------------------------------------------
create or replace function public.issue_stock(
  p_project_id      uuid,
  p_catalog_item_id uuid,
  p_work_package_id uuid,
  p_qty             numeric,
  p_note            text default null,
  p_receiver_worker_id uuid default null
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
  v_sell        numeric;
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
  -- A named receiver must be an ACTIVE worker on this project (or unassigned).
  if p_receiver_worker_id is not null and not exists (
    select 1 from public.workers w
     where w.id = p_receiver_worker_id and w.active
       and (w.project_id = p_project_id or w.project_id is null)
  ) then
    raise exception 'issue_stock: receiver is not an active worker on this project'
      using errcode = '22023';
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
  -- Sell price snapshot (transfer price): the item's rate, else the cost (unpriced
  -- sells at cost → zero store margin, never null).
  v_sell := coalesce(
    (select sell_rate from public.item_sell_rates where catalog_item_id = p_catalog_item_id),
    v_avg);
  update public.stock_on_hand
     set qty_on_hand = v_qty_on_hand - p_qty,
         total_value = case when v_qty_on_hand - p_qty = 0 then 0 else v_value - v_decrement end,
         updated_at  = now()
   where project_id = p_project_id and catalog_item_id = p_catalog_item_id;

  insert into public.stock_issues
    (project_id, catalog_item_id, work_package_id, qty, unit, unit_cost, sell_price, note,
     receiver_worker_id)
  values
    (p_project_id, p_catalog_item_id, p_work_package_id, p_qty, v_unit, v_avg, v_sell, v_note,
     p_receiver_worker_id)
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.issue_stock(uuid, uuid, uuid, numeric, text, uuid) is
  'Spec 177 U3/U6 + 178 U2 — draw stock OUT to a WP at moving-average cost, snapshotting a sell_price (item rate, else cost) for the store transfer price (SITE_STAFF tier + member); optionally names a receiver worker (custody handshake). Decrements stock_on_hand under a row lock; returns the issue id.';
