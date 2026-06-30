-- Spec 225 (ADR 0066 / S4) FOLLOW-UP — wire the item-create/update RPCs to MAINTAIN
-- the catalog_item_categories primary membership.
--
-- Defect: S4 added the additive junction catalog_item_categories + backfilled a single
-- is_primary=true membership for every EXISTING item, but did NOT teach create_catalog_item
-- to write that membership for NEW items. So every catalog item created after the S4
-- backfill got ZERO memberships → it violates the S4 invariant "exactly one is_primary
-- membership per item" (pgTAP 239 assert 20). 1 orphan already on LIVE (product_code NULL,
-- category 09 เครื่องมืองานปูน, created 2026-06-30). update_catalog_item has the SAME hole:
-- it moves catalog_items.category_id/subcategory_id (the canonical home) without re-syncing
-- the primary membership, so a category edit would leave the primary mirroring the OLD home
-- (breaks 239 assert F "every primary membership MIRRORS its item canonical").
--
-- Fix (additive, idempotent): CREATE OR REPLACE both RPCs from their LIVE bodies (sourced via
-- pg_get_functiondef, NOT a stale migration file — see prc-ops-db-migration-lessons), adding
-- the canonical primary-membership maintenance INSIDE the same RPC / transaction. The
-- signatures are UNCHANGED, so CREATE OR REPLACE preserves grants (no anon re-grant trap) and
-- produces no db:types drift. Then backfill the existing orphan(s), reusing the S4 predicate.
-- Mirrors the S4 backfill shape (20260813031000_spec225_catalog_item_categories.sql).

-- ----------------------------------------------------------------------------
-- create_catalog_item — LIVE body + write the canonical is_primary membership.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_catalog_item(p_category item_category DEFAULT NULL::item_category, p_base_item text DEFAULT NULL::text, p_spec_attrs text DEFAULT NULL::text, p_unit text DEFAULT NULL::text, p_stockable boolean DEFAULT true, p_note text DEFAULT NULL::text, p_product_code text DEFAULT NULL::text, p_subcategory_id uuid DEFAULT NULL::uuid, p_category_id uuid DEFAULT NULL::uuid, p_kind catalog_item_kind DEFAULT 'material'::catalog_item_kind, p_fulfillment_mode catalog_fulfillment_mode DEFAULT NULL::catalog_fulfillment_mode, p_owner_supplied boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Spec 225 / S4 follow-up: write the canonical is_primary membership mirroring the
  -- new item's canonical (category_id, subcategory_id) so the junction invariant
  -- ("exactly one is_primary per item, mirroring canonical") holds for new items too.
  insert into public.catalog_item_categories
      (catalog_item_id, category_id, subcategory_id, is_primary, created_by)
    values (v_id, v_cat, p_subcategory_id, true, auth.uid());

  return v_id;
end;
$function$;

-- ----------------------------------------------------------------------------
-- update_catalog_item — LIVE body + re-sync the canonical is_primary membership
-- to the (possibly changed) canonical home.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_catalog_item(p_id uuid, p_category item_category DEFAULT NULL::item_category, p_base_item text DEFAULT NULL::text, p_spec_attrs text DEFAULT NULL::text, p_unit text DEFAULT NULL::text, p_stockable boolean DEFAULT true, p_note text DEFAULT NULL::text, p_product_code text DEFAULT NULL::text, p_subcategory_id uuid DEFAULT NULL::uuid, p_category_id uuid DEFAULT NULL::uuid, p_kind catalog_item_kind DEFAULT 'material'::catalog_item_kind, p_fulfillment_mode catalog_fulfillment_mode DEFAULT NULL::catalog_fulfillment_mode, p_owner_supplied boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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

  -- Spec 225 / S4 follow-up: keep the canonical is_primary membership in lockstep with
  -- the (possibly changed) canonical home, so the primary can never disagree with
  -- catalog_items.category_id/subcategory_id. First drop a SECONDARY membership that
  -- would collide with the new canonical pair (else the dup-membership unique aborts the
  -- re-sync), then move the single primary row; insert one if the item somehow has none.
  delete from public.catalog_item_categories
   where catalog_item_id = p_id
     and not is_primary
     and category_id = v_cat
     and coalesce(subcategory_id, '00000000-0000-0000-0000-000000000000'::uuid)
       = coalesce(p_subcategory_id, '00000000-0000-0000-0000-000000000000'::uuid);

  update public.catalog_item_categories
     set category_id = v_cat, subcategory_id = p_subcategory_id
   where catalog_item_id = p_id and is_primary;

  if not found then
    insert into public.catalog_item_categories
        (catalog_item_id, category_id, subcategory_id, is_primary, created_by)
      values (p_id, v_cat, p_subcategory_id, true, auth.uid());
  end if;
end;
$function$;

-- ----------------------------------------------------------------------------
-- Backfill the existing orphan(s) — one is_primary=true membership per item that
-- has none, mirroring its canonical (category_id, subcategory_id). Idempotent
-- (the not-exists guard + on conflict do nothing); reuses the S4 backfill predicate.
-- ----------------------------------------------------------------------------
insert into public.catalog_item_categories (catalog_item_id, category_id, subcategory_id, is_primary)
select id, category_id, subcategory_id, true
  from public.catalog_items ci
 where category_id is not null
   and not exists (select 1 from public.catalog_item_categories cic
                    where cic.catalog_item_id = ci.id and cic.is_primary)
on conflict do nothing;
