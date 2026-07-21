-- Spec 337 U1 — attributed WP transitions (fixes F1; carries F3).
--
-- Every work_packages.status write ran on the ADMIN (service-role) client,
-- because `authenticated` holds no UPDATE grant on the status / rework_round
-- columns (revoked at ERD-audit M2). The service-role session has no JWT `sub`,
-- so wp_transition_audit()'s auth.uid() / current_user_role() were NULL and
-- 100% of wp_status_transition audit rows recorded no actor. WHO submitted a
-- work package was stored nowhere.
--
-- The fix is the direction ERD-audit M2 started and set_work_package_hold
-- proved: the transition moves into a SECURITY DEFINER RPC the USER calls, so
-- the audit trigger sees the real actor. Gate + audit shape follow
-- reopen_work_package_for_defect.
--
--   * submit_work_package_for_approval — SITE_STAFF_ROLES; not_started /
--     in_progress / on_hold / rework → pending_approval. The PHOTO gate stays in
--     the server action (spec 247/248: it needs the current-photos anti-join
--     read). Split is deliberate — RPC owns the status/role invariant and the
--     attribution, the action owns the evidence rule.
--   * decide_work_package — PM_ROLES; the approvals row and the status flip in
--     ONE call. F3: `rejected` now means "send the work back" → the EXISTING
--     rework status + rework_round + 1, reusing the spec 144/216-218 machinery
--     (after_fix phase, defect pairing, current-round submit gate) with NO new
--     enum value. `needs_revision` stays evidence-cure and does not flip.
--     freeze_wp_labor_cost (spec 68) stays action-side on the PM session.
--   * resubmit_work_package_evidence — SITE_STAFF_ROLES; the explicit
--     ส่งตรวจอีกครั้ง that closes the cure loop (F2). No status change; it records
--     an attributed audit row and enqueues the wp_evidence_resubmitted ping to
--     the decider who asked for the re-shoot (enum added in …075826).
--
-- Same-errcode guards carry DISTINCT messages (spec 330 U3c lesson) so the
-- server actions and pgTAP can tell them apart.

-- ============================================================================
-- 1. submit_work_package_for_approval
-- ============================================================================
create or replace function public.submit_work_package_for_approval(p_wp uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role   public.user_role := public.current_user_role();
  v_status public.work_package_status;
begin
  -- SITE_STAFF_ROLES (src/lib/auth/role-home.ts): the field-capture population.
  -- procurement is a read-only WP viewer and must never submit. Null-safe: a
  -- session with no JWT (the old admin-client path) has no role and is refused.
  if not coalesce(v_role = any (array['site_admin', 'project_manager',
                                      'super_admin', 'project_director']::public.user_role[]), false) then
    raise exception 'submit_work_package_for_approval: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_wp(p_wp) then
    raise exception 'submit_work_package_for_approval: not a member of this project'
      using errcode = '42501';
  end if;

  -- FOR UPDATE serialises against a concurrent decide/submit on the same WP, so
  -- the status checked below is the status updated.
  select status into v_status from public.work_packages where id = p_wp for update;
  if not found then
    raise exception 'submit_work_package_for_approval: work package not found' using errcode = '22023';
  end if;
  -- TRANSITIONABLE_FROM_STATUSES (src/lib/photos/transitions.ts). Spec 144:
  -- rework is submittable — fixing a defect sends it back to review.
  if v_status not in ('not_started', 'in_progress', 'on_hold', 'rework') then
    raise exception 'submit_work_package_for_approval: cannot submit from status %', v_status
      using errcode = '22023';
  end if;

  update public.work_packages
     set status = 'pending_approval'
   where id = p_wp
     and status in ('not_started', 'in_progress', 'on_hold', 'rework');

  return true;
end;
$function$;

-- ============================================================================
-- 2. decide_work_package
-- ============================================================================
create or replace function public.decide_work_package(
  p_wp uuid,
  p_decision public.approval_decision,
  p_comment text default null
)
returns text
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role    public.user_role := public.current_user_role();
  v_uid     uuid             := auth.uid();
  v_status  public.work_package_status;
  v_comment text             := nullif(btrim(coalesce(p_comment, '')), '');
  v_new     public.work_package_status;
begin
  -- PM_ROLES (src/lib/auth/role-home.ts). The SA authors the evidence and never
  -- accepts it. Null-safe for the same reason as above.
  if not coalesce(v_role = any (array['project_manager', 'super_admin',
                                      'project_director']::public.user_role[]), false) then
    raise exception 'decide_work_package: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_wp(p_wp) then
    raise exception 'decide_work_package: not a member of this project' using errcode = '42501';
  end if;
  -- A negative decision without a comment leaves the SA nothing to act on.
  if p_decision <> 'approved' and v_comment is null then
    raise exception 'decide_work_package: comment required for this decision' using errcode = '22023';
  end if;

  select status into v_status from public.work_packages where id = p_wp for update;
  if not found then
    raise exception 'decide_work_package: work package not found' using errcode = '22023';
  end if;
  if v_status <> 'pending_approval' then
    raise exception 'decide_work_package: work package is not pending approval' using errcode = '22023';
  end if;

  -- The decision row first: approvals_notify_decision enqueues the wp_decision
  -- ping off this INSERT, and approvals_reject_group_wp keeps approval leaf-only.
  insert into public.approvals (work_package_id, decision, comment, decided_by)
  values (p_wp, p_decision, v_comment, v_uid);

  if p_decision = 'approved' then
    update public.work_packages set status = 'complete'
     where id = p_wp and status = 'pending_approval';
    v_new := 'complete';
  elsif p_decision = 'rejected' then
    -- F3 — the work send-back. Same state + counter the post-complete defect
    -- reopen uses, so the after_fix phase, the defect-photo pairing and the
    -- current-round submit gate all apply unchanged. Time spent in rework is
    -- also what arms the spec 325 §3 reason_code=rework pre-proposal (U3).
    update public.work_packages
       set status = 'rework', rework_round = rework_round + 1
     where id = p_wp and status = 'pending_approval';
    v_new := 'rework';
  else
    -- needs_revision = evidence cure: the WP stays in the queue awaiting new
    -- photos, and the SA closes the loop with resubmit_work_package_evidence.
    v_new := v_status;
  end if;

  return v_new::text;
end;
$function$;

-- ============================================================================
-- 3. resubmit_work_package_evidence
-- ============================================================================
create or replace function public.resubmit_work_package_evidence(p_wp uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role        public.user_role := public.current_user_role();
  v_uid         uuid             := auth.uid();
  v_wp          record;
  v_decision_id uuid;
  v_decision    public.approval_decision;
  v_decided_at  timestamptz;
  v_decided_by  uuid;
begin
  if not coalesce(v_role = any (array['site_admin', 'project_manager',
                                      'super_admin', 'project_director']::public.user_role[]), false) then
    raise exception 'resubmit_work_package_evidence: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_wp(p_wp) then
    raise exception 'resubmit_work_package_evidence: not a member of this project'
      using errcode = '42501';
  end if;

  select id, code, name, project_id, status into v_wp
    from public.work_packages where id = p_wp;
  if not found then
    raise exception 'resubmit_work_package_evidence: work package not found' using errcode = '22023';
  end if;
  if v_wp.status <> 'pending_approval' then
    raise exception 'resubmit_work_package_evidence: work package is not pending approval'
      using errcode = '22023';
  end if;

  -- The decision being answered = the LATEST one on this WP. Anything other than
  -- needs_revision means there is no outstanding re-shoot request.
  select id, decision, decided_at, decided_by
    into v_decision_id, v_decision, v_decided_at, v_decided_by
    from public.approvals
   where work_package_id = p_wp
   order by decided_at desc, id desc
   limit 1;
  if not found or v_decision <> 'needs_revision' then
    raise exception 'resubmit_work_package_evidence: no revision request to answer'
      using errcode = '22023';
  end if;

  -- The gate (spec 337 F2): at least one CURRENT completion photo shot AFTER the
  -- decision. Current-state read is the supersede anti-join + tombstone check
  -- (ADR 0009/0015) — a removed photo never satisfies the gate.
  if not exists (
    select 1 from public.photo_logs pl
     where pl.work_package_id = p_wp
       and pl.phase in ('after', 'after_fix')
       and pl.storage_path is not null
       and pl.created_at > v_decided_at
       and not exists (select 1 from public.photo_logs n where n.superseded_by = pl.id)
  ) then
    raise exception 'resubmit_work_package_evidence: no new photo since the revision request'
      using errcode = '22023';
  end if;

  insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
  values (
    v_uid, v_role, 'other', 'work_packages', p_wp,
    jsonb_build_object(
      'event', 'wp_evidence_resubmitted',
      'answers_decision_id', v_decision_id,
      'decided_by', v_decided_by
    )
  );

  -- Ping the DECIDER, not the approval pool — they wrote the free-text ask, so
  -- they are the one who can tell whether it was answered. Deliberately NOT
  -- wrapped in an exception handler (unlike the notify_* triggers): the ping is
  -- the whole point of the call, so a failed enqueue must fail the resubmit and
  -- let the SA retry rather than silently close the loop with nobody told.
  insert into public.notification_outbox (event_type, work_package_id, payload)
  values (
    'wp_evidence_resubmitted', p_wp,
    jsonb_build_object(
      'code', v_wp.code,
      'name', v_wp.name,
      'project_id', v_wp.project_id,
      'decided_by', v_decided_by,
      'resubmitted_by', v_uid
    )
  );

  return true;
end;
$function$;

-- ============================================================================
-- Grants — house lockdown. `revoke … from anon` alone leaves Postgres's default
-- PUBLIC EXECUTE in place (spec 336 shipped that bug; the 229 lockdown pgTAP
-- caught it), so revoke from public AND anon before granting.
-- ============================================================================
revoke all on function public.submit_work_package_for_approval(uuid) from public, anon;
revoke all on function public.decide_work_package(uuid, public.approval_decision, text) from public, anon;
revoke all on function public.resubmit_work_package_evidence(uuid) from public, anon;

grant execute on function public.submit_work_package_for_approval(uuid) to authenticated;
grant execute on function public.decide_work_package(uuid, public.approval_decision, text) to authenticated;
grant execute on function public.resubmit_work_package_evidence(uuid) to authenticated;
