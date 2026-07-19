-- Spec 330 U2 — crew membership + lifecycle DEFINER RPCs (the team-map's
-- write layer over the dormant spec-279 crews/crew_members tables).
--
-- Family contract (mirrors the LIVE create_crew, sourced from the database
-- 2026-07-19, NOT from a migration file):
--   * SECURITY DEFINER, search_path public, fail-closed is_back_office gate
--     (42501) — same audience as create_crew/worker-roster (procurement runs
--     DC onboarding, ADR 0062), deliberately consistent within the crew
--     family rather than the narrower PM-tier the spec sketch named.
--   * audit_log 'crew_change' rows (the enum value create_crew already uses).
--   * revoke-anon inline (spec-273/279 lock lesson).
--
-- Rules:
--   * a worker holds ≤ 1 ACTIVE crew membership — enforced by the EXISTING
--     spec-279 partial unique index crew_members_one_active_per_worker_uq
--     (mig 075410; verified live — U2 adds NO index). Adding while active
--     elsewhere MOVES (closes the old row), and the implicit move is audited
--     on BOTH crews;
--   * membership is append-only-ish: removal/move CLOSE with removed_at,
--     never delete (crew_members.removed_at is the soft-close column);
--   * crews stay in the worker's own project (workers.project_id must match);
--   * dissolve = active=false + close every active membership (lead kept as
--     history); re-dissolve, re-add-same-crew, and same-crew move are
--     friendly no-ops (no fabricated audit events).

create or replace function public.add_worker_to_crew(p_crew uuid, p_worker uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
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
  if not v_crew.active then
    raise exception 'crew is dissolved' using errcode = '22023';
  end if;

  select * into v_worker from public.workers where id = p_worker;
  if not found or not v_worker.active then
    raise exception 'worker not found or inactive' using errcode = 'P0002';
  end if;
  if v_worker.project_id is distinct from v_crew.project_id then
    raise exception 'worker belongs to another project' using errcode = '22023';
  end if;

  -- Already active in THIS crew → idempotent no-op.
  select id into v_existing from public.crew_members
   where crew_id = p_crew and worker_id = p_worker and removed_at is null;
  if found then
    return v_existing;
  end if;

  -- Active elsewhere → the add MOVES them (close the old membership first).
  -- ≤1 active row globally (279 _uq index), so at most one row closes here.
  update public.crew_members
     set removed_at = now()
   where worker_id = p_worker and removed_at is null
  returning id, crew_id into v_prev_membership, v_prev_crew;

  begin
    insert into public.crew_members (crew_id, worker_id, added_by)
    values (p_crew, p_worker, auth.uid())
    returning id into v_id;
  exception when unique_violation then
    -- A concurrent add/move for the same worker won the race: our snapshot
    -- missed its fresh active row. Friendly conflict, caller retries.
    raise exception 'concurrent crew-membership change for this worker — try again'
      using errcode = 'P0001';
  end;

  -- The implicit move must be visible in the DEPARTED crew's trail too.
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
$$;

create or replace function public.remove_worker_from_crew(p_crew uuid, p_worker uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_id uuid;
begin
  if not public.is_back_office(v_role) then
    raise exception 'not authorized to manage crew members' using errcode = '42501';
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
$$;

create or replace function public.move_worker_between_crews(p_from uuid, p_to uuid, p_worker uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_to public.crews%rowtype;
  v_worker public.workers%rowtype;
  v_old uuid;
  v_id uuid;
begin
  if not public.is_back_office(v_role) then
    raise exception 'not authorized to manage crew members' using errcode = '42501';
  end if;

  select id into v_old from public.crew_members
   where crew_id = p_from and worker_id = p_worker and removed_at is null;
  if not found then
    raise exception 'worker is not an active member of the source crew' using errcode = 'P0002';
  end if;

  -- Same-crew "move" = friendly no-op; no fabricated move event.
  if p_from = p_to then
    return v_old;
  end if;

  select * into v_to from public.crews where id = p_to;
  if not found then
    raise exception 'target crew not found' using errcode = 'P0002';
  end if;
  if not v_to.active then
    raise exception 'target crew is dissolved' using errcode = '22023';
  end if;
  select * into v_worker from public.workers where id = p_worker;
  if not found or not v_worker.active then
    raise exception 'worker not found or inactive' using errcode = 'P0002';
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

  -- ONE move event, carrying both ends (no delegated 'add' double-count).
  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('crew_change', auth.uid(), v_role, 'crew_members', v_id,
          jsonb_build_object('op', 'move', 'from_crew_id', p_from, 'to_crew_id', p_to,
                             'worker_id', p_worker, 'closed_membership_id', v_old));
  return v_id;
end;
$$;

create or replace function public.set_crew_lead(p_crew uuid, p_worker uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_active boolean;
begin
  if not public.is_back_office(v_role) then
    raise exception 'not authorized to manage crews' using errcode = '42501';
  end if;

  select active into v_active from public.crews where id = p_crew;
  if v_active is null then
    raise exception 'crew not found' using errcode = 'P0002';
  end if;
  if not v_active then
    raise exception 'crew is dissolved' using errcode = '22023';
  end if;

  -- The lead must be an ACTIVE MEMBER (spec 330 §5) — create_crew's looser
  -- any-active-worker lead predates the membership RPCs.
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
$$;

create or replace function public.rename_crew(p_crew uuid, p_name text)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_name text := btrim(coalesce(p_name, ''));
begin
  if not public.is_back_office(v_role) then
    raise exception 'not authorized to manage crews' using errcode = '42501';
  end if;
  if v_name = '' then
    raise exception 'crew name must not be blank' using errcode = '22023';
  end if;

  update public.crews set name = v_name where id = p_crew;
  if not found then
    raise exception 'crew not found' using errcode = 'P0002';
  end if;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('crew_change', auth.uid(), v_role, 'crews', p_crew,
          jsonb_build_object('op', 'rename', 'name', v_name));
  return p_crew;
end;
$$;

create or replace function public.dissolve_crew(p_crew uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_active boolean;
begin
  if not public.is_back_office(v_role) then
    raise exception 'not authorized to manage crews' using errcode = '42501';
  end if;

  select active into v_active from public.crews where id = p_crew;
  if v_active is null then
    raise exception 'crew not found' using errcode = 'P0002';
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
$$;

-- Lock the family: no anon/public execute; authenticated + service_role only
-- (identical posture to the live create_crew).
revoke execute on function public.add_worker_to_crew(uuid, uuid) from public, anon;
revoke execute on function public.remove_worker_from_crew(uuid, uuid) from public, anon;
revoke execute on function public.move_worker_between_crews(uuid, uuid, uuid) from public, anon;
revoke execute on function public.set_crew_lead(uuid, uuid) from public, anon;
revoke execute on function public.rename_crew(uuid, text) from public, anon;
revoke execute on function public.dissolve_crew(uuid) from public, anon;
grant execute on function public.add_worker_to_crew(uuid, uuid) to authenticated, service_role;
grant execute on function public.remove_worker_from_crew(uuid, uuid) to authenticated, service_role;
grant execute on function public.move_worker_between_crews(uuid, uuid, uuid) to authenticated, service_role;
grant execute on function public.set_crew_lead(uuid, uuid) to authenticated, service_role;
grant execute on function public.rename_crew(uuid, text) to authenticated, service_role;
grant execute on function public.dissolve_crew(uuid) to authenticated, service_role;
