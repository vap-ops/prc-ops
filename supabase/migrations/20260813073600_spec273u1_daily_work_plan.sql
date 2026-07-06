-- Spec 273 U1 / ADR 0076 — แผนพรุ่งนี้: the SA next-day work board (all additive).
--
-- A separate per-(project, date) daily-plan layer. The Site Admin authors, at
-- end of day, the list of tomorrow's งานย่อย with a flexible per-leaf crew (one
-- optional หัวหน้า). This NEVER writes work_packages.planned_* or the spec-271
-- baselines — operational intent, not the committed schedule (ADR 0076 D1).
--
-- ACCESS POSTURE. Not money, not append-only (plans are mutable operational
-- data): RLS SELECT via can_see_project; ZERO write grant for authenticated —
-- every mutation goes through the 5 SECURITY DEFINER RPCs below, gated on
-- {site_admin, project_manager, project_director, super_admin, site_owner} AND
-- can_see_project membership (ADR 0076 D2/D5 — SA gains daily-plan write only,
-- never the master-schedule date authority reserved to PM/super/site_owner).
-- Leaf-only + same-project binding is enforced by a validation trigger (spec
-- 270 wp_reject_group_binding precedent); ≤1 หัวหน้า per item by a partial
-- unique index.

-- =========================================================== tables
create table public.daily_work_plans (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  plan_date  date not null,
  created_by uuid not null references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint daily_work_plans_project_date_unique unique (project_id, plan_date)
);

create table public.daily_work_plan_items (
  id              uuid primary key default gen_random_uuid(),
  plan_id         uuid not null references public.daily_work_plans(id) on delete cascade,
  work_package_id uuid not null references public.work_packages(id),
  note            text null,
  sort_order      integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  constraint daily_work_plan_items_plan_wp_unique unique (plan_id, work_package_id)
);
create index daily_work_plan_items_plan_idx on public.daily_work_plan_items (plan_id);

create table public.daily_work_plan_crew (
  id         uuid primary key default gen_random_uuid(),
  item_id    uuid not null references public.daily_work_plan_items(id) on delete cascade,
  worker_id  uuid not null references public.workers(id),
  is_lead    boolean not null default false,
  created_at timestamptz not null default now(),
  constraint daily_work_plan_crew_item_worker_unique unique (item_id, worker_id)
);
create index daily_work_plan_crew_item_idx on public.daily_work_plan_crew (item_id);
-- At most one หัวหน้า per item.
create unique index daily_work_plan_crew_one_lead
  on public.daily_work_plan_crew (item_id) where is_lead;

-- =========================================================== updated_at
create trigger daily_work_plans_set_updated_at
  before update on public.daily_work_plans
  for each row execute function public.set_updated_at();
create trigger daily_work_plan_items_set_updated_at
  before update on public.daily_work_plan_items
  for each row execute function public.set_updated_at();

-- =========================================================== leaf + same-project guard
-- Mirrors spec 270's wp_reject_group_binding, but also asserts the leaf lives in
-- the board's project — the item may only bind a งานย่อย of its own project.
create function public.daily_work_plan_items_validate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_group     boolean;
  v_wp_project   uuid;
  v_plan_project uuid;
begin
  select is_group, project_id into v_is_group, v_wp_project
    from public.work_packages where id = new.work_package_id;
  if not found then
    raise exception 'daily_work_plan_items: unknown work package %', new.work_package_id
      using errcode = '22023';
  end if;
  if v_is_group then
    raise exception 'daily_work_plan_items: WP % is a งาน group — a board plans งานย่อย',
      new.work_package_id using errcode = '22023';
  end if;
  select project_id into v_plan_project
    from public.daily_work_plans where id = new.plan_id;
  if v_wp_project <> v_plan_project then
    raise exception 'daily_work_plan_items: WP % is not in the board''s project',
      new.work_package_id using errcode = '22023';
  end if;
  return new;
end;
$$;

create trigger daily_work_plan_items_validate_trg
  before insert or update on public.daily_work_plan_items
  for each row execute function public.daily_work_plan_items_validate();

-- =========================================================== RLS (SELECT only)
alter table public.daily_work_plans      enable row level security;
alter table public.daily_work_plan_items enable row level security;
alter table public.daily_work_plan_crew  enable row level security;

revoke all on public.daily_work_plans      from anon, authenticated;
revoke all on public.daily_work_plan_items from anon, authenticated;
revoke all on public.daily_work_plan_crew  from anon, authenticated;

grant select on public.daily_work_plans      to authenticated;
grant select on public.daily_work_plan_items to authenticated;
grant select on public.daily_work_plan_crew  to authenticated;

create policy "daily work plans readable in visible projects"
  on public.daily_work_plans for select
  to authenticated
  using (public.can_see_project(project_id));

create policy "daily work plan items readable in visible projects"
  on public.daily_work_plan_items for select
  to authenticated
  using (exists (
    select 1 from public.daily_work_plans p
     where p.id = plan_id and public.can_see_project(p.project_id)
  ));

create policy "daily work plan crew readable in visible projects"
  on public.daily_work_plan_crew for select
  to authenticated
  using (exists (
    select 1 from public.daily_work_plan_items i
      join public.daily_work_plans p on p.id = i.plan_id
     where i.id = item_id and public.can_see_project(p.project_id)
  ));

-- =========================================================== writer gate (private)
-- Every mutation RPC funnels through this: role in the allowed set AND project
-- membership. Internal — called only from the definer RPCs (owner context);
-- authenticated never invokes it directly.
create function public.daily_work_plan_assert_writer(p_project uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_role public.user_role := public.current_user_role();
begin
  if not coalesce(v_role in
      ('site_admin', 'project_manager', 'project_director', 'super_admin', 'site_owner'),
      false) then
    raise exception 'daily work plan: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_project(p_project) then
    raise exception 'daily work plan: not a member of this project' using errcode = '42501';
  end if;
end;
$$;
revoke all on function public.daily_work_plan_assert_writer(uuid) from public;

-- =========================================================== RPC 1: add item (lazy-upsert board)
create function public.add_daily_plan_item(p_project uuid, p_date date, p_wp uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_is_group   boolean;
  v_wp_project uuid;
  v_plan_id    uuid;
  v_item_id    uuid;
begin
  perform public.daily_work_plan_assert_writer(p_project);

  -- Validate the WP up front so a bad add never leaves an empty board row.
  select is_group, project_id into v_is_group, v_wp_project
    from public.work_packages where id = p_wp;
  if not found then
    raise exception 'add_daily_plan_item: unknown work package' using errcode = 'P0001';
  end if;
  if v_is_group then
    raise exception 'add_daily_plan_item: a งาน group cannot be planned' using errcode = '22023';
  end if;
  if v_wp_project <> p_project then
    raise exception 'add_daily_plan_item: work package is not in this project'
      using errcode = '22023';
  end if;

  insert into public.daily_work_plans (project_id, plan_date, created_by)
    values (p_project, p_date, auth.uid())
    on conflict (project_id, plan_date) do update set updated_at = now()
    returning id into v_plan_id;

  insert into public.daily_work_plan_items (plan_id, work_package_id)
    values (v_plan_id, p_wp)
    on conflict (plan_id, work_package_id) do nothing
    returning id into v_item_id;

  if v_item_id is null then  -- already on the board (idempotent)
    select id into v_item_id from public.daily_work_plan_items
      where plan_id = v_plan_id and work_package_id = p_wp;
  end if;
  return v_item_id;
end;
$$;
grant execute on function public.add_daily_plan_item(uuid, date, uuid) to authenticated;

-- =========================================================== RPC 2: remove item
create function public.remove_daily_plan_item(p_item uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project uuid;
begin
  select p.project_id into v_project
    from public.daily_work_plan_items i
    join public.daily_work_plans p on p.id = i.plan_id
   where i.id = p_item;
  if not found then
    raise exception 'remove_daily_plan_item: unknown item' using errcode = 'P0001';
  end if;
  perform public.daily_work_plan_assert_writer(v_project);
  delete from public.daily_work_plan_items where id = p_item;  -- crew cascades
end;
$$;
grant execute on function public.remove_daily_plan_item(uuid) to authenticated;

-- =========================================================== RPC 3: set note
create function public.set_daily_plan_item_note(p_item uuid, p_note text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project uuid;
begin
  select p.project_id into v_project
    from public.daily_work_plan_items i
    join public.daily_work_plans p on p.id = i.plan_id
   where i.id = p_item;
  if not found then
    raise exception 'set_daily_plan_item_note: unknown item' using errcode = 'P0001';
  end if;
  perform public.daily_work_plan_assert_writer(v_project);
  update public.daily_work_plan_items set note = p_note where id = p_item;
end;
$$;
grant execute on function public.set_daily_plan_item_note(uuid, text) to authenticated;

-- =========================================================== RPC 4: reorder
create function public.reorder_daily_plan_items(p_plan uuid, p_item_ids uuid[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project uuid;
begin
  select project_id into v_project from public.daily_work_plans where id = p_plan;
  if not found then
    raise exception 'reorder_daily_plan_items: unknown board' using errcode = 'P0001';
  end if;
  perform public.daily_work_plan_assert_writer(v_project);
  update public.daily_work_plan_items i
     set sort_order = arr.ord
    from (
      select id, (ordinality - 1)::int as ord
        from unnest(p_item_ids) with ordinality as t(id, ordinality)
    ) arr
   where i.id = arr.id and i.plan_id = p_plan;
end;
$$;
grant execute on function public.reorder_daily_plan_items(uuid, uuid[]) to authenticated;

-- =========================================================== RPC 5: set crew (replace set)
create function public.set_daily_plan_item_crew(p_item uuid, p_worker_ids uuid[], p_lead uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project uuid;
begin
  select p.project_id into v_project
    from public.daily_work_plan_items i
    join public.daily_work_plans p on p.id = i.plan_id
   where i.id = p_item;
  if not found then
    raise exception 'set_daily_plan_item_crew: unknown item' using errcode = 'P0001';
  end if;
  perform public.daily_work_plan_assert_writer(v_project);

  if p_lead is not null and not (p_lead = any(p_worker_ids)) then
    raise exception 'set_daily_plan_item_crew: the หัวหน้า must be one of the crew'
      using errcode = '22023';
  end if;

  delete from public.daily_work_plan_crew where item_id = p_item;
  insert into public.daily_work_plan_crew (item_id, worker_id, is_lead)
    select p_item, w, coalesce(w = p_lead, false)
      from unnest(p_worker_ids) as w;
end;
$$;
grant execute on function public.set_daily_plan_item_crew(uuid, uuid[], uuid) to authenticated;

-- =========================================================== comments
comment on table public.daily_work_plans is
  'Spec 273 / ADR 0076: one next-day work board per (project, plan_date). Operational intent — never the master schedule/baselines. SA-writable via RPC.';
comment on table public.daily_work_plan_items is
  'Spec 273: a งานย่อย (leaf-only, same-project) planned for the board''s date. Mutable; sort_order for SA ordering.';
comment on table public.daily_work_plan_crew is
  'Spec 273: flexible per-item crew (any number of ช่าง); is_lead marks the one หัวหน้า (partial-unique). Seeds tomorrow''s labor one-tap; labor_logs stays source of truth.';
