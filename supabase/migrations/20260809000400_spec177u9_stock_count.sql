-- Spec 177 U9 — stock count / variance (shrinkage = a store-BU P&L hit).
--
-- A physical count reconciles the system on-hand to reality: on-hand is set to the
-- counted quantity, and the variance (counted − system) valued at the current
-- moving-average cost IS the shrinkage (negative = loss) or overage (positive). The
-- cost basis (avg unit cost) is unchanged — a count adjusts QUANTITY, not unit cost.
--
-- stock_counts is append-only (CLAUDE.md): a wrong count is corrected by a fresh
-- count, never an UPDATE. Gate: SITE_STAFF_ROLES (site_admin keeps the physical
-- store + the PM tier) — NOT procurement (which does รับเข้า). Counting is limited
-- to items the store already tracks (an on-hand row must exist); cataloguing
-- found-untracked stock is a รับเข้า, not a count.

create table public.stock_counts (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  catalog_item_id uuid not null references public.catalog_items(id),
  -- Snapshot of the system on-hand at count time, and the physical count.
  system_qty      numeric(16, 2) not null,
  counted_qty     numeric(16, 2) not null,
  -- Snapshot of the item's unit + the moving-avg unit cost used to value variance.
  unit            text not null,
  unit_cost       numeric(12, 2) not null,
  -- Generated from the plain columns above (no generated-from-generated chain).
  variance        numeric(16, 2) generated always as (counted_qty - system_qty) stored,
  variance_value  numeric(18, 2)
    generated always as ((counted_qty - system_qty) * unit_cost) stored,
  note            text,
  counted_by      uuid references public.users(id) default auth.uid(),
  counted_at      timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  constraint stock_counts_counted_nonneg check (counted_qty >= 0)
);

create index stock_counts_project_item_idx on public.stock_counts (project_id, catalog_item_id);

alter table public.stock_counts enable row level security;
revoke all on public.stock_counts from anon, authenticated;
grant select on public.stock_counts to authenticated;
-- READ: project viewers PLUS procurement (sees the store fully, like the rest).
create policy "stock_counts readable by project viewers or procurement"
  on public.stock_counts for select to authenticated
  using (
    (select public.can_see_project(project_id))
    or (select public.current_user_role()) = 'procurement'
  );

comment on table public.stock_counts is
  'Spec 177 — append-only physical-count events: system_qty snapshot + counted_qty, with generated variance + variance_value (shrinkage/overage at moving-avg cost). Written only via record_stock_count.';

-- ----------------------------------------------------------------------------
-- record_stock_count — reconcile on-hand to a physical count; log the variance.
-- ----------------------------------------------------------------------------
create function public.record_stock_count(
  p_project_id      uuid,
  p_catalog_item_id uuid,
  p_counted_qty     numeric,
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
  v_system_qty  numeric;
  v_value       numeric;
  v_avg         numeric;
  v_note        text := nullif(btrim(coalesce(p_note, '')), '');
  v_id          uuid;
begin
  -- Role: SITE_STAFF_ROLES — site_admin keeps the physical store + the PM tier.
  if v_role not in ('site_admin', 'project_manager', 'super_admin', 'project_director') then
    raise exception 'record_stock_count: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_project(p_project_id) then
    raise exception 'record_stock_count: not a project member' using errcode = '42501';
  end if;

  if p_counted_qty is null or p_counted_qty < 0 then
    raise exception 'record_stock_count: counted qty must be >= 0' using errcode = '22023';
  end if;

  -- Lock the on-hand row; counting is limited to items the store tracks.
  select qty_on_hand, total_value into v_system_qty, v_value
    from public.stock_on_hand
   where project_id = p_project_id and catalog_item_id = p_catalog_item_id
   for update;
  if v_system_qty is null then
    raise exception 'record_stock_count: item is not stocked in this store' using errcode = '22023';
  end if;

  -- Unit snapshot (the item may be deactivated but still physically on hand).
  select c.unit into v_unit from public.catalog_items c where c.id = p_catalog_item_id;

  -- Moving-average unit cost stays the count's valuation basis.
  v_avg := case when v_system_qty > 0 then round(v_value / v_system_qty, 2) else 0 end;

  insert into public.stock_counts
    (project_id, catalog_item_id, system_qty, counted_qty, unit, unit_cost, note)
  values
    (p_project_id, p_catalog_item_id, v_system_qty, p_counted_qty, v_unit, v_avg, v_note)
  returning id into v_id;

  -- Reconcile on-hand to the counted truth, valued at the (unchanged) avg cost.
  update public.stock_on_hand
     set qty_on_hand = p_counted_qty,
         total_value = round(p_counted_qty * v_avg, 2),
         updated_at  = now()
   where project_id = p_project_id and catalog_item_id = p_catalog_item_id;

  return v_id;
end;
$$;

revoke all on function public.record_stock_count(uuid, uuid, numeric, text) from public, anon;
grant execute on function public.record_stock_count(uuid, uuid, numeric, text) to authenticated;

comment on function public.record_stock_count(uuid, uuid, numeric, text) is
  'Spec 177 U9 — reconcile a store item''s on-hand to a physical count (SITE_STAFF tier + member). Logs an append-only stock_counts row (variance valued at moving-avg cost = shrinkage) and sets on-hand qty/value to the counted truth. Returns the count id.';
