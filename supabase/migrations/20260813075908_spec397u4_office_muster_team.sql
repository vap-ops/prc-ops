-- Spec 397 U4 — the office muster team.
--
-- Operator, 2026-08-05: "the site office team doesn't know how to take attendance
-- of themselves yet", and the decision: a standing office team per site, led by
-- the site owner, that a visiting auditor also checks into.
--
-- Office staff ride the EXISTING muster rather than a second store: a `workers`
-- row at day_rate 0 with cost_confirmed_at null books no wage (derive_muster_labor
-- gates on both), and `Preston Inter` has attended six days that way already. So
-- the only thing missing is a way to say WHICH team is the office one.
--
-- A team KIND, not a naming convention — a name cannot be indexed, gated, or
-- excluded from a crew total without string matching.
--
-- ⚠️ The lead is NULLABLE for an office team and still required for a crew one.
-- The spec's intended lead is the `site_owner`, and there are ZERO users of that
-- role today (verified live); a team that cannot open until an appointment lands
-- is a team nobody can check into. Crew teams keep their mandatory lead because
-- the cockpit board GROUPS by it.
--
-- ⚠️ That nullable lead is exactly why this needs its own index: the existing
-- UNIQUE (project_id, work_date, lead_worker_id) treats NULLs as distinct, so it
-- would happily accept ten leadless office teams on one day.

create type public.muster_team_kind as enum ('crew', 'office');

-- Default 'crew' backfills all 44 live teams as what they are. NOT NULL so no
-- reader ever has to treat a third, absent state.
alter table public.muster_teams
  add column kind public.muster_team_kind not null default 'crew';

comment on column public.muster_teams.kind is
  'Spec 397 U4 — crew = a ช่าง team led by a หัวหน้าชุด (lead required); office = the '
  'site office/visitor team (lead optional, at most one per project-day). An office '
  'team is excluded from crew totals and from the cockpit board, which groups by lead.';

create unique index muster_teams_one_office_per_day
  on public.muster_teams (project_id, work_date)
  where kind = 'office';

-- ⚠️ The pre-existing UNIQUE (project_id, work_date, lead_worker_id) is a FULL
-- index, so it covers office rows too — and that makes the two upsert arbiters
-- below overlap. With an office team carrying a lead L, a CREW upsert for the
-- same (project, date, L) conflicts against the OFFICE row, updates nothing, and
-- returns the OFFICE team's id: the SA would then scan the whole lineup into a
-- team the cockpit board filters out, and both the board and the /team card would
-- show the day as empty. The mirror case raises a raw 23505 instead of an honest
-- message. Making the crew constraint PARTIAL puts the two kinds in disjoint
-- namespaces, so each arbiter can only ever match its own kind.
alter table public.muster_teams
  drop constraint muster_teams_project_id_work_date_lead_worker_id_key;

create unique index muster_teams_one_crew_per_lead_per_day
  on public.muster_teams (project_id, work_date, lead_worker_id)
  where kind = 'crew';

-- `lead_worker_id` was NOT NULL at the TABLE level, which no amount of RPC logic
-- can talk around — the first office insert died 23502. Dropping that blanket
-- constraint would leave a crew team able to exist with no lead, and the cockpit
-- board GROUPS by the lead, so the rule moves from "always" to "per kind" rather
-- than being relaxed: the CHECK is strictly stronger than the old NOT NULL for
-- crew rows: for a crew row the CHECK says exactly what the NOT NULL said, and
-- the only thing that changes is that an OFFICE row may now be leadless.
alter table public.muster_teams alter column lead_worker_id drop not null;

alter table public.muster_teams
  add constraint muster_teams_crew_has_lead
  check (kind = 'office' or lead_worker_id is not null);

-- open_muster_team gains the kind. The 3-arg form is DROPPED rather than left
-- beside the new one: two overloads make PostgREST resolve by argument names, so
-- an existing 3-name call would become ambiguous instead of picking up the
-- default. Dropped and recreated in one migration, so no window exists where the
-- name is missing; a 3-argument caller keeps working and gets kind = 'crew'.
drop function if exists public.open_muster_team(uuid, date, uuid);

create function public.open_muster_team(
  p_project uuid,
  p_date date,
  p_lead_worker uuid,
  p_kind public.muster_team_kind default 'crew'
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role public.user_role := public.current_user_role();
  v_kind public.muster_team_kind := coalesce(p_kind, 'crew');
  v_id   uuid;
begin
  -- A DEFAULT only applies to an OMITTED argument. PostgREST happily forwards an
  -- explicit `"p_kind": null`, and every comparison against NULL below would then
  -- be NULL: the honest "lead worker is required" P0001 would be skipped and the
  -- ELSE branch would insert a CREW team for a caller who asked for an office one
  -- (or die on the raw CHECK). Coalesce once, then use v_kind everywhere.
  -- Unchanged from the 3-arg form: the office team is opened by the same people
  -- who open a crew team. Who LEADS it is a different question (the site owner);
  -- who may create it is still the site staff on the ground.
  if v_role is null or v_role not in ('site_admin', 'super_admin', 'procurement_manager') then
    raise exception 'open_muster_team: role not permitted' using errcode = '42501';
  end if;
  if p_project is null or p_date is null then
    raise exception 'open_muster_team: project and date are required' using errcode = 'P0001';
  end if;
  -- The lead is required for a CREW team only. This is the one behaviour the
  -- 3-arg form had that changes, and only for the new kind.
  if v_kind = 'crew' and p_lead_worker is null then
    raise exception 'open_muster_team: project, date and lead worker are required'
      using errcode = 'P0001';
  end if;
  if not public.can_see_project(p_project) then
    raise exception 'open_muster_team: not a member of this project' using errcode = '42501';
  end if;
  if p_lead_worker is not null
     and not exists (select 1 from public.workers w where w.id = p_lead_worker) then
    raise exception 'open_muster_team: unknown lead worker' using errcode = 'P0001';
  end if;

  if v_kind = 'office' then
    -- Conflict target is the PARTIAL index above (its predicate is repeated here,
    -- which is how Postgres selects a partial unique index as an arbiter). The
    -- update is GENUINELY inert — it re-writes the row's own value — so the
    -- statement still RETURNS the existing row (`do nothing` returns none and the
    -- caller would read NULL) while changing nothing.
    --
    -- ⚠️ It deliberately does NOT adopt excluded.lead_worker_id: that would let a
    -- second call silently REASSIGN who leads the office team, unaudited, through
    -- a function whose job is "open the team". Appointing the site owner as lead
    -- belongs to U5 and needs its own audited path.
    insert into public.muster_teams as t (project_id, work_date, lead_worker_id, kind, created_by)
    values (p_project, p_date, p_lead_worker, 'office', auth.uid())
    on conflict (project_id, work_date) where kind = 'office'
    do update set lead_worker_id = t.lead_worker_id
    returning t.id into v_id;
  else
    -- The crew arbiter names the PARTIAL crew index, so it can never match an
    -- office row (see the constraint swap above).
    insert into public.muster_teams as t (project_id, work_date, lead_worker_id, kind, created_by)
    values (p_project, p_date, p_lead_worker, 'crew', auth.uid())
    on conflict (project_id, work_date, lead_worker_id) where kind = 'crew'
    do update set lead_worker_id = excluded.lead_worker_id
    returning t.id into v_id;
  end if;

  return v_id;
end;
$function$;

-- A brand-new function is born with EXECUTE for public/anon under this project's
-- default privileges, so the revoke is not optional — the drop above took the old
-- function's ACL with it.
revoke all on function public.open_muster_team(uuid, date, uuid, public.muster_team_kind)
  from public, anon;
grant execute on function public.open_muster_team(uuid, date, uuid, public.muster_team_kind)
  to authenticated;

-- muster_scan_in resolves its "already in another team" message through an INNER
-- join on the other team's LEAD. A leadless office team drops out of that join, so
-- v_other_prj comes back NULL and the code falls to the cross-project privacy
-- fallback: "worker is already mustered elsewhere today". That is FALSE and
-- unhelpful for an office attendee standing on the same site — the SA is told the
-- person is somewhere invisible, with no way to find them.
--
-- Body identical to the live definition (sourced from pg_get_functiondef) except
-- for that lookup: LEFT join, carry the team's kind, and give the office case its
-- own honest message.
create or replace function public.muster_scan_in(
  p_team uuid,
  p_worker uuid,
  p_method public.muster_method,
  p_session public.muster_session default 'regular'
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
  return v_id;
end;
$function$;
