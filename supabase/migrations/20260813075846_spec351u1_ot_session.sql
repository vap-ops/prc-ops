-- Spec 351 U1 — separate OT muster session.
--
-- Reworks the LIVE spec-306 muster schema so a technician's normal hours and OT
-- are tracked as TWO separate sessions instead of one evening scan derived
-- against a 17:00 threshold:
--   * regular  = 08:00–17:00 (normal hours)
--   * ot       = 17:30–whenever (a second clock-in/out pair)
--
-- Forward-only: muster_attendance holds 13 real pilot rows (2026-07-24), all
-- pre-rework single sessions with ot_hours already null — the new `session`
-- column defaults them all to 'regular', so the go-forward invariant holds with
-- ZERO backfill and the composite unique is satisfied (13 distinct
-- (worker_id, work_date) stay distinct as (worker_id, work_date, 'regular')).
--
-- Every reworked DEFINER body below is sourced from the LIVE function
-- (pg_get_functiondef, 2026-07-24) — NOT the 075750 migration text — and carries
-- the current spec-348 role gate (site_admin, super_admin, procurement_manager).
--
-- Money stays out of scope: 306 U5 owns the derive → labor_logs, the OT rate,
-- and any 17:30 pay-clamp. This unit only makes the two sessions capturable.

-- ---------------------------------------------------------------------------
-- Schema: the session discriminator + composite uniqueness.
-- ---------------------------------------------------------------------------
create type public.muster_session as enum ('regular', 'ot');

alter table public.muster_attendance
  add column session public.muster_session not null default 'regular';

alter table public.muster_attendance
  drop constraint muster_attendance_worker_id_work_date_key;

alter table public.muster_attendance
  add constraint muster_attendance_worker_date_session_key
  unique (worker_id, work_date, session);

-- ---------------------------------------------------------------------------
-- muster_scan_in — gains p_session; ot scan-in is guarded on a regular session
-- existing on the same team first.
-- ---------------------------------------------------------------------------
drop function if exists public.muster_scan_in(uuid, uuid, public.muster_method);

create function public.muster_scan_in(
  p_team uuid,
  p_worker uuid,
  p_method public.muster_method,
  p_session public.muster_session default 'regular'
) returns uuid
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_role      public.user_role := public.current_user_role();
  v_team      public.muster_teams%rowtype;
  v_existing  public.muster_attendance%rowtype;
  v_other     text;
  v_other_prj uuid;
  v_id        uuid;
begin
  if v_role is null or v_role not in ('site_admin', 'super_admin', 'procurement_manager') then
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

  -- Spec 351: an OT session continues the day's normal hours, so it may only be
  -- opened AFTER the worker's regular session that day, ON THE SAME TEAM.
  if p_session = 'ot' then
    if not exists (
      select 1 from public.muster_attendance
       where worker_id = p_worker and work_date = v_team.work_date
         and session = 'regular' and team_id = p_team) then
      raise exception 'muster_scan_in: no regular session on this team today' using errcode = 'P0001';
    end if;
  end if;

  select * into v_existing from public.muster_attendance
   where worker_id = p_worker and work_date = v_team.work_date and session = p_session;
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

  -- Guard the concurrent-scan race (two phones, same worker+date+session): the
  -- unique (worker_id, work_date, session) constraint is the backstop; surface
  -- the friendly conflict.
  begin
    insert into public.muster_attendance (team_id, worker_id, work_date, session, in_method, scanned_by)
    values (p_team, p_worker, v_team.work_date, p_session, p_method, auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'muster_scan_in: worker already mustered today (concurrent scan)' using errcode = 'P0001';
  end;
  return v_id;
end; $function$;

revoke all     on function public.muster_scan_in(uuid, uuid, public.muster_method, public.muster_session) from public;
revoke execute on function public.muster_scan_in(uuid, uuid, public.muster_method, public.muster_session) from anon;
grant  execute on function public.muster_scan_in(uuid, uuid, public.muster_method, public.muster_session) to authenticated;

-- ---------------------------------------------------------------------------
-- muster_scan_out — gains p_session; ot_hours becomes the ot session's real
-- span, and a regular scan-out never carries OT.
-- ---------------------------------------------------------------------------
drop function if exists public.muster_scan_out(uuid, uuid, public.muster_method);

create function public.muster_scan_out(
  p_team uuid,
  p_worker uuid,
  p_method public.muster_method,
  p_session public.muster_session default 'regular'
) returns uuid
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_role public.user_role := public.current_user_role();
  v_team public.muster_teams%rowtype;
  v_att  public.muster_attendance%rowtype;
  v_ot   numeric;
begin
  if v_role is null or v_role not in ('site_admin', 'super_admin', 'procurement_manager') then
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
   where worker_id = p_worker and work_date = v_team.work_date and session = p_session;
  if not found then
    raise exception 'muster_scan_out: no attendance for this worker on the team''s date' using errcode = 'P0001';
  end if;
  if v_att.team_id is distinct from p_team then
    raise exception 'muster_scan_out: worker is in another team today — move first' using errcode = 'P0001';
  end if;

  -- Spec 351: an ot session's OT = its real span (out − in), floored to 0.5h.
  -- A regular session never carries OT (that derivation moved to the ot session).
  if p_session = 'ot' then
    v_ot := floor((extract(epoch from (now() - v_att.in_at)) / 3600.0) * 2) / 2;
    if v_ot <= 0 then
      v_ot := null;
    end if;
  else
    v_ot := null;
  end if;

  update public.muster_attendance
     set out_at = now(), out_method = p_method, ot_hours = v_ot, out_auto = false
   where id = v_att.id;
  return v_att.id;
end; $function$;

revoke all     on function public.muster_scan_out(uuid, uuid, public.muster_method, public.muster_session) from public;
revoke execute on function public.muster_scan_out(uuid, uuid, public.muster_method, public.muster_session) from anon;
grant  execute on function public.muster_scan_out(uuid, uuid, public.muster_method, public.muster_session) to authenticated;

-- ---------------------------------------------------------------------------
-- close_muster_day — auto-out REGULAR sessions only; leave open ot sessions
-- open ("till whenever" has no fixed end).
-- ---------------------------------------------------------------------------
create or replace function public.close_muster_day(p_project uuid, p_date date)
  returns void
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_role    public.user_role := public.current_user_role();
  v_day_end timestamptz;
begin
  if v_role is null or v_role not in ('site_admin', 'super_admin', 'procurement_manager') then
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
  -- Spec 351: REGULAR sessions only — an open ot session is left for the SA to
  -- close explicitly (the cockpit flags it).
  update public.muster_attendance a
     set out_at = greatest(v_day_end, a.in_at), out_auto = true
    from public.muster_teams t
   where t.id = a.team_id and t.project_id = p_project
     and a.work_date = p_date and a.out_at is null
     and a.session = 'regular';

  insert into public.muster_day_closures (project_id, work_date, closed_by)
  values (p_project, p_date, auth.uid())
  on conflict (project_id, work_date)
  do update set closed_at = now(), closed_by = excluded.closed_by;
end; $function$;

-- ---------------------------------------------------------------------------
-- move_muster_worker — moves ALL of the worker's sessions that day (regular +
-- ot ride together; OT must stay on the same team as its regular session).
-- ---------------------------------------------------------------------------
create or replace function public.move_muster_worker(p_worker uuid, p_date date, p_to_team uuid)
  returns uuid
  language plpgsql
  security definer
  set search_path to 'public'
as $function$
declare
  v_role         public.user_role := public.current_user_role();
  v_to           public.muster_teams%rowtype;
  v_att          public.muster_attendance%rowtype;
  v_from_project uuid;
begin
  if v_role is null or v_role not in ('site_admin', 'super_admin', 'procurement_manager') then
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
  -- Any one session confirms membership + the worker's current team for the date
  -- (both sessions are co-located by the OT same-team guard).
  select * into v_att from public.muster_attendance
   where worker_id = p_worker and work_date = p_date
   limit 1;
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

  update public.muster_attendance set team_id = p_to_team
   where worker_id = p_worker and work_date = p_date;
  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('crew_change', auth.uid(), v_role, 'muster_attendance', v_att.id,
          jsonb_build_object('kind', 'muster_move', 'worker_id', p_worker,
                             'work_date', p_date, 'from_team', v_att.team_id,
                             'to_team', p_to_team));
  return v_att.id;
end; $function$;
