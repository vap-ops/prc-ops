-- Spec 224 — Catalog item facets (ADR 0066 / S2, decision D3). The catalog
-- conflated MATERIAL kind with FULFILLMENT mode and ASSET class (defect C1). The
-- schema already half-encoded fulfillment via `stockable = false` on the
-- direct-to-WP items. D3 promotes that signal to three explicit facets and makes
-- `fulfillment_mode` the SINGLE SOURCE OF TRUTH for stocking, DERIVING `stockable`
-- on write so the two can never contradict (an item can't be made-to-order yet
-- stockable). This is the precondition for the S3 re-home of cats 09/10/13 (spec
-- 232) and the scoped pickers' kind_filter (spec 227).
--
-- Fully ADDITIVE: new columns (NOT NULL + default → existing rows backfill in the
-- column-add) + an explicit backfill of fulfillment_mode from the legacy stockable
-- signal. The catalog write RPCs are DROP+CREATE'd to add three trailing-default
-- facet params (so every existing positional caller + ::regprocedure pin keeps
-- resolving — the spec 221 U2/U3b precedent). Bodies sourced from the LIVE
-- functions (pg_get_functiondef), never an old migration file (the GL/category
-- drain trap). The role gate is upgraded to the null-safe captured form per
-- ADR 0066 D8 (an unbound caller must be DENIED, not silently allowed).

-- 1. Facet enums. House rule (CLAUDE.md): classification fields are Postgres
--    ENUMS, never free-text. `assembly` is added in spec 231 / S7 (NOT here).
create type public.catalog_item_kind as enum
  ('material', 'tool', 'equipment', 'labor', 'service', 'softcost');

create type public.catalog_fulfillment_mode as enum
  ('off_shelf', 'made_to_order');

-- 2. Facet columns. NOT NULL + default → the column-add backfills every existing
--    row (kind=material, fulfillment_mode=off_shelf, owner_supplied=false).
alter table public.catalog_items
  add column kind             public.catalog_item_kind        not null default 'material',
  add column fulfillment_mode public.catalog_fulfillment_mode not null default 'off_shelf',
  add column owner_supplied   boolean                         not null default false;

comment on column public.catalog_items.kind is
  'Spec 224 (ADR 0066 D3) — what CLASS of thing this is (material/tool/equipment/labor/service/softcost; assembly added in spec 231). Backfilled to material; the C1 re-home of tool/fabrication categories is spec 232 / S3.';
comment on column public.catalog_items.fulfillment_mode is
  'Spec 224 (ADR 0066 D3) — how the item is sourced (off_shelf | made_to_order). SSOT for stocking: stockable is DERIVED from this on write (made_to_order ⇒ not stocked).';
comment on column public.catalog_items.owner_supplied is
  'Spec 224 (ADR 0066 D3) — whether the client/owner supplies the item (vs the firm procuring it).';

-- 3. Backfill fulfillment_mode from the existing stockable signal: the non-stockable
--    rows were the half-encoded made-to-order set (C1). `is false` leaves NULL/true
--    rows at the off_shelf default. kind/owner_supplied keep their column defaults.
update public.catalog_items
   set fulfillment_mode = 'made_to_order'
 where stockable is false;

-- ----------------------------------------------------------------------------
-- 4. DROP+CREATE create_catalog_item / update_catalog_item from the LIVE bodies,
--    adding the three trailing-default facet params and DERIVING stockable from
--    fulfillment_mode:
--      v_mode := coalesce(p_fulfillment_mode,
--                  case when coalesce(p_stockable,true) then 'off_shelf'
--                       else 'made_to_order' end);
--      stockable := (v_mode = 'off_shelf')
--    The explicit p_fulfillment_mode WINS; p_stockable is kept as a back-compat arg
--    that only BOOTSTRAPS the mode when no facet is supplied (the live app's current
--    call sites pass p_stockable but no facet → unchanged behaviour). Role gate is
--    the null-safe captured form (ADR 0066 D8). All other arms are verbatim LIVE.
-- ----------------------------------------------------------------------------

drop function public.create_catalog_item(
  public.item_category, text, text, text, boolean, text, text, uuid, uuid);

create function public.create_catalog_item(
  p_category         public.item_category default null,
  p_base_item        text default null,
  p_spec_attrs       text default null,
  p_unit             text default null,
  p_stockable        boolean default true,
  p_note             text default null,
  p_product_code     text default null,
  p_subcategory_id   uuid default null,
  p_category_id      uuid default null,
  p_kind             public.catalog_item_kind default 'material',
  p_fulfillment_mode public.catalog_fulfillment_mode default null,
  p_owner_supplied   boolean default false
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role()::text;
  v_id   uuid;
  v_base text := btrim(coalesce(p_base_item, ''));
  v_unit text := btrim(coalesce(p_unit, ''));
  v_spec text := nullif(btrim(coalesce(p_spec_attrs, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_code text := nullif(btrim(coalesce(p_product_code, '')), '');
  -- Effective category: explicit category_id wins; else derive from the enum.
  v_cat  uuid := coalesce(
                   p_category_id,
                   (select id from public.catalog_categories where legacy_category = p_category));
  -- Spec 224 — fulfillment_mode is the SSOT; bootstrap it from the legacy
  -- p_stockable when no facet is supplied, then derive stockable from it.
  v_mode public.catalog_fulfillment_mode := coalesce(
           p_fulfillment_mode,
           case when coalesce(p_stockable, true) then 'off_shelf'::public.catalog_fulfillment_mode
                else 'made_to_order'::public.catalog_fulfillment_mode end);
  v_stockable boolean := (v_mode = 'off_shelf');
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'create_catalog_item: role not permitted' using errcode = '42501';
  end if;
  if v_cat is null then
    raise exception 'create_catalog_item: category required' using errcode = '22023';
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
  if p_subcategory_id is not null and not exists (
       select 1 from public.catalog_subcategories
        where id = p_subcategory_id and category_id = v_cat) then
    raise exception 'create_catalog_item: subcategory not in category' using errcode = '22023';
  end if;

  insert into public.catalog_items
      (category, category_id, base_item, spec_attrs, unit, stockable, note, product_code,
       subcategory_id, kind, fulfillment_mode, owner_supplied)
    values (p_category, v_cat, v_base, v_spec, v_unit, v_stockable, v_note, v_code,
            p_subcategory_id, coalesce(p_kind, 'material'), v_mode, coalesce(p_owner_supplied, false))
    returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_catalog_item(
  public.item_category, text, text, text, boolean, text, text, uuid, uuid,
  public.catalog_item_kind, public.catalog_fulfillment_mode, boolean) from public, anon;
grant execute on function public.create_catalog_item(
  public.item_category, text, text, text, boolean, text, text, uuid, uuid,
  public.catalog_item_kind, public.catalog_fulfillment_mode, boolean) to authenticated;
comment on function public.create_catalog_item(
  public.item_category, text, text, text, boolean, text, text, uuid, uuid,
  public.catalog_item_kind, public.catalog_fulfillment_mode, boolean) is
  'Spec 175/214/219/221/224 — add a catalog item (back-office). category_id is the source of truth (p_category_id wins, else derived from the enum p_category); p_category is OPTIONAL. Facets: kind/fulfillment_mode/owner_supplied. fulfillment_mode is the SSOT for stocking — stockable is DERIVED (p_fulfillment_mode wins; p_stockable kept for back-compat, only bootstraps the mode when no facet given). product_code + subcategory optional (subcategory must match category_id → 22023). Null/disallowed role → 42501.';

drop function public.update_catalog_item(
  uuid, public.item_category, text, text, text, boolean, text, text, uuid, uuid);

create function public.update_catalog_item(
  p_id               uuid,
  p_category         public.item_category default null,
  p_base_item        text default null,
  p_spec_attrs       text default null,
  p_unit             text default null,
  p_stockable        boolean default true,
  p_note             text default null,
  p_product_code     text default null,
  p_subcategory_id   uuid default null,
  p_category_id      uuid default null,
  p_kind             public.catalog_item_kind default 'material',
  p_fulfillment_mode public.catalog_fulfillment_mode default null,
  p_owner_supplied   boolean default false
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role()::text;
  v_base text := btrim(coalesce(p_base_item, ''));
  v_unit text := btrim(coalesce(p_unit, ''));
  v_spec text := nullif(btrim(coalesce(p_spec_attrs, '')), '');
  v_note text := nullif(btrim(coalesce(p_note, '')), '');
  v_code text := nullif(btrim(coalesce(p_product_code, '')), '');
  v_cat  uuid := coalesce(
                   p_category_id,
                   (select id from public.catalog_categories where legacy_category = p_category));
  v_mode public.catalog_fulfillment_mode := coalesce(
           p_fulfillment_mode,
           case when coalesce(p_stockable, true) then 'off_shelf'::public.catalog_fulfillment_mode
                else 'made_to_order'::public.catalog_fulfillment_mode end);
  v_stockable boolean := (v_mode = 'off_shelf');
  v_n    integer;
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'update_catalog_item: role not permitted' using errcode = '42501';
  end if;
  if v_cat is null then
    raise exception 'update_catalog_item: category required' using errcode = '22023';
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
  if p_subcategory_id is not null and not exists (
       select 1 from public.catalog_subcategories
        where id = p_subcategory_id and category_id = v_cat) then
    raise exception 'update_catalog_item: subcategory not in category' using errcode = '22023';
  end if;

  update public.catalog_items
     set category         = p_category,
         category_id      = v_cat,
         base_item        = v_base,
         spec_attrs       = v_spec,
         unit             = v_unit,
         stockable        = v_stockable,
         note             = v_note,
         product_code     = v_code,
         subcategory_id   = p_subcategory_id,
         kind             = coalesce(p_kind, 'material'),
         fulfillment_mode = v_mode,
         owner_supplied   = coalesce(p_owner_supplied, false)
   where id = p_id;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'update_catalog_item: unknown item' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.update_catalog_item(
  uuid, public.item_category, text, text, text, boolean, text, text, uuid, uuid,
  public.catalog_item_kind, public.catalog_fulfillment_mode, boolean) from public, anon;
grant execute on function public.update_catalog_item(
  uuid, public.item_category, text, text, text, boolean, text, text, uuid, uuid,
  public.catalog_item_kind, public.catalog_fulfillment_mode, boolean) to authenticated;
comment on function public.update_catalog_item(
  uuid, public.item_category, text, text, text, boolean, text, text, uuid, uuid,
  public.catalog_item_kind, public.catalog_fulfillment_mode, boolean) is
  'Spec 175/214/219/221/224 — edit a catalog item (back-office). category_id source of truth; p_category OPTIONAL. Facets kind/fulfillment_mode/owner_supplied; stockable DERIVED from fulfillment_mode (p_fulfillment_mode wins; p_stockable bootstraps the mode for back-compat). Unknown id → 22023; subcategory must match category_id → 22023; null/disallowed role → 42501.';
