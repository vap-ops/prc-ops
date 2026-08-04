-- Spec 392 U1 — ผังโซนโครงการ: zone maps as an axis that CROSSES the WP tree.
--
-- A zone is NOT a parent work package. `wp_hierarchy_guard` caps the tree at
-- depth 2 and a WP carries exactly one work-category, while a zone spans
-- concrete + steel + paint at once — so "group by trade" and "group by area"
-- cannot be the same column. `work_packages.zone_id` is a second, independent
-- axis (the shape ADR 0080 chose for the org chart).
--
-- Geometry is normalised to [0,1] fractions of the map box — the convention
-- `src/lib/photos/validate-markup.ts` already uses for photo strokes. That is
-- what lets the background image be swapped, or a whole map be cloned onto a
-- differently-photographed site, without moving a zone. The CHECK below is the
-- authority; the client validator only mirrors it.
--
-- Live gate-check (2026-08-04) behind the choices here:
--   * `is_manager(user_role)` = project_manager | super_admin | project_director,
--     coalesce-false. Delegated to, never restated — a hardcoded copy is what
--     broke catalog-images uploads for two weeks (#823).
--   * `can_see_project` is blanket-true for super_admin / project_coordinator /
--     project_director / procurement_manager and membership-scoped for
--     project_manager / site_admin / site_owner / auditor. It is FALSE for
--     technician, so the zone read is deliberately invisible to ช่าง here;
--     their WP surfaces come through DEFINER RPCs and U3 owes them one.
--   * `work_packages` SELECT is a TABLE grant (so `zone_id` is readable at
--     once) while UPDATE is COLUMN-granted and excludes every structural
--     column (status, is_group, parent_id, rework_round). `zone_id` joins that
--     set: no UPDATE grant, writes through `set_wp_zone` only.

create type public.zone_shape as enum ('rect', 'rounded_rect', 'ellipse', 'polygon');

-- ---------------------------------------------------------------------------
-- Geometry validator. IMMUTABLE so a CHECK can use it.
-- Box shapes carry {x, y, w, h}; polygons carry {points: [[x, y], ...]}. Each
-- form must reject the OTHER's keys, or a shape change would silently leave
-- geometry the renderer cannot draw.
-- ---------------------------------------------------------------------------
create or replace function public.zone_geometry_ok(
  p_shape public.zone_shape,
  p_geometry jsonb
) returns boolean
language sql
immutable
as $$
  select case
    when p_geometry is null or jsonb_typeof(p_geometry) <> 'object' then false
    when p_shape = 'polygon' then (
      p_geometry ? 'points'
      and not (p_geometry ?| array['x', 'y', 'w', 'h'])
      and jsonb_typeof(p_geometry -> 'points') = 'array'
      and jsonb_array_length(p_geometry -> 'points') between 3 and 200
      and not exists (
        select 1
          from jsonb_array_elements(p_geometry -> 'points') as pt
         where jsonb_typeof(pt) <> 'array'
            or jsonb_array_length(pt) <> 2
            or jsonb_typeof(pt -> 0) <> 'number'
            or jsonb_typeof(pt -> 1) <> 'number'
            or (pt ->> 0)::numeric < 0 or (pt ->> 0)::numeric > 1
            or (pt ->> 1)::numeric < 0 or (pt ->> 1)::numeric > 1
      )
    )
    else (
      p_geometry ?& array['x', 'y', 'w', 'h']
      and not (p_geometry ? 'points')
      and jsonb_typeof(p_geometry -> 'x') = 'number'
      and jsonb_typeof(p_geometry -> 'y') = 'number'
      and jsonb_typeof(p_geometry -> 'w') = 'number'
      and jsonb_typeof(p_geometry -> 'h') = 'number'
      and (p_geometry ->> 'x')::numeric >= 0
      and (p_geometry ->> 'y')::numeric >= 0
      and (p_geometry ->> 'w')::numeric > 0
      and (p_geometry ->> 'h')::numeric > 0
      and (p_geometry ->> 'x')::numeric + (p_geometry ->> 'w')::numeric <= 1
      and (p_geometry ->> 'y')::numeric + (p_geometry ->> 'h')::numeric <= 1
    )
  end
$$;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table public.project_zone_maps (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name text not null check (btrim(name) <> '' and char_length(name) <= 120),
  -- Nullable and site-specific: the photograph of THIS site's plan. A clone
  -- deliberately leaves it behind.
  background_path text check (background_path is null or char_length(background_path) <= 400),
  sheet_code text check (sheet_code is null or char_length(sheet_code) <= 60),
  sheet_rev text check (sheet_rev is null or char_length(sheet_rev) <= 20),
  sort_order integer not null default 0,
  created_by uuid not null references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Target of the composite FK below, which is what makes the denormalised
  -- project_id on a zone provably equal to its map's.
  constraint project_zone_maps_id_project_unique unique (id, project_id)
);

create index project_zone_maps_project_idx
  on public.project_zone_maps (project_id, sort_order);

create table public.project_zones (
  id uuid primary key default gen_random_uuid(),
  map_id uuid not null,
  -- Denormalised from the map so RLS and the rollup never need a join. The
  -- composite FK below is what makes that safe: `project_id` cannot disagree
  -- with the map's, because the pair itself is the foreign key. A comment
  -- promising they agree would not survive the first writer who forgets.
  project_id uuid not null references public.projects (id) on delete cascade,
  constraint project_zones_map_fk foreign key (map_id, project_id)
    references public.project_zone_maps (id, project_id) on delete cascade,
  code text not null check (btrim(code) <> '' and char_length(code) <= 20),
  name text not null check (btrim(name) <> '' and char_length(name) <= 120),
  shape public.zone_shape not null,
  geometry jsonb not null,
  -- Ships nullable and unused by the v1 editor: the operator flagged nesting
  -- as near-future, and retrofitting a parent onto live rows costs a migration
  -- plus a backfill.
  parent_zone_id uuid references public.project_zones (id) on delete set null,
  sort_order integer not null default 0,
  created_by uuid not null references public.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_zones_geometry_ok check (public.zone_geometry_ok(shape, geometry)),
  constraint project_zones_no_self_parent check (parent_zone_id is null or parent_zone_id <> id),
  constraint project_zones_code_unique unique (map_id, code)
);

create index project_zones_map_idx on public.project_zones (map_id, sort_order);
create index project_zones_project_idx on public.project_zones (project_id);

create trigger project_zone_maps_set_updated_at
  before update on public.project_zone_maps
  for each row execute function public.set_updated_at();

create trigger project_zones_set_updated_at
  before update on public.project_zones
  for each row execute function public.set_updated_at();

alter table public.work_packages
  add column zone_id uuid references public.project_zones (id) on delete set null;

create index work_packages_zone_idx on public.work_packages (zone_id)
  where zone_id is not null;

-- ---------------------------------------------------------------------------
-- Grants. Reads only; every write goes through the DEFINER RPCs below.
-- `work_packages.zone_id` gets NO update grant — it is a structural column.
--
-- ⚠️ The REVOKE is load-bearing, not decoration: this project's default
-- privileges hand a brand-new table full rights to `anon` AND `authenticated`,
-- so a table created with `grant select` alone is still directly writable by
-- every signed-in user and readable signed-out. Proven here by pgTAP — four
-- posture assertions failed on the first apply, which is why they exist.
-- ---------------------------------------------------------------------------
revoke all on public.project_zone_maps from public, anon, authenticated;
revoke all on public.project_zones from public, anon, authenticated;
grant select on public.project_zone_maps to authenticated;
grant select on public.project_zones to authenticated;

-- ---------------------------------------------------------------------------
-- RLS. The read arm MIRRORS the live `work_packages readable by privileged
-- roles` policy so a zone reaches exactly as far as the WP that carries it:
-- procurement + procurement_manager cross-project, everyone else through
-- can_see_project. The separate `client` policy on work_packages
-- (client_has_live_access) is deliberately NOT mirrored — a client-facing zone
-- surface does not exist yet, and inventing its reach here would be untested.
-- ---------------------------------------------------------------------------
alter table public.project_zone_maps enable row level security;
alter table public.project_zones enable row level security;

create policy "zone maps readable by privileged roles"
  on public.project_zone_maps for select
  using (
    (select public.current_user_role()) in ('procurement', 'procurement_manager')
    or (select public.can_see_project(project_id))
  );

create policy "zones readable by privileged roles"
  on public.project_zones for select
  using (
    (select public.current_user_role()) in ('procurement', 'procurement_manager')
    or (select public.can_see_project(project_id))
  );

-- ---------------------------------------------------------------------------
-- RPCs. Gate = is_manager(current_user_role()) AND can_see_project, mirroring
-- save_wp_brief_draft / create_work_package exactly.
-- ---------------------------------------------------------------------------
create or replace function public.save_project_zone_map(
  p_project_id uuid,
  p_map_id uuid,
  p_name text,
  p_background_path text default null,
  p_sheet_code text default null,
  p_sheet_rev text default null
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id uuid;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'save_project_zone_map: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_project(p_project_id) then
    raise exception 'save_project_zone_map: not a member of this project' using errcode = '42501';
  end if;

  if p_map_id is null then
    insert into public.project_zone_maps
      (project_id, name, background_path, sheet_code, sheet_rev, created_by)
    values
      (p_project_id, btrim(p_name), nullif(btrim(coalesce(p_background_path, '')), ''),
       nullif(btrim(coalesce(p_sheet_code, '')), ''), nullif(btrim(coalesce(p_sheet_rev, '')), ''),
       auth.uid())
    returning id into v_id;
    return v_id;
  end if;

  update public.project_zone_maps
     set name = btrim(p_name),
         background_path = nullif(btrim(coalesce(p_background_path, '')), ''),
         sheet_code = nullif(btrim(coalesce(p_sheet_code, '')), ''),
         sheet_rev = nullif(btrim(coalesce(p_sheet_rev, '')), '')
   where id = p_map_id and project_id = p_project_id
  returning id into v_id;

  if v_id is null then
    raise exception 'save_project_zone_map: map not found in this project' using errcode = '22023';
  end if;
  return v_id;
end;
$$;

create or replace function public.upsert_project_zone(
  p_map_id uuid,
  p_zone_id uuid,
  p_code text,
  p_name text,
  p_shape public.zone_shape,
  p_geometry jsonb,
  p_parent_zone_id uuid default null,
  p_sort_order integer default 0
) returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_project uuid;
  v_id uuid;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'upsert_project_zone: role not permitted' using errcode = '42501';
  end if;

  select project_id into v_project from public.project_zone_maps where id = p_map_id;
  if v_project is null then
    raise exception 'upsert_project_zone: map not found' using errcode = '22023';
  end if;
  if not public.can_see_project(v_project) then
    raise exception 'upsert_project_zone: not a member of this project' using errcode = '42501';
  end if;

  -- A parent must live on the SAME map, or the nesting would cross projects.
  if p_parent_zone_id is not null
     and not exists (select 1 from public.project_zones
                      where id = p_parent_zone_id and map_id = p_map_id) then
    raise exception 'upsert_project_zone: parent zone is not on this map' using errcode = '22023';
  end if;

  if p_zone_id is null then
    insert into public.project_zones
      (map_id, project_id, code, name, shape, geometry, parent_zone_id, sort_order, created_by)
    values
      (p_map_id, v_project, btrim(p_code), btrim(p_name), p_shape, p_geometry,
       p_parent_zone_id, coalesce(p_sort_order, 0), auth.uid())
    returning id into v_id;
    return v_id;
  end if;

  update public.project_zones
     set code = btrim(p_code),
         name = btrim(p_name),
         shape = p_shape,
         geometry = p_geometry,
         parent_zone_id = p_parent_zone_id,
         sort_order = coalesce(p_sort_order, 0)
   where id = p_zone_id and map_id = p_map_id
  returning id into v_id;

  if v_id is null then
    raise exception 'upsert_project_zone: zone not found on this map' using errcode = '22023';
  end if;
  return v_id;
end;
$$;

create or replace function public.delete_project_zone(p_zone_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_project uuid;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'delete_project_zone: role not permitted' using errcode = '42501';
  end if;

  select project_id into v_project from public.project_zones where id = p_zone_id;
  if v_project is null then
    raise exception 'delete_project_zone: zone not found' using errcode = '22023';
  end if;
  if not public.can_see_project(v_project) then
    raise exception 'delete_project_zone: not a member of this project' using errcode = '42501';
  end if;

  -- Both FKs that point here are `on delete set null`, so a WP in this zone
  -- loses its zone rather than disappearing, and a nested child is orphaned
  -- rather than cascade-deleted.
  delete from public.project_zones where id = p_zone_id;
end;
$$;

create or replace function public.set_wp_zone(
  p_work_package_id uuid,
  p_zone_id uuid
) returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_wp_project uuid;
  v_zone_project uuid;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'set_wp_zone: role not permitted' using errcode = '42501';
  end if;

  select project_id into v_wp_project from public.work_packages where id = p_work_package_id;
  if v_wp_project is null then
    raise exception 'set_wp_zone: work package not found' using errcode = '22023';
  end if;
  if not public.can_see_project(v_wp_project) then
    raise exception 'set_wp_zone: not a member of this project' using errcode = '42501';
  end if;

  if p_zone_id is not null then
    select project_id into v_zone_project from public.project_zones where id = p_zone_id;
    if v_zone_project is null then
      raise exception 'set_wp_zone: zone not found' using errcode = '22023';
    end if;
    -- The FK alone would happily accept another project's zone.
    if v_zone_project <> v_wp_project then
      raise exception 'set_wp_zone: zone belongs to a different project' using errcode = '22023';
    end if;
  end if;

  update public.work_packages set zone_id = p_zone_id where id = p_work_package_id;
end;
$$;

-- Cloning is the whole point of drawing a map: 89% of work packages carry a
-- name that already exists in another project, so a map is drawn once per
-- building type and adjusted. Geometry, codes, names and nesting travel;
-- `background_path` does NOT — that photograph belongs to one site.
create or replace function public.clone_project_zones(
  p_source_project_id uuid,
  p_target_project_id uuid
) returns integer
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_map record;
  v_new_map uuid;
  v_count integer := 0;
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'clone_project_zones: role not permitted' using errcode = '42501';
  end if;
  if p_source_project_id = p_target_project_id then
    raise exception 'clone_project_zones: source and destination must differ' using errcode = '22023';
  end if;
  if not public.can_see_project(p_source_project_id)
     or not public.can_see_project(p_target_project_id) then
    raise exception 'clone_project_zones: not a member of both projects' using errcode = '42501';
  end if;

  -- Refuse rather than duplicate. Without this a double-tap silently produces
  -- a second full set of maps carrying the SAME zone codes, and since the
  -- unique index is per-map nothing downstream would object — the operator
  -- would be left picking between two identical โซน A. Re-cloning is a delete
  -- decision, not a copy decision.
  if exists (select 1 from public.project_zone_maps where project_id = p_target_project_id) then
    raise exception 'clone_project_zones: the destination already has a zone map'
      using errcode = '22023';
  end if;

  for v_map in
    select * from public.project_zone_maps
     where project_id = p_source_project_id
     order by sort_order, created_at
  loop
    insert into public.project_zone_maps
      (project_id, name, sheet_code, sheet_rev, sort_order, created_by)
    values
      (p_target_project_id, v_map.name, v_map.sheet_code, v_map.sheet_rev,
       v_map.sort_order, auth.uid())
    returning id into v_new_map;

    -- Two passes: copy the rows carrying their old id, then re-point
    -- parent_zone_id through that mapping. One pass cannot work — a child may
    -- be inserted before its parent exists on the new map.
    with copied as (
      insert into public.project_zones
        (map_id, project_id, code, name, shape, geometry, sort_order, created_by)
      select v_new_map, p_target_project_id, z.code, z.name, z.shape, z.geometry,
             z.sort_order, auth.uid()
        from public.project_zones z
       where z.map_id = v_map.id
       order by z.sort_order, z.created_at
      returning id, code
    )
    select count(*)::int + v_count into v_count from copied;

    update public.project_zones child
       set parent_zone_id = parent_new.id
      from public.project_zones src
      join public.project_zones src_parent on src_parent.id = src.parent_zone_id
      join public.project_zones parent_new
        on parent_new.map_id = v_new_map and parent_new.code = src_parent.code
     where child.map_id = v_new_map
       and src.map_id = v_map.id
       and src.code = child.code;
  end loop;

  return v_count;
end;
$$;

-- Default EXECUTE reaches PUBLIC, which includes anon — revoke from both, then
-- grant only the signed-in role (the house posture for every DEFINER RPC).
revoke all on function public.save_project_zone_map(uuid, uuid, text, text, text, text) from public, anon;
revoke all on function public.upsert_project_zone(uuid, uuid, text, text, public.zone_shape, jsonb, uuid, integer) from public, anon;
revoke all on function public.delete_project_zone(uuid) from public, anon;
revoke all on function public.set_wp_zone(uuid, uuid) from public, anon;
revoke all on function public.clone_project_zones(uuid, uuid) from public, anon;

grant execute on function public.save_project_zone_map(uuid, uuid, text, text, text, text) to authenticated;
grant execute on function public.upsert_project_zone(uuid, uuid, text, text, public.zone_shape, jsonb, uuid, integer) to authenticated;
grant execute on function public.delete_project_zone(uuid) to authenticated;
grant execute on function public.set_wp_zone(uuid, uuid) to authenticated;
grant execute on function public.clone_project_zones(uuid, uuid) to authenticated;
