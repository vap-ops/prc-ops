-- Spec 306 U2 — morning-talk scan muster: schema + DEFINER RPCs.
-- Scan layer = raw truth (teams, membership, in/out timestamps, team→WP set);
-- money is DERIVED later (U5) — nothing here writes labor_logs or touches pay.
-- Reads = can_see_project; writes ONLY via DEFINER RPCs gated site_admin/super_admin
-- (RPC-as-validator; no insert/update/delete grant to authenticated).
-- 229/279 lessons: revoke-from-anon on every RPC; null-safe gates.

-- 1. Scan-method enum.
create type public.muster_method as enum ('qr', 'manual');

-- 2. Tables.
create table public.muster_teams (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.projects(id) on delete cascade,
  work_date      date not null,
  lead_worker_id uuid not null references public.workers(id),
  created_by     uuid not null,
  created_at     timestamptz not null default now(),
  unique (project_id, work_date, lead_worker_id)
);

-- Team→WP assignment (the Site-Owner morning announcement). Rows are MAIN WPs
-- (parent_id is null) by convention; a sub-WP row is an explicit override that
-- excludes that sub WP from parent inheritance (spec 306 main-WP grain rule).
-- Inheritance is computed at read time, never stored.
create table public.muster_team_wps (
  team_id         uuid not null references public.muster_teams(id) on delete cascade,
  work_package_id uuid not null references public.work_packages(id) on delete cascade,
  primary key (team_id, work_package_id)
);

-- One attendance row per worker per day; moving teams UPDATEs team_id (audited),
-- never a second row.
create table public.muster_attendance (
  id         uuid primary key default gen_random_uuid(),
  team_id    uuid not null references public.muster_teams(id) on delete cascade,
  worker_id  uuid not null references public.workers(id),
  work_date  date not null,
  in_at      timestamptz not null default now(),
  in_method  public.muster_method not null,
  out_at     timestamptz,
  out_method public.muster_method,
  out_auto   boolean not null default false,
  ot_hours   numeric,
  scanned_by uuid not null,
  note       text,
  unique (worker_id, work_date)
);
create index muster_attendance_team_idx on public.muster_attendance (team_id);

create table public.muster_day_closures (
  project_id uuid not null references public.projects(id) on delete cascade,
  work_date  date not null,
  closed_at  timestamptz not null default now(),
  closed_by  uuid not null,
  primary key (project_id, work_date)
);

-- 3. RLS + grants: select-only for authenticated (scoped), full for service_role.
alter table public.muster_teams        enable row level security;
alter table public.muster_team_wps     enable row level security;
alter table public.muster_attendance   enable row level security;
alter table public.muster_day_closures enable row level security;

revoke all on public.muster_teams, public.muster_team_wps,
              public.muster_attendance, public.muster_day_closures
  from anon, authenticated;
grant select on public.muster_teams, public.muster_team_wps,
                public.muster_attendance, public.muster_day_closures
  to authenticated;
grant select, insert, update, delete
  on public.muster_teams, public.muster_team_wps,
     public.muster_attendance, public.muster_day_closures
  to service_role;

create policy "muster teams readable in visible projects" on public.muster_teams
  for select to authenticated
  using (public.can_see_project(project_id));
create policy "muster team wps readable in visible projects" on public.muster_team_wps
  for select to authenticated
  using (exists (
    select 1 from public.muster_teams t
     where t.id = team_id and public.can_see_project(t.project_id)));
create policy "muster attendance readable in visible projects" on public.muster_attendance
  for select to authenticated
  using (exists (
    select 1 from public.muster_teams t
     where t.id = team_id and public.can_see_project(t.project_id)));
create policy "muster closures readable in visible projects" on public.muster_day_closures
  for select to authenticated
  using (public.can_see_project(project_id));

-- 4. open_muster_team — idempotent per (project, date, lead).
create function public.open_muster_team(p_project uuid, p_date date, p_lead_worker uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_role public.user_role := public.current_user_role();
  v_id   uuid;
begin
  if v_role is null or v_role not in ('site_admin', 'super_admin') then
    raise exception 'open_muster_team: role not permitted' using errcode = '42501';
  end if;
  if p_project is null or p_date is null or p_lead_worker is null then
    raise exception 'open_muster_team: project, date and lead worker are required' using errcode = 'P0001';
  end if;
  if not public.can_see_project(p_project) then
    raise exception 'open_muster_team: not a member of this project' using errcode = '42501';
  end if;
  if not exists (select 1 from public.workers w where w.id = p_lead_worker) then
    raise exception 'open_muster_team: unknown lead worker' using errcode = 'P0001';
  end if;

  insert into public.muster_teams as t (project_id, work_date, lead_worker_id, created_by)
  values (p_project, p_date, p_lead_worker, auth.uid())
  on conflict (project_id, work_date, lead_worker_id)
  do update set lead_worker_id = excluded.lead_worker_id
  returning t.id into v_id;
  return v_id;
end; $$;
revoke all on function public.open_muster_team(uuid, date, uuid) from public;
revoke execute on function public.open_muster_team(uuid, date, uuid) from anon;
grant execute on function public.open_muster_team(uuid, date, uuid) to authenticated;

-- 5. muster_scan_in — presence + membership in one gesture. Same-team re-scan is a
--    no-op returning the existing row; another-team conflict errors — revealing the
--    other lead's name ONLY when the caller may see that team's project (else a
--    generic message; a worker may be mustered in a project this SA cannot see).
create function public.muster_scan_in(p_team uuid, p_worker uuid, p_method public.muster_method)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_role      public.user_role := public.current_user_role();
  v_team      public.muster_teams%rowtype;
  v_existing  public.muster_attendance%rowtype;
  v_other     text;
  v_other_prj uuid;
  v_id        uuid;
begin
  if v_role is null or v_role not in ('site_admin', 'super_admin') then
    raise exception 'muster_scan_in: role not permitted' using errcode = '42501';
  end if;
  select * into v_team from public.muster_teams where id = p_team;
  if not found then
    raise exception 'muster_scan_in: team not found' using errcode = 'P0001';
  end if;
  if not public.can_see_project(v_team.project_id) then
    raise exception 'muster_scan_in: not a member of this project' using errcode = '42501';
  end if;
  if p_method is null then
    raise exception 'muster_scan_in: method required' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.workers w where w.id = p_worker) then
    raise exception 'muster_scan_in: unknown worker' using errcode = 'P0001';
  end if;

  select * into v_existing from public.muster_attendance
   where worker_id = p_worker and work_date = v_team.work_date;
  if found then
    if v_existing.team_id = p_team then
      return v_existing.id;
    end if;
    select t.project_id, w.name into v_other_prj, v_other
      from public.muster_teams t
      join public.workers w on w.id = t.lead_worker_id
     where t.id = v_existing.team_id;
    if v_other_prj is not null and public.can_see_project(v_other_prj) then
      raise exception 'muster_scan_in: worker already in team of % today', coalesce(v_other, '?')
        using errcode = 'P0001';
    else
      raise exception 'muster_scan_in: worker is already mustered elsewhere today'
        using errcode = 'P0001';
    end if;
  end if;

  -- Guard the concurrent-scan race (two phones, same worker+date): the unique
  -- (worker_id, work_date) constraint is the backstop; surface the friendly conflict.
  begin
    insert into public.muster_attendance (team_id, worker_id, work_date, in_method, scanned_by)
    values (p_team, p_worker, v_team.work_date, p_method, auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'muster_scan_in: worker already mustered today (concurrent scan)' using errcode = 'P0001';
  end;
  return v_id;
end; $$;
revoke all on function public.muster_scan_in(uuid, uuid, public.muster_method) from public;
revoke execute on function public.muster_scan_in(uuid, uuid, public.muster_method) from anon;
grant execute on function public.muster_scan_in(uuid, uuid, public.muster_method) to authenticated;

-- 6. muster_scan_out — stamps out_at; OT = hours past 17:00 Asia/Bangkok on the
--    team's work_date, floored to 0.5h steps (conservative), null when none.
--    Re-scan-out is allowed: the last scan wins (out_at + OT recomputed).
create function public.muster_scan_out(p_team uuid, p_worker uuid, p_method public.muster_method)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_role    public.user_role := public.current_user_role();
  v_team    public.muster_teams%rowtype;
  v_att     public.muster_attendance%rowtype;
  v_day_end timestamptz;
  v_ot      numeric;
begin
  if v_role is null or v_role not in ('site_admin', 'super_admin') then
    raise exception 'muster_scan_out: role not permitted' using errcode = '42501';
  end if;
  select * into v_team from public.muster_teams where id = p_team;
  if not found then
    raise exception 'muster_scan_out: team not found' using errcode = 'P0001';
  end if;
  if not public.can_see_project(v_team.project_id) then
    raise exception 'muster_scan_out: not a member of this project' using errcode = '42501';
  end if;
  if p_method is null then
    raise exception 'muster_scan_out: method required' using errcode = 'P0001';
  end if;

  select * into v_att from public.muster_attendance
   where worker_id = p_worker and work_date = v_team.work_date;
  if not found then
    raise exception 'muster_scan_out: no attendance for this worker on the team''s date' using errcode = 'P0001';
  end if;
  if v_att.team_id is distinct from p_team then
    raise exception 'muster_scan_out: worker is in another team today — move first' using errcode = 'P0001';
  end if;

  -- v1 standard day end = 17:00 Asia/Bangkok (spec 306 U4; per-project config = YAGNI).
  v_day_end := (v_team.work_date + time '17:00') at time zone 'Asia/Bangkok';
  v_ot := floor((extract(epoch from (now() - v_day_end)) / 3600.0) * 2) / 2;
  if v_ot <= 0 then
    v_ot := null;
  end if;

  update public.muster_attendance
     set out_at = now(), out_method = p_method, ot_hours = v_ot, out_auto = false
   where id = v_att.id;
  return v_att.id;
end; $$;
revoke all on function public.muster_scan_out(uuid, uuid, public.muster_method) from public;
revoke execute on function public.muster_scan_out(uuid, uuid, public.muster_method) from anon;
grant execute on function public.muster_scan_out(uuid, uuid, public.muster_method) to authenticated;

-- 7. set_muster_team_wps — replaces the team's WP set (the announcement record).
--    Every WP must belong to the team's project; empty array clears the set.
create function public.set_muster_team_wps(p_team uuid, p_wp_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v_role public.user_role := public.current_user_role();
  v_team public.muster_teams%rowtype;
begin
  if v_role is null or v_role not in ('site_admin', 'super_admin') then
    raise exception 'set_muster_team_wps: role not permitted' using errcode = '42501';
  end if;
  select * into v_team from public.muster_teams where id = p_team;
  if not found then
    raise exception 'set_muster_team_wps: team not found' using errcode = 'P0001';
  end if;
  if not public.can_see_project(v_team.project_id) then
    raise exception 'set_muster_team_wps: not a member of this project' using errcode = '42501';
  end if;
  if p_wp_ids is null then
    raise exception 'set_muster_team_wps: WP id array required (empty array clears)' using errcode = 'P0001';
  end if;
  if exists (
    select 1 from unnest(p_wp_ids) as x(id)
     where not exists (
       select 1 from public.work_packages w
        where w.id = x.id and w.project_id = v_team.project_id)) then
    raise exception 'set_muster_team_wps: every WP must belong to the team''s project' using errcode = 'P0001';
  end if;

  delete from public.muster_team_wps
   where team_id = p_team and not (work_package_id = any (p_wp_ids));
  insert into public.muster_team_wps (team_id, work_package_id)
  select p_team, x.id from unnest(p_wp_ids) as x(id)
  on conflict do nothing;
end; $$;
revoke all on function public.set_muster_team_wps(uuid, uuid[]) from public;
revoke execute on function public.set_muster_team_wps(uuid, uuid[]) from anon;
grant execute on function public.set_muster_team_wps(uuid, uuid[]) to authenticated;

-- 8. move_muster_worker — explicit confirmed move (after the scan-in conflict),
--    same project + same date only; audit-logged.
create function public.move_muster_worker(p_worker uuid, p_date date, p_to_team uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_role         public.user_role := public.current_user_role();
  v_to           public.muster_teams%rowtype;
  v_att          public.muster_attendance%rowtype;
  v_from_project uuid;
begin
  if v_role is null or v_role not in ('site_admin', 'super_admin') then
    raise exception 'move_muster_worker: role not permitted' using errcode = '42501';
  end if;
  select * into v_to from public.muster_teams where id = p_to_team;
  if not found then
    raise exception 'move_muster_worker: target team not found' using errcode = 'P0001';
  end if;
  if not public.can_see_project(v_to.project_id) then
    raise exception 'move_muster_worker: not a member of this project' using errcode = '42501';
  end if;
  if v_to.work_date is distinct from p_date then
    raise exception 'move_muster_worker: target team is not for this date' using errcode = 'P0001';
  end if;
  select * into v_att from public.muster_attendance
   where worker_id = p_worker and work_date = p_date;
  if not found then
    raise exception 'move_muster_worker: no attendance for this worker on this date' using errcode = 'P0001';
  end if;
  if v_att.team_id = p_to_team then
    return v_att.id;
  end if;
  select project_id into v_from_project from public.muster_teams where id = v_att.team_id;
  if v_from_project is distinct from v_to.project_id then
    raise exception 'move_muster_worker: cannot move across projects' using errcode = 'P0001';
  end if;

  update public.muster_attendance set team_id = p_to_team where id = v_att.id;
  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('crew_change', auth.uid(), v_role, 'muster_attendance', v_att.id,
          jsonb_build_object('kind', 'muster_move', 'worker_id', p_worker,
                             'work_date', p_date, 'from_team', v_att.team_id,
                             'to_team', p_to_team));
  return v_att.id;
end; $$;
revoke all on function public.move_muster_worker(uuid, date, uuid) from public;
revoke execute on function public.move_muster_worker(uuid, date, uuid) from anon;
grant execute on function public.move_muster_worker(uuid, date, uuid) to authenticated;

-- 9. close_muster_day — auto-out un-out workers at day-end (flagged, NO phantom OT),
--    record the closure. Idempotent: re-close updates the closure stamp (the U5
--    derive + nightly cron backstop key off this).
create function public.close_muster_day(p_project uuid, p_date date)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_role    public.user_role := public.current_user_role();
  v_day_end timestamptz;
begin
  if v_role is null or v_role not in ('site_admin', 'super_admin') then
    raise exception 'close_muster_day: role not permitted' using errcode = '42501';
  end if;
  if p_project is null or p_date is null then
    raise exception 'close_muster_day: project and date are required' using errcode = 'P0001';
  end if;
  if not public.can_see_project(p_project) then
    raise exception 'close_muster_day: not a member of this project' using errcode = '42501';
  end if;

  v_day_end := (p_date + time '17:00') at time zone 'Asia/Bangkok';
  -- Auto-out at day-end, but never before the worker's own in_at (a post-17:00
  -- scan-in would otherwise get out_at < in_at → negative span into the U5 derive).
  update public.muster_attendance a
     set out_at = greatest(v_day_end, a.in_at), out_auto = true
    from public.muster_teams t
   where t.id = a.team_id and t.project_id = p_project
     and a.work_date = p_date and a.out_at is null;

  insert into public.muster_day_closures (project_id, work_date, closed_by)
  values (p_project, p_date, auth.uid())
  on conflict (project_id, work_date)
  do update set closed_at = now(), closed_by = excluded.closed_by;
end; $$;
revoke all on function public.close_muster_day(uuid, date) from public;
revoke execute on function public.close_muster_day(uuid, date) from anon;
grant execute on function public.close_muster_day(uuid, date) to authenticated;
