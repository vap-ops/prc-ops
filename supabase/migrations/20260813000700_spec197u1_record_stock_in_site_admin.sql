-- Spec 197 U1 — widen record_stock_in to admit site_admin.
--
-- The store (คลัง) became a per-project surface gated to WP_DETAIL_ROLES, which
-- finally admits site_admin (the on-site storekeeper who physically receives
-- deliveries). The record_stock_in definer was gated to the BACK_OFFICE tier
-- (PM / super / procurement / director) — narrower than the spec's รับเข้า
-- audience (site_admin · procurement). Add 'site_admin' to the role gate so the
-- storekeeper can record รับเข้า from their own project's คลัง.
--
-- CREATE OR REPLACE keeps the SAME signature (uuid,uuid,numeric,numeric,uuid,text):
-- grants and the pgTAP-181 positional calls are unaffected; only the role gate
-- widens. Body reconstructed verbatim from the LIVE pg_proc (the membership /
-- validation / on-hand roll-up logic is unchanged) — the single edited line is
-- the role-gate `in (...)` set.

create or replace function public.record_stock_in(
  p_project_id      uuid,
  p_catalog_item_id uuid,
  p_qty             numeric,
  p_unit_cost       numeric,
  p_supplier_id     uuid default null,
  p_note            text default null
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
  -- Role: the cost-bearing curation tier PLUS site_admin (the on-site
  -- storekeeper who receives deliveries — spec 197 U1).
  if v_role not in ('site_admin', 'project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'record_stock_in: role not permitted' using errcode = '42501';
  end if;
  -- Membership: PM/SA by membership / super/director see-all (can_see_project);
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

comment on function public.record_stock_in(uuid, uuid, numeric, numeric, uuid, text) is
  'Spec 177 U1 / 197 U1 — record a stock-in (รับเข้า) of a catalog item into a project''s store at cost (site_admin + BACK_OFFICE tier; can_see_project OR procurement). Inserts an append-only stock_receipts row and additively rolls it into stock_on_hand. Returns the receipt id.';
