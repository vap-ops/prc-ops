-- Spec 239 U2 (ADR 0066 / C1) — wire the two U1 columns (search_terms,
-- lead_time_days) into the catalog write RPCs so the item form can SAVE them.
--
-- U1 (20260813043000) added the columns; the U2 item form surfaces them behind
-- "เพิ่มรายละเอียด". But create_catalog_item / update_catalog_item have no params
-- for them, so the form could not persist them — hence this small schema follow-up
-- (split out of the otherwise code-only U2 because it touches the RPC signatures).
--
-- ADDITIVE: two TRAILING-DEFAULT params (p_search_terms text, p_lead_time_days int)
-- appended to each RPC. Because the signature GROWS (arity 12 → 14), CREATE OR
-- REPLACE would create an overload rather than replace, so we DROP the 12-arg
-- versions and CREATE the 14-arg ones — the spec 224 (20260813030000) precedent.
-- Bodies are the LIVE 12-arg bodies (the spec 225-fix 20260813037000 def — the last
-- definition; U1 did not touch these RPCs) VERBATIM, plus: the two new params, their
-- null-safe handling + guards, and the two columns in the INSERT/UPDATE. Every other
-- arm — the null-safe role gate (ADR 0066 D8), category/base/unit/spec/note/code
-- validation, fulfillment→stockable derivation, and the canonical is_primary
-- catalog_item_categories maintenance — is unchanged. Grants re-applied for the new
-- signature (revoke from public, anon; grant to authenticated).

-- ----------------------------------------------------------------------------
-- create_catalog_item — +p_search_terms +p_lead_time_days.
-- ----------------------------------------------------------------------------
drop function public.create_catalog_item(
  public.item_category, text, text, text, boolean, text, text, uuid, uuid,
  public.catalog_item_kind, public.catalog_fulfillment_mode, boolean);

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
  p_owner_supplied   boolean default false,
  p_search_terms     text default null,
  p_lead_time_days   int default null
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
  -- Spec 239 U2 — search synonyms (trim→null) + lead time (procurement days).
  v_search text := nullif(btrim(coalesce(p_search_terms, '')), '');
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
  -- Spec 239 U2 — guards for the new fields (the DB CHECK on lead_time_days is the floor).
  if v_search is not null and length(v_search) > 500 then
    raise exception 'create_catalog_item: search_terms too long (<=500)' using errcode = '22023';
  end if;
  if p_lead_time_days is not null and p_lead_time_days < 0 then
    raise exception 'create_catalog_item: lead_time_days must be >= 0' using errcode = '22023';
  end if;
  if p_subcategory_id is not null and not exists (
       select 1 from public.catalog_subcategories
        where id = p_subcategory_id and category_id = v_cat) then
    raise exception 'create_catalog_item: subcategory not in category' using errcode = '22023';
  end if;

  insert into public.catalog_items
      (category, category_id, base_item, spec_attrs, unit, stockable, note, product_code,
       subcategory_id, kind, fulfillment_mode, owner_supplied, search_terms, lead_time_days)
    values (p_category, v_cat, v_base, v_spec, v_unit, v_stockable, v_note, v_code,
            p_subcategory_id, coalesce(p_kind, 'material'), v_mode, coalesce(p_owner_supplied, false),
            v_search, p_lead_time_days)
    returning id into v_id;

  -- Spec 225 / S4 follow-up: write the canonical is_primary membership mirroring the
  -- new item's canonical (category_id, subcategory_id).
  insert into public.catalog_item_categories
      (catalog_item_id, category_id, subcategory_id, is_primary, created_by)
    values (v_id, v_cat, p_subcategory_id, true, auth.uid());

  return v_id;
end;
$$;

revoke all on function public.create_catalog_item(
  public.item_category, text, text, text, boolean, text, text, uuid, uuid,
  public.catalog_item_kind, public.catalog_fulfillment_mode, boolean, text, int) from public, anon;
grant execute on function public.create_catalog_item(
  public.item_category, text, text, text, boolean, text, text, uuid, uuid,
  public.catalog_item_kind, public.catalog_fulfillment_mode, boolean, text, int) to authenticated;
comment on function public.create_catalog_item(
  public.item_category, text, text, text, boolean, text, text, uuid, uuid,
  public.catalog_item_kind, public.catalog_fulfillment_mode, boolean, text, int) is
  'Spec 175/214/219/221/224/239 — add a catalog item (back-office). category_id source of truth; facets kind/fulfillment_mode/owner_supplied (stockable derived); product_code + subcategory optional; spec 239 search_terms (<=500) + lead_time_days (>=0) optional. Writes the canonical is_primary catalog_item_categories membership. Null/disallowed role → 42501; bad input → 22023; duplicate → 23505.';

-- ----------------------------------------------------------------------------
-- update_catalog_item — +p_search_terms +p_lead_time_days.
-- ----------------------------------------------------------------------------
drop function public.update_catalog_item(
  uuid, public.item_category, text, text, text, boolean, text, text, uuid, uuid,
  public.catalog_item_kind, public.catalog_fulfillment_mode, boolean);

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
  p_owner_supplied   boolean default false,
  p_search_terms     text default null,
  p_lead_time_days   int default null
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
  v_search text := nullif(btrim(coalesce(p_search_terms, '')), '');
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
  if v_search is not null and length(v_search) > 500 then
    raise exception 'update_catalog_item: search_terms too long (<=500)' using errcode = '22023';
  end if;
  if p_lead_time_days is not null and p_lead_time_days < 0 then
    raise exception 'update_catalog_item: lead_time_days must be >= 0' using errcode = '22023';
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
         owner_supplied   = coalesce(p_owner_supplied, false),
         search_terms     = v_search,
         lead_time_days   = p_lead_time_days
   where id = p_id;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'update_catalog_item: unknown item' using errcode = '22023';
  end if;

  -- Spec 225 / S4 follow-up: keep the canonical is_primary membership in lockstep with
  -- the (possibly changed) canonical home. First drop a SECONDARY membership that would
  -- collide with the new canonical pair, then move the single primary row; insert one if
  -- the item somehow has none.
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
$$;

revoke all on function public.update_catalog_item(
  uuid, public.item_category, text, text, text, boolean, text, text, uuid, uuid,
  public.catalog_item_kind, public.catalog_fulfillment_mode, boolean, text, int) from public, anon;
grant execute on function public.update_catalog_item(
  uuid, public.item_category, text, text, text, boolean, text, text, uuid, uuid,
  public.catalog_item_kind, public.catalog_fulfillment_mode, boolean, text, int) to authenticated;
comment on function public.update_catalog_item(
  uuid, public.item_category, text, text, text, boolean, text, text, uuid, uuid,
  public.catalog_item_kind, public.catalog_fulfillment_mode, boolean, text, int) is
  'Spec 175/214/219/221/224/239 — edit a catalog item (back-office). category_id source of truth; facets (stockable derived); spec 239 search_terms (<=500) + lead_time_days (>=0) optional. Re-syncs the canonical is_primary membership. Unknown id / bad input → 22023; null/disallowed role → 42501.';
