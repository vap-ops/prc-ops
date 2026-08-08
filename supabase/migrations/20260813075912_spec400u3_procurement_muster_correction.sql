-- Spec 400 U3a — the correction path for procurement.
--
-- Spec 400 U1/U2 shipped a grid that SURFACES attendance holes to procurement
-- (11 of 41 active workers had zero July rows; 08-04 mustered one person). It
-- shipped nothing to fix them with: of the five muster powers, procurement held
-- read, reopen-day and undo-scan — all of which REMOVE — and was refused
-- muster_scan_in / close_muster_day, the two that SUPPLY. Their power was
-- destructive-only, while the commonest correction after finding a hole is
-- "he was here, add him".
--
-- Operator ruling 2026-08-06 (spec 400 §3), option A with both sub-questions
-- answered: procurement MAY correct, they may ALSO re-close, and the binding is
-- ANY OPEN DAY rather than only a day they reopened. The measurement behind that
-- last part: reopen_muster_day has 0 audit rows all-time — the power shipped
-- 2026-08-05 and has never been used — so gating corrections behind a reopen
-- would have put a new capability behind a ritual nobody performs.
--
--   ⇒ procurement may write to a project-day with NO muster_day_closures row.
--     A closed day still needs reopen_muster_day first, which they already hold,
--     so that path is not retired — it is just no longer the only door.
--
-- Two gates per function, and the SECOND is the one a role-list-only widening
-- misses: can_see_project() falls to `else false` for procurement (verified
-- live), so both functions take the cross-project arm reopen_muster_day already
-- uses — `v_role <> 'procurement' and not can_see_project(...)`. Widening only
-- the role list would admit them at the door and refuse them at every project
-- (the spec-397 two-allowlist trap).
--
-- Additive: no DROP, no DELETE, no column-type change. Both functions keep their
-- signature, so no `drop function` is needed and no caller changes.
--
-- ⚠️ Deliberately NOT changed: muster_scan_in has no closure guard today, so a
-- site_admin can scan into a CLOSED day. That is a pre-existing hole, older than
-- this spec and unmeasured by it. Closing it for everyone is a behaviour change
-- to the cockpit that was not asked for, so the guard below is NEW-ARM-ONLY and
-- the SA's path is pinned as still-open in
-- `400-muster-correction-procurement.test.sql` section E. If a later unit closes
-- it, that assertion is what makes the change deliberate rather than incidental.

-- ---------------------------------------------------------------------------
-- close_muster_day — procurement joins the closers, with the cross-project arm.
--
-- This is money-adjacent: closing performs derive_muster_labor. It is safe to
-- grant NOW and materially cheaper than later — labor_logs is 0 rows all-time
-- and no worker has cost_confirmed_at, so derive books nothing today. Once spec
-- 368 U2 confirms the first rate, every close moves money.
--
-- The audit row is new for ALL closers, not only procurement: a closure is the
-- event that triggers the wage derive, so "who finalised this day" is exactly the
-- fact a later money question needs, and reopen_muster_day already records its
-- own half of the pair. Convention follows it — an EXISTING action plus a payload
-- `kind`, never a new enum value; target_id is the PROJECT because
-- muster_day_closures has a composite key and no id column.
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
  -- NULL role (unbound caller / no users row) must be DENIED, not fall through:
  -- `null not in (...)` is NULL, which an IF treats as not-true (the
  -- rls-self-check-coalesce trap).
  if v_role is null or v_role not in (
    'site_admin', 'super_admin', 'procurement_manager', 'procurement'
  ) then
    raise exception 'close_muster_day: role not permitted' using errcode = '42501';
  end if;
  if p_project is null or p_date is null then
    raise exception 'close_muster_day: project and date are required' using errcode = 'P0001';
  end if;

  -- Membership for the roles that HAVE membership; procurement is cross-project.
  if v_role <> 'procurement' and not public.can_see_project(p_project) then
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

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('crew_change', auth.uid(), v_role, 'muster_day_closures', p_project,
          jsonb_build_object(
            'kind', 'muster_day_close',
            'project_id', p_project,
            'work_date', p_date));

  -- Spec 306 U5a — the money derive keys off this closure. Idempotent, so a
  -- re-close simply re-derives (picking up muster edits / newly-confirmed rates).
  perform public.derive_muster_labor(p_project, p_date);
end; $function$;

-- ---------------------------------------------------------------------------
-- muster_scan_in — procurement may add a missing person to an OPEN day.
--
-- It takes a TEAM, not a project-day, so the closure guard has to resolve the
-- team's project_id/work_date first — which the function already does for its
-- own membership check, so the guard sits after that lookup.
--
-- The guard takes derive_muster_labor's OWN advisory key rather than one of its
-- choosing: without it, close_muster_day could commit a closure and derive wages
-- between this guard and the insert, leaving an attendance row on a day whose
-- wages were already booked without it — precisely what the guard exists to
-- prevent. reopen_muster_day takes the same key for the same reason.
--
-- A day with no team AT ALL cannot be corrected here: this function requires a
-- team and open_muster_team needs a lead worker (lead_worker_id is NOT NULL for
-- kind='crew'). That refusal is honest rather than inventing a lead, and the UI
-- turns the existing 'team not found' into "ยังไม่มีทีมของวันนั้น" in U3b.
-- ---------------------------------------------------------------------------
create or replace function public.muster_scan_in(
  p_team uuid,
  p_worker uuid,
  p_method public.muster_method,
  p_session public.muster_session default 'regular'::public.muster_session
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role       public.user_role := public.current_user_role();
  v_team       public.muster_teams%rowtype;
  v_existing   public.muster_attendance%rowtype;
  v_other      text;
  v_other_prj  uuid;
  v_other_kind public.muster_team_kind;
  v_id         uuid;
begin
  if v_role is null or v_role not in (
    'site_admin', 'super_admin', 'procurement_manager', 'procurement'
  ) then
    raise exception 'muster_scan_in: role not permitted' using errcode = '42501';
  end if;
  select * into v_team from public.muster_teams where id = p_team;
  if not found then
    raise exception 'muster_scan_in: team not found' using errcode = 'P0001';
  end if;

  -- Membership for the roles that HAVE membership; procurement is cross-project.
  if v_role <> 'procurement' and not public.can_see_project(v_team.project_id) then
    raise exception 'muster_scan_in: not a member of this project' using errcode = '42501';
  end if;

  -- The bound on the new power (spec 400 §3): procurement writes only to a
  -- project-day with no closure. NEW ARM ONLY — the SA path is unchanged, see
  -- the header. P0001 not 42501: the DAY is the reason, not the role, and the UI
  -- must say "reopen it first" rather than "you are not allowed".
  if v_role = 'procurement' then
    perform pg_advisory_xact_lock(
      hashtextextended(v_team.project_id::text || '|' || v_team.work_date::text, 0));
    if exists (
      select 1 from public.muster_day_closures
       where project_id = v_team.project_id and work_date = v_team.work_date
    ) then
      raise exception 'muster_scan_in: this day is closed — reopen it first'
        using errcode = 'P0001';
    end if;
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
    -- LEFT join (spec 397 U4): an office team has no lead, and an INNER join
    -- silently turned "they are in the office team" into "somewhere elsewhere".
    select t.project_id, t.kind, w.name into v_other_prj, v_other_kind, v_other
      from public.muster_teams t
      left join public.workers w on w.id = t.lead_worker_id
     where t.id = v_existing.team_id;
    if v_other_prj is not null and public.can_see_project(v_other_prj) then
      if v_other_kind = 'office' then
        raise exception 'muster_scan_in: worker is already in the office team today'
          using errcode = 'P0001';
      end if;
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

  -- Attribute the CORRECTION specifically. Only the new arm writes this: an SA's
  -- ordinary cockpit scan is not a correction, and labelling it one would make
  -- the audit trail useless for the question it exists to answer ("who edited
  -- this day after the fact?").
  if v_role = 'procurement' then
    insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
    values ('crew_change', auth.uid(), v_role, 'muster_attendance', v_id,
            jsonb_build_object(
              'kind', 'muster_correction_scan_in',
              'project_id', v_team.project_id,
              'work_date', v_team.work_date,
              'team_id', p_team,
              'worker_id', p_worker,
              'session', p_session,
              'method', p_method));
  end if;

  return v_id;
end;
$function$;
