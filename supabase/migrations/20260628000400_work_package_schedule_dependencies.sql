-- Spec 92 Unit A — WP schedule + dependencies (the critical-path foundation).
-- Manual, in-app: PM/super set each WP's planned window and the finish-to-start
-- dependencies between WPs. is_critical is computed on read (CPM in TS), so no
-- stored flag/trigger here. Writes go through SECURITY DEFINER RPCs (PM/super
-- only) that enforce same-project + no-cycle, mirroring set_work_package_contractor
-- (ADR 0033 / ADR 0011: search_path pinned, revoke-then-grant execute).

-- 1. Planned window on work_packages (nullable; unscheduled WPs are off-timeline).
alter table public.work_packages
  add column planned_start date,
  add column planned_end   date,
  add constraint work_packages_planned_window_ck
    check (planned_start is null or planned_end is null or planned_end >= planned_start);

comment on column public.work_packages.planned_start is
  'PM/super-set planned start (spec 92). The Gantt bar start; null = unscheduled.';
comment on column public.work_packages.planned_end is
  'PM/super-set planned end (spec 92). The Gantt bar end; null = unscheduled.';

-- 2. Finish-to-start dependencies between WPs (predecessor finishes before
--    successor starts). The edge set the critical-path pass runs over.
create table public.work_package_dependencies (
  id             uuid primary key default gen_random_uuid(),
  predecessor_id uuid not null references public.work_packages(id) on delete cascade,
  successor_id   uuid not null references public.work_packages(id) on delete cascade,
  created_by     uuid references auth.users(id),
  created_at     timestamptz not null default now(),
  constraint wp_dependencies_unique unique (predecessor_id, successor_id),
  constraint wp_dependencies_no_self check (predecessor_id <> successor_id)
);

create index work_package_dependencies_predecessor_idx
  on public.work_package_dependencies (predecessor_id);
create index work_package_dependencies_successor_idx
  on public.work_package_dependencies (successor_id);

-- 3. RLS — staff read; writes ONLY through the definer RPCs below (no direct
--    INSERT/DELETE policy or grant), so the cycle / same-project checks cannot
--    be bypassed.
alter table public.work_package_dependencies enable row level security;

create policy "wp_dependencies readable by privileged roles"
  on public.work_package_dependencies for select
  using (public.current_user_role() in ('site_admin', 'project_manager', 'super_admin'));

grant select on public.work_package_dependencies to authenticated;

-- 4. Schedule setter (PM/super). Nulls clear the window.
create function public.set_work_package_schedule(
  p_work_package_id uuid,
  p_start date,
  p_end   date
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'set_work_package_schedule: role not permitted' using errcode = '42501';
  end if;
  if p_start is not null and p_end is not null and p_end < p_start then
    return false;
  end if;
  update public.work_packages
     set planned_start = p_start, planned_end = p_end
   where id = p_work_package_id;
  return found;
end;
$$;

revoke all on function public.set_work_package_schedule(uuid, date, date) from public, anon;
grant execute on function public.set_work_package_schedule(uuid, date, date) to authenticated;

-- 5. Add a finish-to-start dependency (PM/super). Rejects self, cross-project,
--    and any edge that would close a cycle.
create function public.add_work_package_dependency(
  p_predecessor uuid,
  p_successor   uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'add_work_package_dependency: role not permitted' using errcode = '42501';
  end if;

  if p_predecessor = p_successor then
    return false;
  end if;

  -- both WPs must exist and share a project.
  if not exists (
    select 1 from public.work_packages a
      join public.work_packages b on a.project_id = b.project_id
     where a.id = p_predecessor and b.id = p_successor
  ) then
    return false;
  end if;

  -- cycle guard: reject if the successor can already reach the predecessor
  -- (adding predecessor -> successor would close a loop).
  if exists (
    with recursive reach as (
      select successor_id as node
        from public.work_package_dependencies
       where predecessor_id = p_successor
      union
      select d.successor_id
        from public.work_package_dependencies d
        join reach r on d.predecessor_id = r.node
    )
    select 1 from reach where node = p_predecessor
  ) then
    return false;
  end if;

  insert into public.work_package_dependencies (predecessor_id, successor_id, created_by)
  values (p_predecessor, p_successor, auth.uid())
  on conflict (predecessor_id, successor_id) do nothing;
  return true;
end;
$$;

revoke all on function public.add_work_package_dependency(uuid, uuid) from public, anon;
grant execute on function public.add_work_package_dependency(uuid, uuid) to authenticated;

-- 6. Remove a dependency (PM/super).
create function public.remove_work_package_dependency(
  p_predecessor uuid,
  p_successor   uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'remove_work_package_dependency: role not permitted' using errcode = '42501';
  end if;
  delete from public.work_package_dependencies
   where predecessor_id = p_predecessor and successor_id = p_successor;
  return found;
end;
$$;

revoke all on function public.remove_work_package_dependency(uuid, uuid) from public, anon;
grant execute on function public.remove_work_package_dependency(uuid, uuid) to authenticated;
