-- Spec 214 — product code (รหัสสินค้า) on catalog items.
--
-- A structured 6-digit code per catalog item (main 2 + sub 2 + sequence 2),
-- assigned by procurement, prefix-searchable. v1 stores it as a FREE 6-digit
-- string — the segment meaning is a documented convention, not modelled against
-- item_category (see spec 214). Additive: a nullable column + format CHECK + a
-- partial-unique index, plus the two catalog write RPCs extended to carry it.

alter table public.catalog_items
  add column product_code text;

alter table public.catalog_items
  add constraint catalog_items_product_code_format
  check (product_code is null or product_code ~ '^[0-9]{6}$');

-- One item per code (only when set — many items may have no code yet).
create unique index catalog_items_product_code_uniq
  on public.catalog_items (product_code)
  where product_code is not null;

-- Extend create_catalog_item / update_catalog_item to carry the code. DROP+CREATE
-- (not REPLACE) because the signature changes; the new p_product_code defaults to
-- null so existing named-arg callers stay valid. Role gate + grant posture
-- unchanged (gate inside the body, null-safe — anon-exec audit posture).

drop function public.create_catalog_item(
  public.item_category, text, text, text, boolean, text);

create function public.create_catalog_item(
  p_category     public.item_category,
  p_base_item    text,
  p_spec_attrs   text,
  p_unit         text,
  p_stockable    boolean,
  p_note         text,
  p_product_code text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   uuid;
  v_base text := btrim(p_base_item);
  v_unit text := btrim(p_unit);
  v_spec text := nullif(btrim(coalesce(p_spec_attrs, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_code text := nullif(btrim(coalesce(p_product_code, '')), '');
begin
  if public.current_user_role() not in
       ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'create_catalog_item: role not permitted' using errcode = '42501';
  end if;
  if v_base = '' or length(v_base) > 200 then
    raise exception 'create_catalog_item: base_item required (<=200)' using errcode = '22023';
  end if;
  if v_unit = '' or length(v_unit) > 40 then
    raise exception 'create_catalog_item: unit required (<=40)' using errcode = '22023';
  end if;
  if v_spec is not null and length(v_spec) > 200 then
    raise exception 'create_catalog_item: spec_attrs too long (<=200)' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 1000 then
    raise exception 'create_catalog_item: note too long (<=1000)' using errcode = '22023';
  end if;
  if v_code is not null and v_code !~ '^[0-9]{6}$' then
    raise exception 'create_catalog_item: product_code must be 6 digits' using errcode = '22023';
  end if;

  insert into public.catalog_items
      (category, base_item, spec_attrs, unit, stockable, note, product_code)
    values (p_category, v_base, v_spec, v_unit, coalesce(p_stockable, true), v_note, v_code)
    returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_catalog_item(
  public.item_category, text, text, text, boolean, text, text) from public, anon;
grant execute on function public.create_catalog_item(
  public.item_category, text, text, text, boolean, text, text) to authenticated;
comment on function public.create_catalog_item(
  public.item_category, text, text, text, boolean, text, text) is
  'Spec 175 U2 / 214 — add a catalog item (back-office: pm/super/procurement/director). Optional 6-digit product_code (unique). Trims inputs; unique (base_item, spec_attrs) and unique product_code → 23505. Returns the new id.';

drop function public.update_catalog_item(
  uuid, public.item_category, text, text, text, boolean, text);

create function public.update_catalog_item(
  p_id           uuid,
  p_category     public.item_category,
  p_base_item    text,
  p_spec_attrs   text,
  p_unit         text,
  p_stockable    boolean,
  p_note         text,
  p_product_code text default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_base text := btrim(p_base_item);
  v_unit text := btrim(p_unit);
  v_spec text := nullif(btrim(coalesce(p_spec_attrs, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_code text := nullif(btrim(coalesce(p_product_code, '')), '');
  v_n    integer;
begin
  if public.current_user_role() not in
       ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'update_catalog_item: role not permitted' using errcode = '42501';
  end if;
  if v_base = '' or length(v_base) > 200 then
    raise exception 'update_catalog_item: base_item required (<=200)' using errcode = '22023';
  end if;
  if v_unit = '' or length(v_unit) > 40 then
    raise exception 'update_catalog_item: unit required (<=40)' using errcode = '22023';
  end if;
  if v_spec is not null and length(v_spec) > 200 then
    raise exception 'update_catalog_item: spec_attrs too long (<=200)' using errcode = '22023';
  end if;
  if v_note is not null and length(v_note) > 1000 then
    raise exception 'update_catalog_item: note too long (<=1000)' using errcode = '22023';
  end if;
  if v_code is not null and v_code !~ '^[0-9]{6}$' then
    raise exception 'update_catalog_item: product_code must be 6 digits' using errcode = '22023';
  end if;

  -- Full-replace semantics: the edit form always sends the code field (pre-filled
  -- with the current value), so a normal edit preserves it and clearing the field
  -- clears the code.
  update public.catalog_items
     set category     = p_category,
         base_item    = v_base,
         spec_attrs   = v_spec,
         unit         = v_unit,
         stockable    = coalesce(p_stockable, true),
         note         = v_note,
         product_code = v_code
   where id = p_id;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'update_catalog_item: unknown item' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.update_catalog_item(
  uuid, public.item_category, text, text, text, boolean, text, text) from public, anon;
grant execute on function public.update_catalog_item(
  uuid, public.item_category, text, text, text, boolean, text, text) to authenticated;
comment on function public.update_catalog_item(
  uuid, public.item_category, text, text, text, boolean, text, text) is
  'Spec 175 U3 / 214 — edit a catalog item (back-office). Optional 6-digit product_code (unique). Unknown id → 22023; duplicate (base_item, spec_attrs) or product_code → 23505.';
