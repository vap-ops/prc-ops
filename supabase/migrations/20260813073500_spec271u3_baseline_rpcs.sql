-- Spec 271 U3 / ADR 0075 D3 — baseline propose / approve RPCs.
--
-- plan_baselines is FULLY append-only (no post-insert stamping), so the
-- two-step flow resolves to ONE insert at approval time:
--   * propose_plan_baseline (site_owner / manager-tier, project member)
--     validates, FREEZES the snapshot — the per-leaf planned windows as of
--     propose time — into an audit_log proposal event, and returns that
--     event's id. What the approver reviews is exactly what lands, even if
--     the live plan drifts in between.
--   * approve_plan_baseline (PD / super) loads the frozen event, guards
--     against double-approval and vanished leaves, and INSERTs the
--     plan_baselines row (stamping BOTH actors: proposer from the event,
--     approver = caller) plus its plan_baseline_items.
-- No proposal table: the spec's data model (§4) defines none, audit_log rows
-- are immutable, and authenticated cannot INSERT audit_log (#242) — so a
-- proposal event is forgeable by no one and needs no extra machinery.
-- Unapproved proposals simply expire unused (no reject flow in v1).
--
-- Snapshot rules (D3/D8):
--   initial      — first version only; full snapshot; may carry scoring_go_live.
--   rebaseline   — full re-snapshot; reason required; anchor stays v1.
--   scope_change — ONLY the explicitly listed leaves; reason required.
-- NULL-dated leaves are omitted (class `unplanned`); an empty snapshot is
-- rejected. Leaf-of-project validation happens at propose AND re-checked at
-- approve (a deleted/regrouped leaf invalidates the proposal rather than
-- silently shrinking what the approver saw).

create function public.propose_plan_baseline(
  p_project_id uuid,
  p_kind public.plan_baseline_kind,
  p_reason text default null,
  p_work_package_ids uuid[] default null,
  p_scoring_go_live date default null
)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role     public.user_role := public.current_user_role();
  v_uid      uuid := auth.uid();
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
  v_items    jsonb;
  v_count    integer;
  v_audit_id uuid;
begin
  if not (public.is_manager(v_role) or coalesce(v_role = 'site_owner', false)) then
    raise exception 'propose_plan_baseline: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_project(p_project_id) then
    raise exception 'propose_plan_baseline: not a member of this project'
      using errcode = '42501';
  end if;
  -- The PD/super arm of can_see_project is TRUE for any uuid — pin existence.
  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception 'propose_plan_baseline: unknown project' using errcode = '22023';
  end if;

  if p_kind = 'initial' then
    if exists (select 1 from public.plan_baselines b where b.project_id = p_project_id) then
      raise exception 'propose_plan_baseline: a baseline already exists — propose rebaseline or scope_change'
        using errcode = '22023';
    end if;
  else
    if v_reason is null then
      raise exception 'propose_plan_baseline: reason required for a non-initial version'
        using errcode = '22023';
    end if;
    if not exists (select 1 from public.plan_baselines b where b.project_id = p_project_id) then
      raise exception 'propose_plan_baseline: no baseline to iterate — propose initial first'
        using errcode = '22023';
    end if;
  end if;
  if p_scoring_go_live is not null and p_kind <> 'initial' then
    raise exception 'propose_plan_baseline: scoring_go_live is initial-only (D8)'
      using errcode = '22023';
  end if;
  if p_kind = 'scope_change' then
    if p_work_package_ids is null or cardinality(p_work_package_ids) = 0 then
      raise exception 'propose_plan_baseline: scope_change requires the explicit leaf list (D3)'
        using errcode = '22023';
    end if;
  elsif p_work_package_ids is not null then
    raise exception 'propose_plan_baseline: a leaf list is scope_change-only'
      using errcode = '22023';
  end if;

  if p_kind = 'scope_change' then
    select jsonb_agg(jsonb_build_object(
             'work_package_id', w.id,
             'planned_start', w.planned_start,
             'planned_end', w.planned_end) order by w.code),
           count(*)
      into v_items, v_count
      from public.work_packages w
     where w.id = any (p_work_package_ids)
       and w.project_id = p_project_id
       and not w.is_group
       and w.planned_start is not null
       and w.planned_end is not null;
    if v_count <> (select count(distinct x) from unnest(p_work_package_ids) x) then
      raise exception 'propose_plan_baseline: every listed id must be a dated leaf of this project'
        using errcode = '22023';
    end if;
  else
    select jsonb_agg(jsonb_build_object(
             'work_package_id', w.id,
             'planned_start', w.planned_start,
             'planned_end', w.planned_end) order by w.code),
           count(*)
      into v_items, v_count
      from public.work_packages w
     where w.project_id = p_project_id
       and not w.is_group
       and w.planned_start is not null
       and w.planned_end is not null;
  end if;
  if coalesce(v_count, 0) = 0 then
    raise exception 'propose_plan_baseline: no dated leaves to snapshot' using errcode = '22023';
  end if;

  insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
  values (
    v_uid, v_role, 'other', 'projects', p_project_id,
    jsonb_build_object(
      'event', 'plan_baseline_proposed',
      'project_id', p_project_id,
      'kind', p_kind,
      'reason', v_reason,
      'scoring_go_live', p_scoring_go_live,
      'item_count', v_count,
      'items', v_items
    )
  )
  returning id into v_audit_id;

  return v_audit_id;
end;
$function$;

create function public.approve_plan_baseline(p_proposal_id uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role    public.user_role := public.current_user_role();
  v_prop    public.audit_log%rowtype;
  v_project uuid;
  v_kind    public.plan_baseline_kind;
  v_version integer;
  v_id      uuid;
  v_bad     integer;
begin
  if not coalesce(v_role in ('project_director', 'super_admin'), false) then
    raise exception 'approve_plan_baseline: role not permitted' using errcode = '42501';
  end if;

  select * into v_prop
    from public.audit_log a
   where a.id = p_proposal_id
     and a.payload->>'event' = 'plan_baseline_proposed';
  if not found then
    raise exception 'approve_plan_baseline: unknown proposal' using errcode = '22023';
  end if;
  v_project := (v_prop.payload->>'project_id')::uuid;
  v_kind    := (v_prop.payload->>'kind')::public.plan_baseline_kind;

  -- Serialize per project: version assignment + the consumed check race.
  perform pg_advisory_xact_lock(
    hashtextextended('plan_baseline|' || v_project::text, 0));

  if exists (
    select 1 from public.audit_log a
     where a.payload->>'event' = 'plan_baseline_approved'
       and a.payload->>'proposal_id' = p_proposal_id::text
  ) then
    raise exception 'approve_plan_baseline: proposal already approved' using errcode = '22023';
  end if;
  if v_kind = 'initial'
     and exists (select 1 from public.plan_baselines b where b.project_id = v_project) then
    raise exception 'approve_plan_baseline: a baseline already exists for this project'
      using errcode = '22023';
  end if;

  select count(*) into v_bad
    from jsonb_array_elements(v_prop.payload->'items') it
    left join public.work_packages w
      on w.id = (it->>'work_package_id')::uuid
     and w.project_id = v_project
     and not w.is_group
   where w.id is null;
  if v_bad > 0 then
    raise exception 'approve_plan_baseline: % frozen leaves no longer exist — propose again', v_bad
      using errcode = '22023';
  end if;

  select coalesce(max(b.version), 0) + 1 into v_version
    from public.plan_baselines b where b.project_id = v_project;

  insert into public.plan_baselines
    (project_id, version, kind, reason, as_of, scoring_go_live, proposed_by, approved_by)
  values
    (v_project, v_version, v_kind,
     v_prop.payload->>'reason',
     v_prop.created_at,                              -- as_of = the snapshot cut (propose time)
     (v_prop.payload->>'scoring_go_live')::date,
     v_prop.actor_id,                                -- proposer, from the immutable event
     auth.uid())
  returning id into v_id;

  insert into public.plan_baseline_items (baseline_id, work_package_id, planned_start, planned_end)
  select v_id,
         (it->>'work_package_id')::uuid,
         (it->>'planned_start')::date,
         (it->>'planned_end')::date
    from jsonb_array_elements(v_prop.payload->'items') it;

  insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
  values (
    auth.uid(), v_role, 'other', 'plan_baselines', v_id,
    jsonb_build_object(
      'event', 'plan_baseline_approved',
      'proposal_id', p_proposal_id,
      'baseline_id', v_id,
      'project_id', v_project,
      'version', v_version,
      'item_count', jsonb_array_length(coalesce(v_prop.payload->'items', '[]'::jsonb))
    )
  );

  return v_id;
end;
$function$;

revoke all on function public.propose_plan_baseline(uuid, public.plan_baseline_kind, text, uuid[], date)
  from public, anon;
revoke all on function public.approve_plan_baseline(uuid) from public, anon;
grant execute on function public.propose_plan_baseline(uuid, public.plan_baseline_kind, text, uuid[], date)
  to authenticated, service_role;
grant execute on function public.approve_plan_baseline(uuid) to authenticated, service_role;
