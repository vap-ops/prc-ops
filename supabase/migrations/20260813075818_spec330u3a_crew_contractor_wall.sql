-- Spec 330 U3a — put the spec-328 §2.4 contractor money wall in POSTGRES.
--
-- FOUND BY an adversarial review of the U3 plan (2026-07-19), verified live:
-- the wall was THREE UI query filters and nothing in the database
-- (tests/unit/contractor-money-wall.test.ts says so in its own header:
-- "source-pins the query-level filters that have no unit seam of their own").
-- Spec 330 U2 then opened the FIRST write path into crew_members — and the
-- /sa/plan DRAFT reads crews + crew_members with NO contractor filter
-- (src/app/sa/plan/page.tsx:151-154; only the MANUAL picker at :80-84 has it).
-- Chain, every link verified unfiltered:
--   crew_members → tomorrow-draft → set_daily_plan_item_crew → mark-present
--   → log_labor_day → labor_logs → aggregatePayroll + wp_labor_costs (DC).
-- A contractor-tied worker (workers.contractor_id not null) is PAY-EXEMPT —
-- the firm pays them, PRC never does — so one crew row would become real baht
-- PRC does not owe, plus a DC double-count against a WP whose contract price
-- already includes that labour. Harmless only because crew_members is empty
-- TODAY; U2 removed the "nothing can write it" assumption.
--
-- The wall belongs on the WRITE (one place) rather than on every reader.
-- TWO LAYERS, because a first pass that only patched function bodies was shown
-- by review to be incomplete — `reassign_crew_lead` (spec-279, mig 075410) is a
-- SECOND unwalled writer of crews.lead_worker_id, `set_crew_lead` inferred the
-- wall from membership (not equivalent: remove_worker_from_crew and
-- dissolve_crew leave lead_worker_id standing), and `approve_crew_registration`
-- INSERTs into crew_members directly (safe only incidentally, because it mints
-- a fresh worker):
--
--   LAYER 1 — function arms on every writer, for a friendly mappable 22023:
--     add_worker_to_crew · move_worker_between_crews · create_crew ·
--     set_crew_lead · reassign_crew_lead.
--   LAYER 2 — TRIGGERS that make the invariant airtight regardless of writer
--     (incl. future RPCs, approve_crew_registration, and direct SQL):
--     * crew_members: no ACTIVE membership for a contractor-tied worker;
--     * crews: no contractor-tied lead_worker_id;
--     * workers: cannot tie a worker to a firm while they hold an active
--       membership or lead a crew (the reverse direction — update_worker's
--       `contractor_id = coalesce(p_contractor, contractor_id)` could
--       otherwise flip a sitting crew member into a pay-exempt one).
--
-- REMOVAL is deliberately never walled: a pre-wall row must never be trapped
-- (the crew_members trigger fires only when removed_at IS NULL).
--
-- Function replaces are CREATE OR REPLACE of bodies re-sourced from the LIVE
-- database (not from migration files) — ACLs are preserved by replace-in-place.

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
$$;

-- create_crew: body re-sourced LIVE (spec 279 mig 075410) — only the money
-- wall is added. Its lead feeds the /sa/plan draft, so the lead is a pay path.
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
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_crew_id uuid;
  v_lead_contractor uuid;
begin
  if not public.is_back_office(v_role) then
    raise exception 'not authorized to create a crew' using errcode = '42501';
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
$$;

-- set_crew_lead: the membership requirement is NOT equivalent to the wall
-- (a pre-wall membership, or a lead left standing by remove/dissolve, both
-- slip through) — wall the lead directly. Body re-sourced live (mig 075817).
create or replace function public.set_crew_lead(p_crew uuid, p_worker uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_active boolean;
  v_contractor uuid;
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
$$;

-- reassign_crew_lead (spec 279, mig 075410): the OTHER lead writer — found
-- unwalled by review. Body re-sourced live; only the wall is added.
create or replace function public.reassign_crew_lead(p_crew uuid, p_new_lead uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_contractor uuid;
begin
  if not public.is_back_office(v_role) then
    raise exception 'not authorized to reassign a crew lead' using errcode = '42501';
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
  if not found then
    raise exception 'crew not found' using errcode = 'P0002';
  end if;

  insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload)
  values ('crew_change', auth.uid(), v_role, 'crews', p_crew,
          jsonb_build_object('op', 'reassign_lead', 'lead_worker_id', p_new_lead));
end;
$$;

-- ── LAYER 2: the invariant as triggers (writer-agnostic) ──────────────────
-- A function arm gives a friendly error; a trigger is what makes the wall
-- true. These fire for ANY writer — future RPCs, approve_crew_registration,
-- an admin-client write, or raw SQL.

create or replace function public.crew_member_not_contractor()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  -- Only ACTIVE membership is walled: closing/removing a pre-wall row is
  -- always allowed, so a bad row can never be trapped.
  if new.removed_at is null
     and exists (select 1 from public.workers w
                  where w.id = new.worker_id and w.contractor_id is not null) then
    raise exception 'contractor-tied worker is pay-exempt and cannot join a crew'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists crew_members_money_wall on public.crew_members;
create trigger crew_members_money_wall
  before insert or update on public.crew_members
  for each row execute function public.crew_member_not_contractor();

create or replace function public.crew_lead_not_contractor()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.lead_worker_id is not null
     and exists (select 1 from public.workers w
                  where w.id = new.lead_worker_id and w.contractor_id is not null) then
    raise exception 'contractor-tied worker is pay-exempt and cannot lead a crew'
      using errcode = '22023';
  end if;
  return new;
end;
$$;

drop trigger if exists crews_lead_money_wall on public.crews;
create trigger crews_lead_money_wall
  before insert or update on public.crews
  for each row execute function public.crew_lead_not_contractor();

-- The REVERSE direction: tying an existing crew member/lead to a firm would
-- flip a costed worker pay-exempt underneath the crew graph (update_worker's
-- `contractor_id = coalesce(p_contractor, contractor_id)` reaches here).
create or replace function public.worker_firm_tie_not_in_crew()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.contractor_id is not null and old.contractor_id is null then
    if exists (select 1 from public.crew_members cm
                where cm.worker_id = new.id and cm.removed_at is null) then
      raise exception 'worker is in a crew — remove them from the crew before tying them to a firm'
        using errcode = '22023';
    end if;
    if exists (select 1 from public.crews c where c.lead_worker_id = new.id) then
      raise exception 'worker leads a crew — reassign the crew lead before tying them to a firm'
        using errcode = '22023';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists workers_firm_tie_money_wall on public.workers;
create trigger workers_firm_tie_money_wall
  before update on public.workers
  for each row execute function public.worker_firm_tie_not_in_crew();
