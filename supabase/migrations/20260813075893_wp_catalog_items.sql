-- Spec 389 U1 — WP catalogue (wp_catalog_items) + reference stars.
--
-- The firm-wide work-type identity: one row per Vol.5 code, 2-level tree,
-- in the catalogue family (catalog_items = materials, equipment_catalog_items
-- = equipment SKUs, THIS = work-type SKUs). A project's WP points at its
-- work-type via work_packages.wp_catalog_item_id (the
-- equipment_items.equipment_catalog_item_id precedent), which is what makes a
-- reference photo starred on ANY project surface on EVERY project's WP of the
-- same work-type.
--
-- NOT the retired `wp_templates` (dropped by 20260813075857 — dead taxonomy on
-- the wrong axis): this table is an identity, not a phase-seeding template, and
-- deliberately carries no seeding function. NOT `boq_template` either — that is
-- the priced-estimate grain (spec 236); S10-U6 composes with this, it does not
-- compete.
--
-- The reference read (`get_wp_reference_photos`) is SECURITY DEFINER because
-- photo_logs' SELECT policy keys on can_see_project(), which is FALSE outright
-- for technician and membership-gated for SA/PM — the consumer of a reference
-- photo is by definition on a DIFFERENT project than the photo. The RPC is
-- narrower than any policy widening: starred, current, non-tombstone photos of
-- ONE catalogue item, nothing else.

-- ---------------------------------------------------------------------------
-- 1. work_categories: W10 + W11 + code_prefix (the sheet's Prefix Mapping tab)
-- ---------------------------------------------------------------------------
alter table public.work_categories
  add column if not exists code_prefix text;

comment on column public.work_categories.code_prefix is
  'WP-code prefix for this top-level category (W01–W11 only; null for subsections). Vol.5 Prefix Mapping.';

insert into public.work_categories (code, name_th, name_en, sort_order)
  values ('W10', 'งานอื่นๆ', 'Others', 1000),
         ('W11', 'งานระบบความปลอดภัย', 'Safety & security systems', 1100)
  on conflict (code) do nothing;

update public.work_categories set code_prefix = m.prefix
from (values
  ('W01', 'PR'), ('W02', 'S'), ('W03', 'A'), ('W04', 'PL'), ('W05', 'E'),
  ('W06', 'H'), ('W07', 'SG'), ('W08', 'EX'), ('W09', 'F'), ('W10', 'O'),
  ('W11', 'SIS')
) as m(code, prefix)
where work_categories.code = m.code;

-- a duplicate prefix would silently bind the importer's prefix→category map to
-- the last-seen row — make the collision impossible
create unique index work_categories_code_prefix_uniq
  on public.work_categories (code_prefix) where code_prefix is not null;

-- ---------------------------------------------------------------------------
-- 2. wp_catalog_items
-- ---------------------------------------------------------------------------
create table public.wp_catalog_items (
  id               uuid primary key default gen_random_uuid(),
  code             text not null unique,
  name             text not null,
  code_prefix      text not null,
  work_category_id uuid references public.work_categories(id) on delete set null,
  parent_id        uuid references public.wp_catalog_items(id) on delete restrict,
  is_group         boolean not null default false,
  source_note      text,
  is_active        boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint wp_catalog_items_group_has_no_parent
    check (not (is_group and parent_id is not null))
);

comment on table public.wp_catalog_items is
  'Firm-wide work-type catalogue (spec 389) — one row per Vol.5 code, 2-level (group → leaf). The cross-project identity that work_packages.wp_catalog_item_id points at; reference-photo stars hang off it. NOT the retired wp_templates (identity, not phase-seeding) and NOT boq_template (that is the priced-estimate grain). Seeded by scripts/import-wp-catalog.ts (service-role, upsert by code — retirement of dropped codes is manual via is_active).';

create trigger wp_catalog_items_set_updated_at
  before update on public.wp_catalog_items
  for each row execute function public.set_updated_at();

-- the CHECK above stops a group having a parent; this stops a leaf hanging off
-- a leaf (the importer orders writes correctly, but a service-role write is not
-- the importer)
create or replace function public.wp_catalog_items_parent_guard()
returns trigger
language plpgsql
as $$
begin
  if new.parent_id is not null
     and not coalesce((select is_group from public.wp_catalog_items where id = new.parent_id), false) then
    raise exception 'wp_catalog_items: parent must be a group row' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger wp_catalog_items_parent_guard
  before insert or update on public.wp_catalog_items
  for each row execute function public.wp_catalog_items_parent_guard();

create index wp_catalog_items_parent_idx on public.wp_catalog_items (parent_id);

alter table public.wp_catalog_items enable row level security;

-- firm-wide library posture (boq_template / spec 221 D8): world-readable to
-- signed-in users, no direct writes (seed script runs service-role; a curator
-- RPC is a later unit).
create policy "wp catalog readable by authenticated"
  on public.wp_catalog_items for select to authenticated using (true);

revoke all on public.wp_catalog_items from public, anon, authenticated;
grant select on public.wp_catalog_items to authenticated;

-- ---------------------------------------------------------------------------
-- 3. work_packages.wp_catalog_item_id
-- ---------------------------------------------------------------------------
alter table public.work_packages
  add column wp_catalog_item_id uuid references public.wp_catalog_items(id) on delete set null;

comment on column public.work_packages.wp_catalog_item_id is
  'The firm-wide work-type this WP instantiates (spec 389). Set at birth for catalogue-seeded projects; backfilled by the PD mapping surface for legacy ones. NULL = unmapped (deliberate for retired/dropped work).';

create index work_packages_wp_catalog_item_idx
  on public.work_packages (wp_catalog_item_id) where wp_catalog_item_id is not null;

-- ---------------------------------------------------------------------------
-- 4. wp_catalog_reference_photos (the stars)
-- ---------------------------------------------------------------------------
create table public.wp_catalog_reference_photos (
  id                 uuid primary key default gen_random_uuid(),
  wp_catalog_item_id uuid not null references public.wp_catalog_items(id) on delete cascade,
  photo_log_id       uuid not null references public.photo_logs(id) on delete cascade,
  starred_by         uuid not null references public.users(id),
  note               text,
  created_at         timestamptz not null default now(),
  constraint wp_catalog_reference_photos_pair_uniq
    unique (wp_catalog_item_id, photo_log_id)
);

comment on table public.wp_catalog_reference_photos is
  'PD-curated reference stars (spec 389 D2) at (photo, catalogue-item) grain — a starred photo surfaces as ตัวอย่างงาน on every project''s WP of that work-type. Writes only via star/unstar_reference_photo (PD + super_admin). Curation, not history: un-star is a hard delete; the photo row is untouched.';

create index wp_catalog_reference_photos_item_idx
  on public.wp_catalog_reference_photos (wp_catalog_item_id);

alter table public.wp_catalog_reference_photos enable row level security;

create policy "reference stars readable by authenticated"
  on public.wp_catalog_reference_photos for select to authenticated using (true);

revoke all on public.wp_catalog_reference_photos from public, anon, authenticated;
grant select on public.wp_catalog_reference_photos to authenticated;

-- ---------------------------------------------------------------------------
-- 5. star / unstar (PD-tier writes; DEFINER because authenticated has no
--    write grant on the star table)
-- ---------------------------------------------------------------------------
create or replace function public.star_reference_photo(
  p_photo_log_id uuid,
  p_note text default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_actor   uuid := auth.uid();
  v_role    public.user_role := public.current_user_role();
  v_item    uuid;
  v_superseded boolean;
  v_tombstone  boolean;
  v_id      uuid;
begin
  -- null-safe gate: PD tier only
  if v_role is null or v_role not in ('project_director', 'super_admin') then
    raise exception 'star_reference_photo: project_director or super_admin only'
      using errcode = '42501';
  end if;

  select w.wp_catalog_item_id,
         exists (select 1 from public.photo_logs n where n.superseded_by = p.id),
         (p.storage_path is null)
    into v_item, v_superseded, v_tombstone
  from public.photo_logs p
  join public.work_packages w on w.id = p.work_package_id
  where p.id = p_photo_log_id;

  if not found then
    raise exception 'star_reference_photo: unknown photo' using errcode = '22023';
  end if;
  if v_item is null then
    raise exception 'star_reference_photo: the photo''s WP is not mapped to the catalogue'
      using errcode = '22023';
  end if;
  if v_superseded or v_tombstone then
    raise exception 'star_reference_photo: a superseded or removed photo cannot be a reference'
      using errcode = '22023';
  end if;

  insert into public.wp_catalog_reference_photos
    (wp_catalog_item_id, photo_log_id, starred_by, note)
  values (v_item, p_photo_log_id, v_actor, p_note)
  on conflict (wp_catalog_item_id, photo_log_id)
    do update set note = coalesce(excluded.note, wp_catalog_reference_photos.note)
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.unstar_reference_photo(
  p_photo_log_id uuid
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
begin
  if v_role is null or v_role not in ('project_director', 'super_admin') then
    raise exception 'unstar_reference_photo: project_director or super_admin only'
      using errcode = '42501';
  end if;

  delete from public.wp_catalog_reference_photos where photo_log_id = p_photo_log_id;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. the cross-project reader
--
-- DELIBERATELY WIDE (recorded decision, pinned in pgTAP): any authenticated
-- caller — including visitor — can read the starred set. The catalogue and the
-- star table are already world-readable to authenticated (firm-wide library
-- posture), so this reveals storage PATHS + project names of curated reference
-- photos only; photo BYTES still require the server-side signed-URL mint, which
-- U5 binds to exactly the paths this RPC returned. Narrowing to can_see_wp()
-- would break the intended consumer (technician — can_see_project is false
-- outright for that role).
-- ---------------------------------------------------------------------------
create or replace function public.get_wp_reference_photos(
  p_wp_catalog_item_id uuid
) returns table (
  photo_log_id uuid,
  storage_path text,
  phase public.photo_phase,
  project_name text,
  note text,
  starred_by uuid,
  starred_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select p.id, p.storage_path, p.phase, pr.name, s.note, s.starred_by, s.created_at
  from public.wp_catalog_reference_photos s
  join public.photo_logs p on p.id = s.photo_log_id
  join public.work_packages w on w.id = p.work_package_id
  join public.projects pr on pr.id = w.project_id
  where s.wp_catalog_item_id = p_wp_catalog_item_id
    -- current only: no newer row supersedes it (ADR 0009 anti-join), and not a
    -- tombstone (ADR 0015: payload NULL)
    and not exists (select 1 from public.photo_logs n where n.superseded_by = p.id)
    and p.storage_path is not null
  order by s.created_at desc;
$$;

-- house ACL shape: kill default PUBLIC EXECUTE, grant authenticated only
revoke all on function public.star_reference_photo(uuid, text) from public, anon;
revoke all on function public.unstar_reference_photo(uuid) from public, anon;
revoke all on function public.get_wp_reference_photos(uuid) from public, anon;
grant execute on function public.star_reference_photo(uuid, text) to authenticated;
grant execute on function public.unstar_reference_photo(uuid) to authenticated;
grant execute on function public.get_wp_reference_photos(uuid) to authenticated;
