-- Spec 176 U1 — Supply Plan foundation (the PM-accuracy engine).
--
-- A supply_plan is the PM's material plan for a project: per-WP quantities of
-- catalog items, planned up front. It becomes the FROZEN baseline the later units
-- measure PM accuracy against (planned vs actually issued/reactive). U1 is the
-- data foundation only — one plan per project + its lines + the create/add RPCs.
-- Submit/approve (freeze), the planning UI, and the measurement are later units.
--
-- Posture (mirrors the catalog + deliverables): project-scoped READ via
-- can_see_project (ADR 0056 membership); WRITES go through SECURITY DEFINER RPCs
-- gated to the planner tier (PM/super/director) — the tables have no write grant.
-- Plan lines reference catalog_items (the item identity from spec 175) and an
-- OPTIONAL work_packages row (null = site-general, not tied to one WP).

create type public.supply_plan_status as enum ('draft', 'submitted', 'approved', 'rejected');

create table public.supply_plans (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  status       public.supply_plan_status not null default 'draft',
  note         text,
  created_by   uuid references public.users(id) default auth.uid(),
  created_at   timestamptz not null default now(),
  submitted_at timestamptz,
  approved_by  uuid references public.users(id),
  approved_at  timestamptz,
  -- One plan per project for now (amendments/versioning are a later concern).
  constraint supply_plans_project_unique unique (project_id)
);

alter table public.supply_plans enable row level security;
revoke all on public.supply_plans from anon, authenticated;
grant select on public.supply_plans to authenticated;
-- READ: project viewers (ADR 0056 — super/director/coordinator see all; PM/SA by membership).
create policy "supply_plans readable by project viewers"
  on public.supply_plans for select to authenticated
  using ((select public.can_see_project(project_id)));
-- No write policy — create_supply_plan (definer RPC) is the sole write path.

comment on table public.supply_plans is
  'Spec 176 — a project''s material plan (one per project). Becomes the frozen PM-accuracy baseline; written only via SECURITY DEFINER RPCs.';

create table public.supply_plan_lines (
  id              uuid primary key default gen_random_uuid(),
  supply_plan_id  uuid not null references public.supply_plans(id) on delete cascade,
  catalog_item_id uuid not null references public.catalog_items(id),
  -- null = site-general (not allocated to a specific work package).
  work_package_id uuid references public.work_packages(id) on delete cascade,
  qty             numeric(12, 2) not null,
  note            text,
  created_at      timestamptz not null default now(),
  constraint supply_plan_lines_qty_positive check (qty > 0)
);

-- One allocation per (plan, item, WP) — null WP collapses to a fixed sentinel so a
-- site-general line is still unique per item.
create unique index supply_plan_lines_identity_uniq
  on public.supply_plan_lines (
    supply_plan_id,
    catalog_item_id,
    coalesce(work_package_id, '00000000-0000-0000-0000-000000000000'::uuid)
  );

alter table public.supply_plan_lines enable row level security;
revoke all on public.supply_plan_lines from anon, authenticated;
grant select on public.supply_plan_lines to authenticated;
-- READ: visible to whoever can see the line's plan's project.
create policy "supply_plan_lines readable by project viewers"
  on public.supply_plan_lines for select to authenticated
  using (
    exists (
      select 1 from public.supply_plans sp
       where sp.id = supply_plan_id and public.can_see_project(sp.project_id)
    )
  );

comment on table public.supply_plan_lines is
  'Spec 176 — a planned catalog item + qty for a project, optionally allocated to a work package (null = site-general). Written only via SECURITY DEFINER RPCs.';

-- ----------------------------------------------------------------------------
-- create_supply_plan — get-or-create a project's draft plan (planner tier).
-- ----------------------------------------------------------------------------
create function public.create_supply_plan(p_project_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'create_supply_plan: role not permitted' using errcode = '42501';
  end if;
  -- Membership: PM/SA must be on the project; super/director/coordinator see all.
  if not public.can_see_project(p_project_id) then
    raise exception 'create_supply_plan: not a project member' using errcode = '42501';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception 'create_supply_plan: unknown project' using errcode = '22023';
  end if;

  -- Idempotent: return the existing plan if one already exists for the project.
  select sp.id into v_id from public.supply_plans sp where sp.project_id = p_project_id;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.supply_plans (project_id) values (p_project_id) returning id into v_id;
  return v_id;
end;
$$;

revoke all on function public.create_supply_plan(uuid) from public, anon;
grant execute on function public.create_supply_plan(uuid) to authenticated;

comment on function public.create_supply_plan(uuid) is
  'Spec 176 U1 — get-or-create a project''s supply plan (PM/super/director + project member). Returns the plan id.';

-- ----------------------------------------------------------------------------
-- add_supply_plan_line — add a planned item+qty (+optional WP) to a DRAFT plan.
-- ----------------------------------------------------------------------------
create function public.add_supply_plan_line(
  p_plan_id         uuid,
  p_catalog_item_id uuid,
  p_work_package_id uuid,
  p_qty             numeric,
  p_note            text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id uuid;
  v_status     public.supply_plan_status;
  v_note       text := nullif(btrim(coalesce(p_note, '')), '');
  v_id         uuid;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'add_supply_plan_line: role not permitted' using errcode = '42501';
  end if;

  select sp.project_id, sp.status into v_project_id, v_status
    from public.supply_plans sp where sp.id = p_plan_id;
  if v_project_id is null then
    raise exception 'add_supply_plan_line: unknown plan' using errcode = '22023';
  end if;
  if not public.can_see_project(v_project_id) then
    raise exception 'add_supply_plan_line: not a project member' using errcode = '42501';
  end if;
  -- Only a draft plan is editable; once submitted/approved it is the frozen baseline.
  if v_status <> 'draft' then
    raise exception 'add_supply_plan_line: plan is not editable' using errcode = '22023';
  end if;

  if p_qty is null or p_qty <= 0 then
    raise exception 'add_supply_plan_line: qty must be > 0' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.catalog_items c where c.id = p_catalog_item_id and c.is_active
  ) then
    raise exception 'add_supply_plan_line: unknown or inactive catalog item' using errcode = '22023';
  end if;
  -- If a WP is given it must belong to THIS plan's project.
  if p_work_package_id is not null and not exists (
    select 1 from public.work_packages w
     where w.id = p_work_package_id and w.project_id = v_project_id
  ) then
    raise exception 'add_supply_plan_line: work package not in this project' using errcode = '22023';
  end if;

  insert into public.supply_plan_lines (supply_plan_id, catalog_item_id, work_package_id, qty, note)
  values (p_plan_id, p_catalog_item_id, p_work_package_id, p_qty, v_note)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.add_supply_plan_line(uuid, uuid, uuid, numeric, text) from public, anon;
grant execute on function public.add_supply_plan_line(uuid, uuid, uuid, numeric, text) to authenticated;

comment on function public.add_supply_plan_line(uuid, uuid, uuid, numeric, text) is
  'Spec 176 U1 — add a planned item+qty (+optional WP) to a DRAFT supply plan (planner tier + member). Duplicate (item, WP) → 23505.';
