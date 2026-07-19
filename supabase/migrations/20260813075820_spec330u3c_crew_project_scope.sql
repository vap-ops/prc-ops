-- Spec 330 U3c — scope every crew RPC to the crew's OWN project.
--
-- PROBLEM (verified live before writing this): the eight crew RPCs shipped in
-- U2 (mig 075817) + U3a (mig 075818) gate on ROLE only — `is_back_office`.
-- That set is (project_manager, super_admin, procurement, procurement_manager,
-- project_director). Two holes follow:
--
--   1. procurement + procurement_manager (5 live logins) are NOT in PM_ROLES,
--      so /projects/:id/team is closed to them — yet these functions are
--      `grant execute to authenticated`, so a direct PostgREST call let them
--      rename, dissolve, re-crew or re-lead ANY project's teams.
--   2. a project_manager was unbounded across projects: back-office role, no
--      membership test anywhere.
--
-- Crew membership feeds the /sa/plan draft → set_daily_plan_item_crew →
-- mark-present → log_labor_day → labor_logs → payroll, so this is a
-- money-adjacent write path, not a cosmetic one.
--
-- FIX: add `can_see_project` — the same gate the muster family (spec 306) has
-- carried since day one, and the same predicate the page itself is built on.
-- Placement mirrors open_muster_team / move_muster_worker: role gate → row
-- lookup → scope gate → the function's own rules.
--
--   * the project is ALWAYS derived from the CREW row, never from a
--     caller-supplied id — a caller cannot name a project it is allowed to see
--     in order to reach a crew it is not;
--   * create_crew is the sole exception (there is no crew yet) and therefore
--     checks p_project directly, which is exactly the value it inserts;
--   * move_worker_between_crews checks BOTH ends.
--
-- Everything else in every body is the LIVE definition, verbatim (sourced from
-- pg_get_functiondef, never from a migration file — a later migration may have
-- re-sourced a body, and for these it had: U3a re-wrote five of the eight).
--
-- ADDITIVE + behaviour-narrowing only. Zero collateral: `crews` and
-- `crew_members` both hold 0 rows live, so no existing membership can be
-- orphaned. super_admin / project_director keep the unconditional arm.
--
-- Tests: supabase/tests/database/332-crew-project-scope.test.sql (RED first).

-- ── add_worker_to_crew ──────────────────────────────────────────────────────
create or replace function public.add_worker_to_crew(p_crew uuid, p_worker uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role public.user_role := public.current_user_role();
  v_crew public.crews%rowtype;
  v_worker public.workers%rowtype;
  v_existing uuid;
  v_prev_membership uuid;
  v_prev_crew uuid;
  v_id uuid;
begin
  if not public.is_back_office(v_role) then
    raise exception 'not authorized to manage crew members' using errcode = '42501';
  end if;

  select * into v_crew from public.crews where id = p_crew;
  if not found then
    raise exception 'crew not found' using errcode = 'P0002';
  end if;
  -- Spec 330 U3c project scope — derived from the crew, not from the caller.
  if not public.can_see_project(v_crew.project_id) then
    raise exception 'not a member of this project' using errcode = '42501';
  end if;
  if not v_crew.active then
    raise exception 'crew is dissolved' using errcode = '22023';
  end if;

  select * into v_worker from public.workers where id = p_worker;
  if not found or not v_worker.active then
    raise exception 'worker not found or inactive' using errcode = 'P0002';
  end if;
  -- Spec 328 §2.4 money wall (U3a).
  if v_worker.contractor_id is not null then
    raise exception 'contractor-tied worker is pay-exempt and cannot join a crew'
      using errcode = '22023';
  end if;
  if v_worker.project_id is distinct from v_crew.project_id then
    raise exception 'worker belongs to another project' using errcode = '22023';
  end if;

  select id into v_existing from public.crew_members
   where crew_id = p_crew and worker_id = p_worker and removed_at is null;
  if found then
    return v_existing;
  end if;

  update public.crew_members
     set removed_at = now()
   where worker_id = p_worker and removed_at is null
  returning id, crew_id into v_prev_membership, v_prev_crew;

  begin
    insert into public.crew_members (crew_id, worker_id, added_by)
    values (p_crew, p_worker, auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'concurrent crew-membership change for this worker — try again'
      using errcode = 'P0001';
  end;

  if v_prev_membership is not null then
    insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
    values ('crew_change', auth.uid(), v_role, 'crew_members', v_prev_membership,
            jsonb_build_object('op', 'remove', 'crew_id', v_prev_crew, 'worker_id', p_worker,
                               'implicit_move_to', p_crew));
  end if;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('crew_change', auth.uid(), v_role, 'crew_members', v_id,
          jsonb_build_object('op', 'add', 'crew_id', p_crew, 'worker_id', p_worker)
          || case when v_prev_crew is not null
                  then jsonb_build_object('moved_from_crew_id', v_prev_crew)
                  else '{}'::jsonb end);
  return v_id;
end;
$function$;

-- ── remove_worker_from_crew ─────────────────────────────────────────────────
-- Scope-gated like the rest: removal is never walled by the MONEY rule (a
-- pre-wall row must never be trapped — spec 330 U3a §F), but authorization is
-- a different question and a non-member has no business editing the crew.
create or replace function public.remove_worker_from_crew(p_crew uuid, p_worker uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role public.user_role := public.current_user_role();
  v_project uuid;
  v_id uuid;
begin
  if not public.is_back_office(v_role) then
    raise exception 'not authorized to manage crew members' using errcode = '42501';
  end if;

  select project_id into v_project from public.crews where id = p_crew;
  if not found then
    raise exception 'crew not found' using errcode = 'P0002';
  end if;
  -- Spec 330 U3c project scope.
  if not public.can_see_project(v_project) then
    raise exception 'not a member of this project' using errcode = '42501';
  end if;

  update public.crew_members
     set removed_at = now()
   where crew_id = p_crew and worker_id = p_worker and removed_at is null
  returning id into v_id;
  if v_id is null then
    raise exception 'worker is not an active member of this crew' using errcode = 'P0002';
  end if;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('crew_change', auth.uid(), v_role, 'crew_members', v_id,
          jsonb_build_object('op', 'remove', 'crew_id', p_crew, 'worker_id', p_worker));
  return v_id;
end;
$function$;

-- ── move_worker_between_crews ───────────────────────────────────────────────
-- BOTH ends are scoped: the source crew (fetched up front — the live body
-- never read it at all) and the target crew. Scoping only the source would let
-- a member of project A push a worker into project B's crew.
create or replace function public.move_worker_between_crews(p_from uuid, p_to uuid, p_worker uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role public.user_role := public.current_user_role();
  v_from public.crews%rowtype;
  v_to public.crews%rowtype;
  v_worker public.workers%rowtype;
  v_old uuid;
  v_id uuid;
begin
  if not public.is_back_office(v_role) then
    raise exception 'not authorized to manage crew members' using errcode = '42501';
  end if;

  -- Spec 330 U3c project scope — SOURCE end.
  select * into v_from from public.crews where id = p_from;
  if not found then
    raise exception 'source crew not found' using errcode = 'P0002';
  end if;
  if not public.can_see_project(v_from.project_id) then
    raise exception 'not a member of this project' using errcode = '42501';
  end if;

  select id into v_old from public.crew_members
   where crew_id = p_from and worker_id = p_worker and removed_at is null;
  if not found then
    raise exception 'worker is not an active member of the source crew' using errcode = 'P0002';
  end if;

  if p_from = p_to then
    return v_old;
  end if;

  select * into v_to from public.crews where id = p_to;
  if not found then
    raise exception 'target crew not found' using errcode = 'P0002';
  end if;
  -- Spec 330 U3c project scope — TARGET end.
  if not public.can_see_project(v_to.project_id) then
    raise exception 'not a member of this project' using errcode = '42501';
  end if;
  if not v_to.active then
    raise exception 'target crew is dissolved' using errcode = '22023';
  end if;
  select * into v_worker from public.workers where id = p_worker;
  if not found or not v_worker.active then
    raise exception 'worker not found or inactive' using errcode = 'P0002';
  end if;
  -- Spec 328 §2.4 money wall (U3a): a pre-wall row must not be carried
  -- forward into another crew. (Removal stays allowed — never trap a row.)
  if v_worker.contractor_id is not null then
    raise exception 'contractor-tied worker is pay-exempt and cannot join a crew'
      using errcode = '22023';
  end if;
  if v_worker.project_id is distinct from v_to.project_id then
    raise exception 'worker belongs to another project' using errcode = '22023';
  end if;

  update public.crew_members set removed_at = now() where id = v_old;
  begin
    insert into public.crew_members (crew_id, worker_id, added_by)
    values (p_to, p_worker, auth.uid())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'concurrent crew-membership change for this worker — try again'
      using errcode = 'P0001';
  end;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('crew_change', auth.uid(), v_role, 'crew_members', v_id,
          jsonb_build_object('op', 'move', 'from_crew_id', p_from, 'to_crew_id', p_to,
                             'worker_id', p_worker, 'closed_membership_id', v_old));
  return v_id;
end;
$function$;

-- ── set_crew_lead ───────────────────────────────────────────────────────────
create or replace function public.set_crew_lead(p_crew uuid, p_worker uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role public.user_role := public.current_user_role();
  v_crew public.crews%rowtype;
  v_contractor uuid;
begin
  if not public.is_back_office(v_role) then
    raise exception 'not authorized to manage crews' using errcode = '42501';
  end if;

  select * into v_crew from public.crews where id = p_crew;
  if not found then
    raise exception 'crew not found' using errcode = 'P0002';
  end if;
  -- Spec 330 U3c project scope.
  if not public.can_see_project(v_crew.project_id) then
    raise exception 'not a member of this project' using errcode = '42501';
  end if;
  if not v_crew.active then
    raise exception 'crew is dissolved' using errcode = '22023';
  end if;

  -- Spec 328 §2.4 money wall (U3a) — checked on the WORKER, not inferred.
  select contractor_id into v_contractor from public.workers where id = p_worker;
  if v_contractor is not null then
    raise exception 'contractor-tied worker is pay-exempt and cannot lead a crew'
      using errcode = '22023';
  end if;

  perform 1 from public.crew_members
   where crew_id = p_crew and worker_id = p_worker and removed_at is null;
  if not found then
    raise exception 'lead must be an active member of the crew' using errcode = '22023';
  end if;

  update public.crews set lead_worker_id = p_worker where id = p_crew;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('crew_change', auth.uid(), v_role, 'crews', p_crew,
          jsonb_build_object('op', 'set_lead', 'lead_worker_id', p_worker));
  return p_crew;
end;
$function$;

-- ── reassign_crew_lead (spec 279 — the OTHER lead writer) ───────────────────
create or replace function public.reassign_crew_lead(p_crew uuid, p_new_lead uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role public.user_role := public.current_user_role();
  v_project uuid;
  v_contractor uuid;
begin
  if not public.is_back_office(v_role) then
    raise exception 'not authorized to reassign a crew lead' using errcode = '42501';
  end if;

  -- Spec 330 U3c project scope. The live body never read the crew row before
  -- writing to it; the existence check below is now up front instead of after
  -- the UPDATE, so scope can be tested at all.
  select project_id into v_project from public.crews where id = p_crew;
  if not found then
    raise exception 'crew not found' using errcode = 'P0002';
  end if;
  if not public.can_see_project(v_project) then
    raise exception 'not a member of this project' using errcode = '42501';
  end if;

  if p_new_lead is not null then
    select w.contractor_id into v_contractor
      from public.workers w where w.id = p_new_lead and w.active;
    if not found then
      raise exception 'lead worker not found or inactive' using errcode = 'P0002';
    end if;
    -- Spec 328 §2.4 money wall (U3a).
    if v_contractor is not null then
      raise exception 'contractor-tied worker is pay-exempt and cannot lead a crew'
        using errcode = '22023';
    end if;
  end if;

  update public.crews set lead_worker_id = p_new_lead where id = p_crew;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('crew_change', auth.uid(), v_role, 'crews', p_crew,
          jsonb_build_object('op', 'reassign_lead', 'lead_worker_id', p_new_lead));
end;
$function$;

-- ── rename_crew ─────────────────────────────────────────────────────────────
create or replace function public.rename_crew(p_crew uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role public.user_role := public.current_user_role();
  v_project uuid;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if not public.is_back_office(v_role) then
    raise exception 'not authorized to manage crews' using errcode = '42501';
  end if;

  select project_id into v_project from public.crews where id = p_crew;
  if not found then
    raise exception 'crew not found' using errcode = 'P0002';
  end if;
  -- Spec 330 U3c project scope.
  if not public.can_see_project(v_project) then
    raise exception 'not a member of this project' using errcode = '42501';
  end if;

  if v_name = '' then
    raise exception 'crew name must not be blank' using errcode = '22023';
  end if;

  update public.crews set name = v_name where id = p_crew;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('crew_change', auth.uid(), v_role, 'crews', p_crew,
          jsonb_build_object('op', 'rename', 'name', v_name));
  return p_crew;
end;
$function$;

-- ── dissolve_crew ───────────────────────────────────────────────────────────
create or replace function public.dissolve_crew(p_crew uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role public.user_role := public.current_user_role();
  v_project uuid;
  v_active boolean;
begin
  if not public.is_back_office(v_role) then
    raise exception 'not authorized to manage crews' using errcode = '42501';
  end if;

  select active, project_id into v_active, v_project from public.crews where id = p_crew;
  if not found then
    raise exception 'crew not found' using errcode = 'P0002';
  end if;
  -- Spec 330 U3c project scope.
  if not public.can_see_project(v_project) then
    raise exception 'not a member of this project' using errcode = '42501';
  end if;
  if not v_active then
    return p_crew; -- already dissolved — friendly no-op
  end if;

  update public.crews set active = false where id = p_crew;
  update public.crew_members
     set removed_at = now()
   where crew_id = p_crew and removed_at is null;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('crew_change', auth.uid(), v_role, 'crews', p_crew,
          jsonb_build_object('op', 'dissolve'));
  return p_crew;
end;
$function$;

-- ── create_crew ─────────────────────────────────────────────────────────────
-- The one function with no crew to derive from, so it scopes p_project — which
-- is the value it goes on to insert, so there is no gap between what was
-- checked and what is written.
create or replace function public.create_crew(
  p_project uuid,
  p_name text,
  p_lead_worker uuid default null::uuid,
  p_kind text default 'dc'::text,
  p_default_day_rate numeric default null::numeric
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role public.user_role := public.current_user_role();
  v_crew_id uuid;
  v_lead_contractor uuid;
begin
  if not public.is_back_office(v_role) then
    raise exception 'not authorized to create a crew' using errcode = '42501';
  end if;
  -- Spec 330 U3c project scope — on the project this crew will belong to.
  if not public.can_see_project(p_project) then
    raise exception 'not a member of this project' using errcode = '42501';
  end if;
  if p_kind is null or p_kind not in ('dc', 'subcon') then
    raise exception 'invalid crew kind' using errcode = '22023';
  end if;
  if p_lead_worker is not null then
    select w.contractor_id into v_lead_contractor
      from public.workers w where w.id = p_lead_worker and w.active;
    if not found then
      raise exception 'lead worker not found or inactive' using errcode = 'P0002';
    end if;
    -- Spec 328 §2.4 money wall (U3a).
    if v_lead_contractor is not null then
      raise exception 'contractor-tied worker is pay-exempt and cannot lead a crew'
        using errcode = '22023';
    end if;
  end if;

  insert into public.crews (project_id, name, lead_worker_id, kind, default_day_rate, created_by)
  values (p_project, btrim(p_name), p_lead_worker, p_kind, p_default_day_rate, auth.uid())
  returning id into v_crew_id;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('crew_change', auth.uid(), v_role, 'crews', v_crew_id,
          jsonb_build_object('op', 'create', 'project_id', p_project, 'name', btrim(p_name),
                             'lead_worker_id', p_lead_worker, 'kind', p_kind));
  return v_crew_id;
end;
$function$;
