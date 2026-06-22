-- Spec 177 U1 — Store + Stock-In (รับเข้า) at cost (Phase 3 of the inventory arc).
--
-- The on-site store is a transfer-pricing business unit. This unit puts STOCK ON
-- HAND: goods enter the store, at COST, and the store knows what it holds and what
-- that holding is worth. Cost-first staging is a locked dial — the sell-to-WP
-- margin layer and the flip of wp_profit to at-issue-sell-price are LATER phases.
--
-- Operator decisions (spec 177): stock-in is a STANDALONE catalog-keyed receipt
-- (does NOT touch the free-text PR/PO flow); on-hand is keyed by
-- (project_id, catalog_item_id) with NO stores table (the project's on-site store
-- is implicit, "1 unit per site"); moving-average cost is tracked NOW
-- (qty_on_hand + total_value → avg = value/qty).
--
-- Posture (mirrors catalog + supply_plan): project-scoped READ via can_see_project
-- PLUS a procurement cross-project arm (spec 171/172 — procurement curates รับเข้า
-- across sites and must read what it writes); WRITES go through the SECURITY DEFINER
-- record_stock_in RPC gated to BACK_OFFICE_ROLES — the tables have no write grant.
-- stock_receipts is append-only (CLAUDE.md): corrections are a later reversal unit.

-- ----------------------------------------------------------------------------
-- stock_receipts — append-only รับเข้า events (catalog-keyed, at cost).
-- ----------------------------------------------------------------------------
create table public.stock_receipts (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.projects(id) on delete cascade,
  catalog_item_id uuid not null references public.catalog_items(id),
  qty             numeric(12, 2) not null,
  -- Snapshot of the catalog item's unit at receipt time (the count's unit of record).
  unit            text not null,
  -- Baht per unit at cost. 0 allowed (free issue / internal transfer).
  unit_cost       numeric(12, 2) not null,
  -- Generated so the line value never drifts from qty * unit_cost.
  total_cost      numeric(16, 2) generated always as (qty * unit_cost) stored,
  supplier_id     uuid references public.suppliers(id),
  received_at     timestamptz not null default now(),
  note            text,
  created_by      uuid references public.users(id) default auth.uid(),
  created_at      timestamptz not null default now(),
  constraint stock_receipts_qty_positive check (qty > 0),
  constraint stock_receipts_unit_cost_nonneg check (unit_cost >= 0)
);

create index stock_receipts_project_item_idx
  on public.stock_receipts (project_id, catalog_item_id);

alter table public.stock_receipts enable row level security;
revoke all on public.stock_receipts from anon, authenticated;
grant select on public.stock_receipts to authenticated;
-- READ: project viewers PLUS procurement (cross-project รับเข้า curator).
create policy "stock_receipts readable by project viewers or procurement"
  on public.stock_receipts for select to authenticated
  using (
    (select public.can_see_project(project_id))
    or (select public.current_user_role()) = 'procurement'
  );
-- Append-only: no INSERT/UPDATE/DELETE policy — record_stock_in is the sole writer.

comment on table public.stock_receipts is
  'Spec 177 — append-only stock-in (รับเข้า) events: a catalog item received into a project''s on-site store at cost. Written only via record_stock_in; corrections via a later reversal unit.';

-- ----------------------------------------------------------------------------
-- stock_on_hand — derived current state, one row per (project, catalog item).
-- moving-average unit cost is DERIVED: total_value / qty_on_hand.
-- ----------------------------------------------------------------------------
create table public.stock_on_hand (
  project_id      uuid not null references public.projects(id) on delete cascade,
  catalog_item_id uuid not null references public.catalog_items(id),
  qty_on_hand     numeric(16, 2) not null default 0,
  total_value     numeric(18, 2) not null default 0,
  updated_at      timestamptz not null default now(),
  primary key (project_id, catalog_item_id)
);

alter table public.stock_on_hand enable row level security;
revoke all on public.stock_on_hand from anon, authenticated;
grant select on public.stock_on_hand to authenticated;
-- READ: project viewers PLUS procurement. No write policy — the RPC maintains it.
create policy "stock_on_hand readable by project viewers or procurement"
  on public.stock_on_hand for select to authenticated
  using (
    (select public.can_see_project(project_id))
    or (select public.current_user_role()) = 'procurement'
  );

comment on table public.stock_on_hand is
  'Spec 177 — derived store inventory state per (project, catalog item): qty_on_hand + total_value (baht at cost). Moving-average unit cost = total_value / qty_on_hand. Maintained only by record_stock_in.';

-- ----------------------------------------------------------------------------
-- record_stock_in — record a รับเข้า event + roll it into on-hand (additive).
-- ----------------------------------------------------------------------------
create function public.record_stock_in(
  p_project_id      uuid,
  p_catalog_item_id uuid,
  p_qty             numeric,
  p_unit_cost       numeric,
  p_supplier_id     uuid,
  p_note            text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_unit text;
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_id   uuid;
begin
  -- Role: the cost-bearing curation tier (BACK_OFFICE_ROLES).
  if v_role not in ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'record_stock_in: role not permitted' using errcode = '42501';
  end if;
  -- Membership: PM by membership / super/director see-all (can_see_project);
  -- procurement is a cross-project curator.
  if not (public.can_see_project(p_project_id) or v_role = 'procurement') then
    raise exception 'record_stock_in: not a project member' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception 'record_stock_in: unknown project' using errcode = '22023';
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception 'record_stock_in: qty must be > 0' using errcode = '22023';
  end if;
  if p_unit_cost is null or p_unit_cost < 0 then
    raise exception 'record_stock_in: unit_cost must be >= 0' using errcode = '22023';
  end if;
  -- Catalog item must exist and be active; snapshot its unit onto the receipt.
  select c.unit into v_unit
    from public.catalog_items c
   where c.id = p_catalog_item_id and c.is_active;
  if v_unit is null then
    raise exception 'record_stock_in: unknown or inactive catalog item' using errcode = '22023';
  end if;
  if p_supplier_id is not null and not exists (
    select 1 from public.suppliers s where s.id = p_supplier_id
  ) then
    raise exception 'record_stock_in: unknown supplier' using errcode = '22023';
  end if;

  insert into public.stock_receipts
    (project_id, catalog_item_id, qty, unit, unit_cost, supplier_id, note)
  values
    (p_project_id, p_catalog_item_id, p_qty, v_unit, p_unit_cost, p_supplier_id, v_note)
  returning id into v_id;

  -- Roll into on-hand: a pure stock-IN is additive (qty + value); the moving-avg
  -- recompute only matters on issue-OUT (a later phase).
  insert into public.stock_on_hand (project_id, catalog_item_id, qty_on_hand, total_value)
  values (p_project_id, p_catalog_item_id, p_qty, p_qty * p_unit_cost)
  on conflict (project_id, catalog_item_id) do update
    set qty_on_hand = public.stock_on_hand.qty_on_hand + excluded.qty_on_hand,
        total_value = public.stock_on_hand.total_value + excluded.total_value,
        updated_at  = now();

  return v_id;
end;
$$;

revoke all on function public.record_stock_in(uuid, uuid, numeric, numeric, uuid, text) from public, anon;
grant execute on function public.record_stock_in(uuid, uuid, numeric, numeric, uuid, text) to authenticated;

comment on function public.record_stock_in(uuid, uuid, numeric, numeric, uuid, text) is
  'Spec 177 U1 — record a stock-in (รับเข้า) of a catalog item into a project''s store at cost (BACK_OFFICE tier; can_see_project OR procurement). Inserts an append-only stock_receipts row and additively rolls it into stock_on_hand. Returns the receipt id.';
