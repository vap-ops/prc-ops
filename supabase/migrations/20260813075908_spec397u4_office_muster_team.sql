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

-- `lead_worker_id` was NOT NULL at the TABLE level, which no amount of RPC logic
-- can talk around — the first office insert died 23502. Dropping that blanket
-- constraint would leave a crew team able to exist with no lead, and the cockpit
-- board GROUPS by the lead, so the rule moves from "always" to "per kind" rather
-- than being relaxed: the CHECK is strictly stronger than the old NOT NULL for
-- crew rows and is the only thing that permits a leadless office row.
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
  v_id   uuid;
begin
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
  if p_kind = 'crew' and p_lead_worker is null then
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

  if p_kind = 'office' then
    -- Conflict target is the PARTIAL index above (its predicate is repeated here,
    -- which is how Postgres selects a partial unique index as an arbiter). The
    -- update is a no-op touch so the statement still RETURNS the existing row —
    -- `do nothing` would return no row and the caller would read NULL.
    insert into public.muster_teams as t (project_id, work_date, lead_worker_id, kind, created_by)
    values (p_project, p_date, p_lead_worker, 'office', auth.uid())
    on conflict (project_id, work_date) where kind = 'office'
    do update set lead_worker_id = coalesce(excluded.lead_worker_id, t.lead_worker_id)
    returning t.id into v_id;
  else
    insert into public.muster_teams as t (project_id, work_date, lead_worker_id, kind, created_by)
    values (p_project, p_date, p_lead_worker, 'crew', auth.uid())
    on conflict (project_id, work_date, lead_worker_id)
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
