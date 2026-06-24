-- Spec 198 U1 — multi-line รับเข้า (bulk stock check-in).
--
-- The คลัง รับเข้า form becomes a multi-row grid; record_stock_in_bulk records
-- every row in ONE atomic round-trip (mirrors add_supply_plan_lines, spec 181
-- U2). Same role gate + per-line validation + on-hand roll-up as the single
-- record_stock_in (spec 177/197) — only the entry batches. Any bad line raises
-- and the whole batch rolls back (no partial check-in). The single
-- record_stock_in is kept (spec 195 P3 auto-receipt + other callers depend on it).
--
-- CREATE (not CREATE OR REPLACE) — a brand-new function. Grants are set
-- explicitly below; anon is revoked (and asserted denied in pgTAP).

create function public.record_stock_in_bulk(p_project_id uuid, p_lines jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role     public.user_role := public.current_user_role();
  v_line     jsonb;
  v_item     uuid;
  v_qty      numeric;
  v_cost     numeric;
  v_supplier uuid;
  v_note     text;
  v_unit     text;
  v_count    int := 0;
begin
  -- Role: site_admin (storekeeper) + the cost-bearing curation tier — identical
  -- to the post-spec-197 record_stock_in gate.
  if v_role not in ('site_admin', 'project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'record_stock_in_bulk: role not permitted' using errcode = '42501';
  end if;
  -- Membership: PM/SA by membership / super/director see-all; procurement is a
  -- cross-project curator.
  if not (public.can_see_project(p_project_id) or v_role = 'procurement') then
    raise exception 'record_stock_in_bulk: not a project member' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception 'record_stock_in_bulk: unknown project' using errcode = '22023';
  end if;
  if jsonb_typeof(p_lines) <> 'array' or jsonb_array_length(p_lines) = 0 then
    raise exception 'record_stock_in_bulk: lines must be a non-empty json array' using errcode = '22023';
  end if;

  -- Atomic: validate + insert every line; any failure rolls back the whole call.
  for v_line in select * from jsonb_array_elements(p_lines) loop
    v_item     := (v_line ->> 'catalog_item_id')::uuid;
    v_qty      := (v_line ->> 'qty')::numeric;
    v_cost     := (v_line ->> 'unit_cost')::numeric;
    v_supplier := nullif(v_line ->> 'supplier_id', '')::uuid;
    v_note     := nullif(btrim(coalesce(v_line ->> 'note', '')), '');

    if v_qty is null or v_qty <= 0 then
      raise exception 'record_stock_in_bulk: qty must be > 0' using errcode = '22023';
    end if;
    if v_cost is null or v_cost < 0 then
      raise exception 'record_stock_in_bulk: unit_cost must be >= 0' using errcode = '22023';
    end if;
    -- Catalog item must exist and be active; snapshot its unit onto the receipt.
    select c.unit into v_unit
      from public.catalog_items c
     where c.id = v_item and c.is_active;
    if v_unit is null then
      raise exception 'record_stock_in_bulk: unknown or inactive catalog item' using errcode = '22023';
    end if;
    if v_supplier is not null and not exists (
      select 1 from public.suppliers s where s.id = v_supplier
    ) then
      raise exception 'record_stock_in_bulk: unknown supplier' using errcode = '22023';
    end if;

    insert into public.stock_receipts
      (project_id, catalog_item_id, qty, unit, unit_cost, supplier_id, note)
    values
      (p_project_id, v_item, v_qty, v_unit, v_cost, v_supplier, v_note);

    -- Roll into on-hand: a pure stock-IN is additive (qty + value).
    insert into public.stock_on_hand (project_id, catalog_item_id, qty_on_hand, total_value)
    values (p_project_id, v_item, v_qty, v_qty * v_cost)
    on conflict (project_id, catalog_item_id) do update
      set qty_on_hand = public.stock_on_hand.qty_on_hand + excluded.qty_on_hand,
          total_value = public.stock_on_hand.total_value + excluded.total_value,
          updated_at  = now();

    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.record_stock_in_bulk(uuid, jsonb) from public, anon;
grant execute on function public.record_stock_in_bulk(uuid, jsonb) to authenticated;

comment on function public.record_stock_in_bulk(uuid, jsonb) is
  'Spec 198 U1 — multi-line รับเข้า: record many stock-in (รับเข้า) lines into a project store at cost in one atomic call. Same gate/validation as record_stock_in (site_admin + BACK_OFFICE; can_see_project OR procurement). Each line {catalog_item_id, qty, unit_cost, supplier_id?, note?} inserts a stock_receipts row + rolls into stock_on_hand. Returns the count inserted.';
