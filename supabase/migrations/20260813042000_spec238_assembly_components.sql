-- Spec 238 — assemblies (ADR 0066 / S10-U3, decision D7). The optional bill of
-- materials for a kind='assembly' catalog item + the COMPUTED-ON-READ explode
-- (D5: a resolver, no persisted explosion rows). Runs after 041000 committed the
-- 'assembly' enum label.
--
-- Posture = ADR 0066 D8 / spec 221 U2: grant SELECT to authenticated, NO direct
-- write/delete grant, writes via null-safe SECURITY DEFINER RPCs (search_path
-- pinned, role captured once, v_role IS NULL OR NOT IN (...) → 42501, revoke from
-- public+anon + grant execute to authenticated, never service_role). Role set =
-- project_manager/super_admin/procurement/project_director (catalog/material side
-- per ADR 0066 D8). Errcodes: 42501 (role), 22023 (bad arg / unknown / non-assembly
-- parent / self-ref), 23505 (duplicate component). OUT OF SCOPE (later): nested
-- explosion (v1 is single-level), persisted explosion, the BOM editor UI (S10-U4).

-- 1. catalog_assembly_components — the BOM. assembly_id CASCADE (deleting the
--    assembly removes its BOM); component_item_id RESTRICT (an item in use as a
--    component can't be hard-deleted out from under an assembly). A component
--    appears once per assembly; an assembly cannot contain itself.
create table public.catalog_assembly_components (
  id                uuid primary key default gen_random_uuid(),
  assembly_id       uuid not null references public.catalog_items (id) on delete cascade,
  component_item_id uuid not null references public.catalog_items (id) on delete restrict,
  qty_per           numeric(14, 4) not null,
  waste_factor      numeric(6, 4) not null default 0,
  created_by        uuid references auth.users (id),
  created_at        timestamptz not null default now(),
  constraint cac_qty_per_positive check (qty_per > 0),
  constraint cac_waste_nonneg check (waste_factor >= 0),
  constraint cac_no_self_ref check (assembly_id <> component_item_id),
  constraint cac_unique_component unique (assembly_id, component_item_id)
);

create index cac_assembly_idx on public.catalog_assembly_components (assembly_id);
create index cac_component_idx on public.catalog_assembly_components (component_item_id);

alter table public.catalog_assembly_components enable row level security;
revoke all on public.catalog_assembly_components from anon, authenticated;
grant select on public.catalog_assembly_components to authenticated;

create policy "catalog_assembly_components readable by authenticated"
  on public.catalog_assembly_components for select to authenticated
  using (true);

comment on table public.catalog_assembly_components is
  'Spec 238 (ADR 0066 D7) — the OPTIONAL bill of materials for a kind=assembly catalog item. qty_per per one assembly + waste_factor. No BOM = opaque priced black box (a ชุด line); with a BOM = explodable via explode_assembly (computed-on-read, D5). Read to authenticated; written via add/update/remove_assembly_component (definer).';

-- 2. Write RPCs --------------------------------------------------------------

create function public.add_assembly_component(
  p_assembly_id       uuid,
  p_component_item_id uuid,
  p_qty_per           numeric,
  p_waste_factor      numeric default 0
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role  text := public.current_user_role()::text;
  v_kind  text;
  v_waste numeric := coalesce(p_waste_factor, 0);
  v_id    uuid;
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'add_assembly_component: role not permitted' using errcode = '42501';
  end if;
  if p_assembly_id = p_component_item_id then
    raise exception 'add_assembly_component: an assembly cannot contain itself' using errcode = '22023';
  end if;
  select kind::text into v_kind from public.catalog_items where id = p_assembly_id;
  if not found then
    raise exception 'add_assembly_component: unknown assembly' using errcode = '22023';
  end if;
  if v_kind <> 'assembly' then
    raise exception 'add_assembly_component: parent is not an assembly' using errcode = '22023';
  end if;
  if not exists (select 1 from public.catalog_items where id = p_component_item_id) then
    raise exception 'add_assembly_component: unknown component item' using errcode = '22023';
  end if;
  if p_qty_per is null or p_qty_per <= 0 then
    raise exception 'add_assembly_component: qty_per must be > 0' using errcode = '22023';
  end if;
  if v_waste < 0 then
    raise exception 'add_assembly_component: waste_factor must be >= 0' using errcode = '22023';
  end if;

  insert into public.catalog_assembly_components
      (assembly_id, component_item_id, qty_per, waste_factor, created_by)
    values (p_assembly_id, p_component_item_id, p_qty_per, v_waste, auth.uid())
    returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.add_assembly_component(uuid, uuid, numeric, numeric) from public, anon;
grant execute on function public.add_assembly_component(uuid, uuid, numeric, numeric) to authenticated;
comment on function public.add_assembly_component(uuid, uuid, numeric, numeric) is
  'Spec 238 (ADR 0066 D7) — add a BOM line to a kind=assembly item (pm/super/procurement/director). Returns the new id. Unknown/non-assembly parent, unknown component, self-reference, qty_per<=0, or negative waste → 22023; duplicate (assembly, component) → 23505; null/disallowed role → 42501.';

create function public.update_assembly_component(
  p_id           uuid,
  p_qty_per      numeric,
  p_waste_factor numeric default 0
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role  text := public.current_user_role()::text;
  v_waste numeric := coalesce(p_waste_factor, 0);
  v_n     integer;
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'update_assembly_component: role not permitted' using errcode = '42501';
  end if;
  if p_qty_per is null or p_qty_per <= 0 then
    raise exception 'update_assembly_component: qty_per must be > 0' using errcode = '22023';
  end if;
  if v_waste < 0 then
    raise exception 'update_assembly_component: waste_factor must be >= 0' using errcode = '22023';
  end if;

  update public.catalog_assembly_components
     set qty_per = p_qty_per, waste_factor = v_waste
   where id = p_id;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'update_assembly_component: unknown component' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.update_assembly_component(uuid, numeric, numeric) from public, anon;
grant execute on function public.update_assembly_component(uuid, numeric, numeric) to authenticated;
comment on function public.update_assembly_component(uuid, numeric, numeric) is
  'Spec 238 (ADR 0066 D7) — edit a BOM line''s qty_per/waste_factor by id (pm/super/procurement/director). Unknown id, qty_per<=0, or negative waste → 22023; null/disallowed role → 42501.';

create function public.remove_assembly_component(p_id uuid) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role text := public.current_user_role()::text;
  v_n    integer;
begin
  if v_role is null or v_role not in
       ('project_manager', 'super_admin', 'procurement', 'project_director') then
    raise exception 'remove_assembly_component: role not permitted' using errcode = '42501';
  end if;

  delete from public.catalog_assembly_components where id = p_id;

  get diagnostics v_n = row_count;
  if v_n = 0 then
    raise exception 'remove_assembly_component: unknown component' using errcode = '22023';
  end if;
end;
$$;

revoke all on function public.remove_assembly_component(uuid) from public, anon;
grant execute on function public.remove_assembly_component(uuid) to authenticated;
comment on function public.remove_assembly_component(uuid) is
  'Spec 238 (ADR 0066 D7) — delete a BOM line by id (pm/super/procurement/director; definer-deletes, no table delete grant). Unknown id → 22023; null/disallowed role → 42501.';

-- 3. explode_assembly — COMPUTED-ON-READ (D5). Single-level: the direct BOM lines
--    of the assembly, with effective_qty = qty_per * (1 + waste_factor) * p_qty.
--    SECURITY INVOKER (reads through the caller's RLS); an assembly with no BOM
--    returns zero rows. Nested explosion (a component that is itself an assembly)
--    is a future unit.
create function public.explode_assembly(
  p_assembly_id uuid,
  p_qty         numeric default 1
) returns table (
  component_item_id uuid,
  qty_per           numeric,
  waste_factor      numeric,
  effective_qty     numeric
)
language sql
stable
set search_path = public
as $$
  select c.component_item_id,
         c.qty_per,
         c.waste_factor,
         round(c.qty_per * (1 + c.waste_factor) * coalesce(p_qty, 1), 4) as effective_qty
    from public.catalog_assembly_components c
   where c.assembly_id = p_assembly_id;
$$;

revoke all on function public.explode_assembly(uuid, numeric) from public, anon;
grant execute on function public.explode_assembly(uuid, numeric) to authenticated;
comment on function public.explode_assembly(uuid, numeric) is
  'Spec 238 (ADR 0066 D7 / D5) — COMPUTED-ON-READ explode of an assembly''s direct BOM (single-level): effective_qty = qty_per*(1+waste_factor)*p_qty. SECURITY INVOKER (reads via RLS). No BOM → zero rows. Nested explosion is a future unit.';
