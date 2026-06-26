-- Spec 207 U1 / feedback 1a556584 — project_categories: a per-PROJECT,
-- operator-defined work-category taxonomy (หมวดงาน). A TABLE, not an enum
-- (ADR 0055 dec.2): each project has its OWN set and operators add categories at
-- runtime, so a global enum (ALTER TYPE + ADR per add) is the wrong tool. Models
-- equipment_categories (table-not-enum) wedded to the deliverables/supply_plans
-- per-project scoping.
--
-- Reads: project members only (can_see_project, ADR 0056). Writes: DEFINER RPCs
-- only — chosen over equipment_categories-style direct RLS writes because
-- categories need the same-project + can_see_project gate that firm-wide
-- equipment_categories does not. NO delete (deactivate-not-delete via is_active,
-- the catalog_items / masters-no-delete convention). The name column IS the label
-- (operator-authored Thai); no labels.ts Record. Strictly additive — new table,
-- new RPCs, one new SELECT policy; no enum, no destructive change.

create table public.project_categories (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.projects(id) on delete cascade,
  code        text not null,
  name        text not null,
  sort_order  integer not null,
  is_active   boolean not null default true,
  created_by  uuid not null references public.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint project_categories_code_uniq unique (project_id, code),
  constraint project_categories_name_nonblank check (length(trim(name)) > 0),
  constraint project_categories_name_cap check (length(name) <= 120)
);

create index project_categories_project_id_idx on public.project_categories (project_id);

-- updated_at maintenance — reuse the shared trigger function (do NOT redefine).
create trigger project_categories_set_updated_at
  before update on public.project_categories
  for each row execute function public.set_updated_at();

alter table public.project_categories enable row level security;
revoke all on public.project_categories from anon, authenticated;
grant select on public.project_categories to authenticated;

-- Internal read: project-membership gate (the deliverables/reports precedent).
-- Scalar-subselect wrapped so can_see_project evaluates once per row (pgTAP 40).
create policy "project_categories readable by project members"
  on public.project_categories for select to authenticated
  using ((select public.can_see_project(project_id)));

-- NO insert/update/delete grant or policy: every write goes through the DEFINER
-- RPCs below (they run as owner, so they need no table grant). Deactivate, never
-- delete.

comment on table public.project_categories is
  'Spec 207 — per-project work-category taxonomy (หมวดงาน). Read by project members; written only via the create/update/reorder/set-active DEFINER RPCs. Deactivate-not-delete. The name column is the operator-authored Thai label.';

-- ----------------------------------------------------------------------------
-- Write RPCs — all SECURITY DEFINER, NULL-SAFE role gate (pm/super/director),
-- can_see_project membership gate, revoke from public AND anon. The
-- `v_role is null or v_role not in (...)` shape + revoke-from-anon close the
-- Supabase default-anon-EXECUTE hole (the 20260813002300/002500 hardening); a
-- bare `not in (...)` is NULL-unsafe (NULL not in (...) is NULL → falls through).
-- The role array always includes super_admin + project_director so the see-all
-- roles are never locked out (ADR 0058 / pgTAP 90).
-- ----------------------------------------------------------------------------

create function public.create_project_category(
  p_project_id uuid,
  p_code       text,
  p_name       text,
  p_sort_order integer
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role := (select public.current_user_role());
  v_code text := btrim(p_code);
  v_name text := btrim(p_name);
  v_id   uuid;
begin
  if v_role is null or v_role not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'create_project_category: role not permitted' using errcode = '42501';
  end if;
  -- Membership gate (project is a param here).
  if not (select public.can_see_project(p_project_id)) then
    raise exception 'create_project_category: not a member of this project' using errcode = '42501';
  end if;
  if v_code = '' or length(v_code) > 40 then
    raise exception 'create_project_category: code required (<=40)' using errcode = '22023';
  end if;
  if v_name = '' or length(v_name) > 120 then
    raise exception 'create_project_category: name required (<=120)' using errcode = '22023';
  end if;

  insert into public.project_categories (project_id, code, name, sort_order, created_by)
    values (p_project_id, v_code, v_name, coalesce(p_sort_order, 0), (select auth.uid()))
    returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.create_project_category(uuid, text, text, integer) from public, anon;
grant execute on function public.create_project_category(uuid, text, text, integer) to authenticated;

comment on function public.create_project_category(uuid, text, text, integer) is
  'Spec 207 U1 — create a per-project work-category (pm/super/director, membership-gated). Trims code/name; unique (project_id, code) → 23505; blank/oversize → 22023. Returns the new id.';

create function public.update_project_category(
  p_id         uuid,
  p_name       text,
  p_sort_order integer
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role       public.user_role := (select public.current_user_role());
  v_project_id uuid;
  v_name       text := btrim(p_name);
begin
  if v_role is null or v_role not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'update_project_category: role not permitted' using errcode = '42501';
  end if;
  select project_id into v_project_id from public.project_categories where id = p_id;
  if not found then
    raise exception 'update_project_category: unknown category' using errcode = '22023';
  end if;
  if not (select public.can_see_project(v_project_id)) then
    raise exception 'update_project_category: not a member of this project' using errcode = '42501';
  end if;
  if v_name = '' or length(v_name) > 120 then
    raise exception 'update_project_category: name required (<=120)' using errcode = '22023';
  end if;

  -- Rename / reorder only; bindings by id are untouched. updated_at via trigger.
  update public.project_categories
     set name = v_name, sort_order = coalesce(p_sort_order, sort_order)
   where id = p_id;
end;
$$;

revoke all on function public.update_project_category(uuid, text, integer) from public, anon;
grant execute on function public.update_project_category(uuid, text, integer) to authenticated;

comment on function public.update_project_category(uuid, text, integer) is
  'Spec 207 U1 — rename/reorder a work-category (pm/super/director, membership-gated). Unknown id → 22023; blank/oversize name → 22023.';

create function public.reorder_project_categories(
  p_project_id uuid,
  p_ids        uuid[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role := (select public.current_user_role());
begin
  if v_role is null or v_role not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'reorder_project_categories: role not permitted' using errcode = '42501';
  end if;
  if not (select public.can_see_project(p_project_id)) then
    raise exception 'reorder_project_categories: not a member of this project' using errcode = '42501';
  end if;

  -- Assign sort_order by array ordinality. The project_id guard means ids that
  -- do not belong to this project are silently skipped (never cross-project).
  update public.project_categories pc
     set sort_order = u.ord
    from unnest(p_ids) with ordinality as u(id, ord)
   where pc.id = u.id and pc.project_id = p_project_id;
end;
$$;

revoke all on function public.reorder_project_categories(uuid, uuid[]) from public, anon;
grant execute on function public.reorder_project_categories(uuid, uuid[]) to authenticated;

comment on function public.reorder_project_categories(uuid, uuid[]) is
  'Spec 207 U1 — bulk reassign sort_order by array ordinality (pm/super/director, membership-gated). Ids outside the project are skipped.';

create function public.set_project_category_active(
  p_id        uuid,
  p_is_active boolean
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role       public.user_role := (select public.current_user_role());
  v_project_id uuid;
begin
  if v_role is null or v_role not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'set_project_category_active: role not permitted' using errcode = '42501';
  end if;
  select project_id into v_project_id from public.project_categories where id = p_id;
  if not found then
    raise exception 'set_project_category_active: unknown category' using errcode = '22023';
  end if;
  if not (select public.can_see_project(v_project_id)) then
    raise exception 'set_project_category_active: not a member of this project' using errcode = '42501';
  end if;

  update public.project_categories
     set is_active = coalesce(p_is_active, is_active)
   where id = p_id;
end;
$$;

revoke all on function public.set_project_category_active(uuid, boolean) from public, anon;
grant execute on function public.set_project_category_active(uuid, boolean) to authenticated;

comment on function public.set_project_category_active(uuid, boolean) is
  'Spec 207 U1 — deactivate/restore a work-category (pm/super/director, membership-gated). Deactivate-not-delete: bindings + drawings remain. Unknown id → 22023.';
