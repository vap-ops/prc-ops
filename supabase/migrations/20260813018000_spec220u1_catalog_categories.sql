-- Spec 221 U1 — managed category taxonomy: additive foundation (NO drops).
--
-- NB: the FILE keeps the `spec220u1` name on purpose. It was applied to the shared
-- DB as version 20260813018000 / name `spec220u1_catalog_categories` BEFORE a
-- concurrent-session number collision moved this work from spec 220 → 221 (spec 220
-- is the G63 role-admin session). The recorded migration NAME must not change, so
-- the file name stays; everything else reads spec 221. (See LANES.md 2026-06-29.)
--
-- Spec 219 made subcategories a managed table; the MAIN category stayed a fixed
-- item_category enum. The operator chose full self-service (add/remove/rename/
-- recode top-level categories). This unit lands the managed table + a nullable
-- category_id FK on catalog_items + catalog_subcategories, backfilled from the
-- enum and kept synced by a trigger while the app still writes the enum. The
-- DESTRUCTIVE cutover (drop the enum + columns, swap RPCs/code to category_id) is
-- Spec 221 U2 — break-glass, operator-gated. Everything here is additive +
-- reversible.

create table public.catalog_categories (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  name        text not null,
  sort_order  smallint not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  -- Transient: the enum value each SEEDED row maps to. Drives the backfill +
  -- the pre-cutover sync trigger. Dropped at the U2 cutover. NULL for new
  -- user-created categories (which only become item-referenceable post-cutover).
  legacy_category public.item_category,
  constraint catalog_categories_code_format check (code ~ '^[0-9]{2}$'),
  constraint catalog_categories_code_uniq unique (code),
  constraint catalog_categories_legacy_uniq unique (legacy_category)
);

alter table public.catalog_categories enable row level security;
revoke all on public.catalog_categories from anon, authenticated;
grant select on public.catalog_categories to authenticated;

create policy "catalog_categories readable by authenticated"
  on public.catalog_categories for select to authenticated
  using (true);

comment on table public.catalog_categories is
  'Spec 221 — managed main-category taxonomy (reference data; read to authenticated, written via create/update_catalog_category RPCs). Replaces the item_category enum at the U2 cutover. code = the 2-digit main code (product_code digits 1-2). legacy_category is a transient backfill map, dropped at cutover.';

-- Seed the 13 enum values (codes 01..13 in enum order; names from the
-- ITEM_CATEGORY_LABEL SSOT). legacy_category ties each row to its enum value.
insert into public.catalog_categories (code, name, sort_order, legacy_category) values
  ('01', 'เหล็ก / อุปกรณ์ยึด',        1,  'steel_fixing'),
  ('02', 'ประปา / สุขภัณฑ์',          2,  'plumbing_sanitary'),
  ('03', 'ความปลอดภัย / หน้างาน',     3,  'site_safety'),
  ('04', 'หลังคา / ครอบ',             4,  'roofing'),
  ('05', 'ฝ้า / กระเบื้อง',           5,  'ceiling_tile'),
  ('06', 'ไฟฟ้า',                      6,  'electrical'),
  ('07', 'ประตู / งานหนีไฟ',          7,  'door_fire'),
  ('08', 'สี',                         8,  'paint'),
  ('09', 'เครื่องมืองานปูน',          9,  'masonry_tools'),
  ('10', 'เครื่องจักร / เครื่องมือ',  10, 'machinery_tools'),
  ('11', 'อิฐทางเท้า',                11, 'paving'),
  ('12', 'ถังบำบัด / ถังน้ำ',         12, 'tank_septic'),
  ('13', 'งานสั่งทำ',                 13, 'custom_fabrication');

-- The nullable category_id FK on both catalog tables (the cutover makes it the
-- source of truth + not null). Nullable now so the additive backfill is safe.
alter table public.catalog_items
  add column category_id uuid references public.catalog_categories (id);
alter table public.catalog_subcategories
  add column category_id uuid references public.catalog_categories (id);

-- Backfill from the enum via the legacy map.
update public.catalog_items ci
   set category_id = cc.id
  from public.catalog_categories cc
 where cc.legacy_category = ci.category;
update public.catalog_subcategories cs
   set category_id = cc.id
  from public.catalog_categories cc
 where cc.legacy_category = cs.category;

-- Keep category_id current from the enum while the app still writes `category`
-- (pre-cutover). One function serves both tables (both have category + the map
-- target). SECURITY DEFINER so it can read catalog_categories inside the catalog
-- write RPCs (the only writers — catalog_items/subcategories have no write grant).
create function public.sync_catalog_category_id() returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.category is not null then
    new.category_id := (select id from public.catalog_categories
                          where legacy_category = new.category);
  end if;
  return new;
end;
$$;

create trigger catalog_items_sync_category_id
  before insert or update of category on public.catalog_items
  for each row execute function public.sync_catalog_category_id();

create trigger catalog_subcategories_sync_category_id
  before insert or update of category on public.catalog_subcategories
  for each row execute function public.sync_catalog_category_id();

-- ----------------------------------------------------------------------------
-- RPCs — managed-category write side (back-office: pm/super/procurement/
-- director). Definer, revoke from public+anon, grant authenticated (gate in the
-- body, anon-exec audit posture). Code is editable (unlike the subcategory code)
-- — items reference category_id, not the code, so a recode breaks no FK. No
-- delete — deactivate via is_active.
-- ----------------------------------------------------------------------------

create function public.create_catalog_category(
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
    raise exception 'create_catalog_category: role not permitted' using errcode = '42501';
  end if;
  if v_code !~ '^[0-9]{2}$' then
    raise exception 'create_catalog_category: code must be 2 digits' using errcode = '22023';
  end if;
  if v_name = '' or length(v_name) > 120 then
    raise exception 'create_catalog_category: name required (<=120)' using errcode = '22023';
  end if;

  insert into public.catalog_categories (code, name, sort_order)
    values (v_code, v_name, coalesce(p_sort_order, 0))
    returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_catalog_category(text, text, smallint) from public, anon;
grant execute on function public.create_catalog_category(text, text, smallint) to authenticated;
comment on function public.create_catalog_category(text, text, smallint) is
  'Spec 221 — add a managed main category (back-office). 2-digit code, unique → 23505; bad code/name → 22023. Returns the new id.';

create function public.update_catalog_category(
  p_id         uuid,
  p_code       text,
  p_name       text,
  p_sort_order smallint,
  p_is_active  boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := btrim(coalesce(p_code, ''));
  v_name text := btrim(coalesce(p_name, ''));
  v_n    integer;
begin
  if public.current_user_role() not in
       ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'update_catalog_category: role not permitted' using errcode = '42501';
  end if;
  if v_code !~ '^[0-9]{2}$' then
    raise exception 'update_catalog_category: code must be 2 digits' using errcode = '22023';
  end if;
  if v_name = '' or length(v_name) > 120 then
    raise exception 'update_catalog_category: name required (<=120)' using errcode = '22023';
  end if;

  update public.catalog_categories
     set code       = v_code,
         name       = v_name,
         sort_order = coalesce(p_sort_order, 0),
         is_active  = coalesce(p_is_active, true)
   where id = p_id;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'update_catalog_category: unknown category' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.update_catalog_category(uuid, text, text, smallint, boolean) from public, anon;
grant execute on function public.update_catalog_category(uuid, text, text, smallint, boolean) to authenticated;
comment on function public.update_catalog_category(uuid, text, text, smallint, boolean) is
  'Spec 221 — edit a managed main category (back-office): recode / rename / reorder / (de)activate. Code editable (items key on category_id, not the code) — duplicate → 23505. Unknown id → 22023.';
