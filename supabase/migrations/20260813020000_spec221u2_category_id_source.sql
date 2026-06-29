-- Spec 221 U2 — make catalog_categories.id (category_id) the source of truth for
-- the main category, while keeping the item_category ENUM vestigial. Fully
-- ADDITIVE + BACKWARD-COMPATIBLE — NO column/type drops (the eventual DROP TYPE
-- is deferred optional cleanup, break-glass). This unlocks user-created main
-- categories (which have no enum value) without an irreversible migration:
--   * the enum `category` columns become nullable (a new category has no enum);
--   * subcategory identity + the item↔subcategory category-match guard move onto
--     category_id (new unique + composite FK on the uuid);
--   * the write RPCs gain a trailing `p_category_id` (uuid) — old enum-only calls
--     still resolve (trailing default), so the live app keeps working between
--     this push and the U3 code deploy.

-- 1. The enum columns are no longer required (new categories have no enum value).
alter table public.catalog_items        alter column category drop not null;
alter table public.catalog_subcategories alter column category drop not null;

-- 2. Subcategory identity + the category-match guard, on category_id.
--    (The legacy enum unique/FK stay — harmless; they just go unenforced when
--    `category` is null, i.e. for new user-categories.)
alter table public.catalog_subcategories
  add constraint catalog_subcategories_category_id_code_uniq unique (category_id, code);
alter table public.catalog_subcategories
  add constraint catalog_subcategories_id_category_id_uniq unique (id, category_id);
alter table public.catalog_items
  add constraint catalog_items_subcategory_category_id_fk
  foreign key (subcategory_id, category_id)
  references public.catalog_subcategories (id, category_id);

-- 3. Sync trigger: only FILL category_id from the enum when it wasn't set
--    explicitly. The new RPCs set category_id directly; this must not overwrite
--    (a new-category insert has category=null → don't wipe its category_id).
create or replace function public.sync_catalog_category_id() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.category_id is null and new.category is not null then
    new.category_id := (select id from public.catalog_categories
                          where legacy_category = new.category);
  end if;
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- 4. Write RPCs gain a `p_category_id` path. category_id is the source of truth
--    (explicit p_category_id wins; else derived from the enum for old callers).
--    The enum column is written through for back-compat (NULL for a new
--    category). DROP+CREATE per the signature-change discipline; the trailing
--    default keeps the existing 8-arg / 4-arg named calls valid.
-- ----------------------------------------------------------------------------

drop function public.create_catalog_item(
  public.item_category, text, text, text, boolean, text, text, uuid);

create function public.create_catalog_item(
  p_category       public.item_category,
  p_base_item      text,
  p_spec_attrs     text,
  p_unit           text,
  p_stockable      boolean,
  p_note           text,
  p_product_code   text default null,
  p_subcategory_id uuid default null,
  p_category_id    uuid default null
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
  -- Effective category: explicit category_id wins; else derive from the enum.
  v_cat  uuid := coalesce(
                   p_category_id,
                   (select id from public.catalog_categories where legacy_category = p_category));
begin
  if public.current_user_role() not in
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
  -- Subcategory must belong to the effective category (now matched on category_id).
  if p_subcategory_id is not null and not exists (
       select 1 from public.catalog_subcategories
        where id = p_subcategory_id and category_id = v_cat) then
    raise exception 'create_catalog_item: subcategory not in category' using errcode = '22023';
  end if;

  insert into public.catalog_items
      (category, category_id, base_item, spec_attrs, unit, stockable, note, product_code, subcategory_id)
    values (p_category, v_cat, v_base, v_spec, v_unit, coalesce(p_stockable, true), v_note, v_code, p_subcategory_id)
    returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_catalog_item(
  public.item_category, text, text, text, boolean, text, text, uuid, uuid) from public, anon;
grant execute on function public.create_catalog_item(
  public.item_category, text, text, text, boolean, text, text, uuid, uuid) to authenticated;
comment on function public.create_catalog_item(
  public.item_category, text, text, text, boolean, text, text, uuid, uuid) is
  'Spec 175/214/219/221 — add a catalog item (back-office). category_id is the source of truth (explicit p_category_id wins, else derived from the enum p_category for old callers); the enum is written through (NULL for a user-created category). Optional 6-digit product_code + subcategory (must match category_id → 22023).';

drop function public.update_catalog_item(
  uuid, public.item_category, text, text, text, boolean, text, text, uuid);

create function public.update_catalog_item(
  p_id             uuid,
  p_category       public.item_category,
  p_base_item      text,
  p_spec_attrs     text,
  p_unit           text,
  p_stockable      boolean,
  p_note           text,
  p_product_code   text default null,
  p_subcategory_id uuid default null,
  p_category_id    uuid default null
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
  v_cat  uuid := coalesce(
                   p_category_id,
                   (select id from public.catalog_categories where legacy_category = p_category));
  v_n    integer;
begin
  if public.current_user_role() not in
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
     set category       = p_category,
         category_id    = v_cat,
         base_item      = v_base,
         spec_attrs     = v_spec,
         unit           = v_unit,
         stockable      = coalesce(p_stockable, true),
         note           = v_note,
         product_code   = v_code,
         subcategory_id = p_subcategory_id
   where id = p_id;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'update_catalog_item: unknown item' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.update_catalog_item(
  uuid, public.item_category, text, text, text, boolean, text, text, uuid, uuid) from public, anon;
grant execute on function public.update_catalog_item(
  uuid, public.item_category, text, text, text, boolean, text, text, uuid, uuid) to authenticated;
comment on function public.update_catalog_item(
  uuid, public.item_category, text, text, text, boolean, text, text, uuid, uuid) is
  'Spec 175/214/219/221 — edit a catalog item (back-office). category_id source of truth (p_category_id wins, else derived from the enum); enum written through. Unknown id → 22023; subcategory must match category_id → 22023.';

drop function public.create_catalog_subcategory(
  public.item_category, text, text, smallint);

create function public.create_catalog_subcategory(
  p_category    public.item_category,
  p_code        text,
  p_name        text,
  p_sort_order  smallint default 0,
  p_category_id uuid default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   uuid;
  v_code text := btrim(coalesce(p_code, ''));
  v_name text := btrim(coalesce(p_name, ''));
  v_cat  uuid := coalesce(
                   p_category_id,
                   (select id from public.catalog_categories where legacy_category = p_category));
begin
  if public.current_user_role() not in
       ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'create_catalog_subcategory: role not permitted' using errcode = '42501';
  end if;
  if v_cat is null then
    raise exception 'create_catalog_subcategory: category required' using errcode = '22023';
  end if;
  if v_code !~ '^[0-9]{2}$' then
    raise exception 'create_catalog_subcategory: code must be 2 digits' using errcode = '22023';
  end if;
  if v_name = '' or length(v_name) > 120 then
    raise exception 'create_catalog_subcategory: name required (<=120)' using errcode = '22023';
  end if;

  insert into public.catalog_subcategories (category, category_id, code, name, sort_order)
    values (p_category, v_cat, v_code, v_name, coalesce(p_sort_order, 0))
    returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_catalog_subcategory(
  public.item_category, text, text, smallint, uuid) from public, anon;
grant execute on function public.create_catalog_subcategory(
  public.item_category, text, text, smallint, uuid) to authenticated;
comment on function public.create_catalog_subcategory(
  public.item_category, text, text, smallint, uuid) is
  'Spec 219/221 — add a catalog subcategory under a main category (back-office). category_id source of truth (p_category_id wins, else derived from the enum); enum written through. Unique (category_id, code) → 23505; bad code/name → 22023.';
