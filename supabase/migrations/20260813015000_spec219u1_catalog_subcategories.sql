-- Spec 219 U1 — catalog subcategory taxonomy (หมวดย่อยวัสดุ).
--
-- The /catalog register filters on ONE axis today (the 13-value item_category
-- chip cloud). Procurement thinks in named drill (เหล็ก › วัสดุโครงสร้าง), and
-- spec 214's 6-digit product_code carries a sub level, but the subcategory NAMES
-- live nowhere. Operator chose to model the subcategory as a real taxonomy table
-- (not a labels-map). The MAIN level stays the item_category enum; this adds the
-- modelled SUB level beneath it.
--
-- catalog_subcategories is reference data on the catalog_items posture: RLS on,
-- read-only to authenticated, written only through the definer RPCs below.
-- catalog_items gains a nullable subcategory_id with a COMPOSITE FK
-- (subcategory_id, category) -> catalog_subcategories(id, category) so an item's
-- category must match its subcategory's; nulls (uncoded items) skip the check.
-- product_code stays the FREE spec-214 string — v1 does NOT lock its digits to
-- the subcategory code (that auto-derive is a deferred later unit).

create table public.catalog_subcategories (
  id          uuid primary key default gen_random_uuid(),
  category    public.item_category not null,
  code        text not null,
  name        text not null,
  sort_order  smallint not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  constraint catalog_subcategories_code_format check (code ~ '^[0-9]{2}$'),
  -- One subcategory per code within a main category (the anti-drift guard).
  constraint catalog_subcategories_category_code_uniq unique (category, code),
  -- Redundant key that exists only to back the composite FK on catalog_items —
  -- lets Postgres guarantee an item's category equals its subcategory's.
  constraint catalog_subcategories_id_category_uniq unique (id, category)
);

alter table public.catalog_subcategories enable row level security;
revoke all on public.catalog_subcategories from anon, authenticated;
grant select on public.catalog_subcategories to authenticated;

create policy "catalog_subcategories readable by authenticated"
  on public.catalog_subcategories for select to authenticated
  using (true);

comment on table public.catalog_subcategories is
  'Spec 219 — modelled SUB level under the item_category enum (reference data; read-only to authenticated, written via the create/update_catalog_subcategory RPCs). One (category, code) identity; code is 2 digits (= product_code digits 3-4 by convention, not enforced).';

-- Seed one anchor row: the spec-214 example. The rest of the taxonomy is entered
-- by procurement through the U2 manage UI (self-governance) — no bulk seed.
insert into public.catalog_subcategories (category, code, name) values
  ('steel_fixing', '01', 'วัสดุโครงสร้าง');

-- The item -> subcategory link. Nullable (uncoded items keep NULL → the composite
-- FK is not checked for them). The composite columns force the category match.
alter table public.catalog_items
  add column subcategory_id uuid;

alter table public.catalog_items
  add constraint catalog_items_subcategory_fk
  foreign key (subcategory_id, category)
  references public.catalog_subcategories (id, category);

-- ----------------------------------------------------------------------------
-- RPCs — taxonomy write side. Definer, role-gated to the back-office curators
-- (pm / super / procurement / director), revoke from public+anon, grant to
-- authenticated (the gate lives in the body; null-safe — anon-exec audit posture).
-- ----------------------------------------------------------------------------

create function public.create_catalog_subcategory(
  p_category   public.item_category,
  p_code       text,
  p_name       text,
  p_sort_order smallint default 0
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id   uuid;
  v_code text := btrim(coalesce(p_code, ''));
  v_name text := btrim(coalesce(p_name, ''));
begin
  if public.current_user_role() not in
       ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'create_catalog_subcategory: role not permitted' using errcode = '42501';
  end if;
  if v_code !~ '^[0-9]{2}$' then
    raise exception 'create_catalog_subcategory: code must be 2 digits' using errcode = '22023';
  end if;
  if v_name = '' or length(v_name) > 120 then
    raise exception 'create_catalog_subcategory: name required (<=120)' using errcode = '22023';
  end if;

  insert into public.catalog_subcategories (category, code, name, sort_order)
    values (p_category, v_code, v_name, coalesce(p_sort_order, 0))
    returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_catalog_subcategory(
  public.item_category, text, text, smallint) from public, anon;
grant execute on function public.create_catalog_subcategory(
  public.item_category, text, text, smallint) to authenticated;
comment on function public.create_catalog_subcategory(
  public.item_category, text, text, smallint) is
  'Spec 219 — add a catalog subcategory under a main category (back-office: pm/super/procurement/director). 2-digit code; unique (category, code) → 23505; bad code/name → 22023. Returns the new id.';

create function public.update_catalog_subcategory(
  p_id         uuid,
  p_name       text,
  p_sort_order smallint,
  p_is_active  boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_n    integer;
begin
  if public.current_user_role() not in
       ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'update_catalog_subcategory: role not permitted' using errcode = '42501';
  end if;
  if v_name = '' or length(v_name) > 120 then
    raise exception 'update_catalog_subcategory: name required (<=120)' using errcode = '22023';
  end if;

  -- Code is immutable once set (item FKs key on it); name/order/active are editable.
  update public.catalog_subcategories
     set name       = v_name,
         sort_order = coalesce(p_sort_order, 0),
         is_active  = coalesce(p_is_active, true)
   where id = p_id;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'update_catalog_subcategory: unknown subcategory' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.update_catalog_subcategory(
  uuid, text, smallint, boolean) from public, anon;
grant execute on function public.update_catalog_subcategory(
  uuid, text, smallint, boolean) to authenticated;
comment on function public.update_catalog_subcategory(
  uuid, text, smallint, boolean) is
  'Spec 219 — rename / reorder / (de)activate a catalog subcategory (back-office). Code immutable. Unknown id → 22023.';

-- ----------------------------------------------------------------------------
-- Extend create_catalog_item / update_catalog_item to carry p_subcategory_id.
-- DROP+CREATE (signature change); the new arg defaults to null so the existing
-- 8-arg named callers (spec 214) stay valid. Bodies are the spec-214 bodies plus
-- the subcategory category-match guard + the new insert/update column. The full
-- db:test suite re-runs 214-product-code as the regression net.
-- ----------------------------------------------------------------------------

drop function public.create_catalog_item(
  public.item_category, text, text, text, boolean, text, text);

create function public.create_catalog_item(
  p_category       public.item_category,
  p_base_item      text,
  p_spec_attrs     text,
  p_unit           text,
  p_stockable      boolean,
  p_note           text,
  p_product_code   text default null,
  p_subcategory_id uuid default null
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
  -- Spec 219 — the chosen subcategory must belong to the item's main category.
  if p_subcategory_id is not null and not exists (
       select 1 from public.catalog_subcategories
        where id = p_subcategory_id and category = p_category) then
    raise exception 'create_catalog_item: subcategory not in category' using errcode = '22023';
  end if;

  insert into public.catalog_items
      (category, base_item, spec_attrs, unit, stockable, note, product_code, subcategory_id)
    values (p_category, v_base, v_spec, v_unit, coalesce(p_stockable, true), v_note, v_code, p_subcategory_id)
    returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_catalog_item(
  public.item_category, text, text, text, boolean, text, text, uuid) from public, anon;
grant execute on function public.create_catalog_item(
  public.item_category, text, text, text, boolean, text, text, uuid) to authenticated;
comment on function public.create_catalog_item(
  public.item_category, text, text, text, boolean, text, text, uuid) is
  'Spec 175 U2 / 214 / 219 — add a catalog item (back-office: pm/super/procurement/director). Optional 6-digit product_code (unique) + optional subcategory_id (must match the item category → 22023). Trims inputs; unique (base_item, spec_attrs) and unique product_code → 23505. Returns the new id.';

drop function public.update_catalog_item(
  uuid, public.item_category, text, text, text, boolean, text, text);

create function public.update_catalog_item(
  p_id             uuid,
  p_category       public.item_category,
  p_base_item      text,
  p_spec_attrs     text,
  p_unit           text,
  p_stockable      boolean,
  p_note           text,
  p_product_code   text default null,
  p_subcategory_id uuid default null
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
  -- Spec 219 — the chosen subcategory must belong to the item's main category.
  if p_subcategory_id is not null and not exists (
       select 1 from public.catalog_subcategories
        where id = p_subcategory_id and category = p_category) then
    raise exception 'update_catalog_item: subcategory not in category' using errcode = '22023';
  end if;

  -- Full-replace semantics: the edit form always sends every field (pre-filled
  -- with current values), so a normal edit preserves them and clearing a field
  -- clears it.
  update public.catalog_items
     set category       = p_category,
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
  uuid, public.item_category, text, text, text, boolean, text, text, uuid) from public, anon;
grant execute on function public.update_catalog_item(
  uuid, public.item_category, text, text, text, boolean, text, text, uuid) to authenticated;
comment on function public.update_catalog_item(
  uuid, public.item_category, text, text, text, boolean, text, text, uuid) is
  'Spec 175 U3 / 214 / 219 — edit a catalog item (back-office). Optional 6-digit product_code (unique) + optional subcategory_id (must match the item category → 22023). Unknown id → 22023; duplicate (base_item, spec_attrs) or product_code → 23505.';
