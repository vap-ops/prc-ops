-- Spec 400 U3a, part 3 — the correction arm is REGULAR sessions only.
--
-- Self-review catch on 075912. muster_scan_in's signature is
-- (p_team, p_worker, p_method, p_session default 'regular'), so widening the role
-- list to procurement also handed them the `ot` arm — and an OT session is paid at
-- ×1.5 (spec 351). The operator's ruling was "procurement may correct a day / may
-- re-close"; the correction it names is "he was here, add him". Nothing in §3 asked
-- for the power to CREATE overtime, and the same session chose the narrow option
-- twice (least-privilege on the derive split), so the narrow reading is the one
-- consistent with the ruling.
--
-- This is a tightening of a grant introduced in THIS unit, not a change to any
-- shipped behaviour: before 075912 procurement could not call this function at all,
-- so no caller loses anything. The SA/super_admin/procurement_manager arms keep
-- full access to both sessions exactly as before.
--
-- Reasoning recorded because a later reader will otherwise "simplify" the guard
-- away: if procurement genuinely needs to record OT, that is a money grant of its
-- own and belongs in its own unit with the operator's answer attached.
--
-- Additive: no DROP, no signature change.

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

  -- The bounds on the new correction arm (spec 400 U3a). NEW ARM ONLY — the SA path
  -- is deliberately unchanged; see 075912's header.
  if v_role = 'procurement' then
    -- ① REGULAR only. An OT session is ×1.5 money and was not part of the ruling.
    if p_session <> 'regular' then
      raise exception 'muster_scan_in: a correction may only record a regular session'
        using errcode = 'P0001';
    end if;

    -- ② Open days only. Take derive_muster_labor's OWN advisory key, not one of our
    -- choosing: without it close_muster_day could commit a closure and derive wages
    -- between this check and the insert, leaving an attendance row on a day whose
    -- wages were already booked without it.
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
  -- ordinary cockpit scan is not a correction, and labelling it one would make the
  -- audit trail useless for the question it exists to answer ("who edited this day
  -- after the fact?").
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
