-- Spec 355 U1 — structured reject-evidence reasons.
--
-- The PM's reject-evidence (needs_revision) decision carries WHY the photos were
-- sent back, so the SA gets the correct next-action (mismatch = remove-and-reshoot,
-- not "add more"). New enum + a nullable column on approvals + one more arg on
-- decide_work_package with a three-arm validation. The rejected → rework +
-- rework_round++ + wp_reopened_for_defect audit write is preserved VERBATIM (it is
-- sourced from the live function body; see 337-approval-rpcs).

create type public.approval_revision_reason as enum ('incomplete', 'mismatch', 'premature');

alter table public.approvals
  add column revision_reason public.approval_revision_reason;

comment on column public.approvals.revision_reason is
  'Spec 355: why a needs_revision decision sent the photos back (incomplete/mismatch/premature). Null for approved and rejected.';

-- Adding a parameter to a DEFINER RPC: DROP the old signature first (a 4-arg
-- create-or-replace would leave the 3-arg overload behind → ambiguous call),
-- then re-create from the LIVE body (spec 336/270 U4 pattern).
drop function if exists public.decide_work_package(uuid, approval_decision, text);

create or replace function public.decide_work_package(
  p_wp uuid,
  p_decision approval_decision,
  p_comment text default null,
  p_revision_reason approval_revision_reason default null
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
  -- btrim(x) alone strips spaces only; pin the whole whitespace set so the SQL
  -- backstop is at least as strict as the form's JS .trim().
  v_comment text             := nullif(btrim(coalesce(p_comment, ''), E' \t\n\r\f\v'), '');
  v_new     public.work_package_status;
  v_round   smallint;
begin
  -- PM_ROLES (src/lib/auth/role-home.ts). The SA authors the evidence and never
  -- accepts it. Null-safe: a session with no JWT (the old admin-client path) has
  -- no role and is refused.
  if not coalesce(v_role = any (array['project_manager', 'super_admin',
                                      'project_director']::public.user_role[]), false) then
    raise exception 'decide_work_package: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_wp(p_wp) then
    raise exception 'decide_work_package: not a member of this project' using errcode = '42501';
  end if;

  -- Spec 355 — reject-evidence (needs_revision) carries a structured reason and
  -- the comment is now optional DETAIL. reject-work (rejected) keeps its required
  -- defect comment and must NOT carry a reason. approved carries neither.
  if p_decision = 'needs_revision' and p_revision_reason is null then
    raise exception 'decide_work_package: revision reason required' using errcode = '22023';
  end if;
  if p_decision <> 'needs_revision' and p_revision_reason is not null then
    raise exception 'decide_work_package: revision reason only for needs_revision' using errcode = '22023';
  end if;
  if p_decision = 'rejected' and v_comment is null then
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
  insert into public.approvals (work_package_id, decision, comment, decided_by, revision_reason)
  values (p_wp, p_decision, v_comment, v_uid, p_revision_reason);

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
     where id = p_wp and status = 'pending_approval'
    returning rework_round into v_round;

    -- …and the round's REASON, in the one shape every rework reader consumes
    -- (and the only audit event a site_admin's RLS admits). `via` keeps a review
    -- rejection distinguishable from a post-complete defect reopen.
    insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
    values (
      v_uid, v_role, 'other', 'work_packages', p_wp,
      jsonb_build_object(
        'event',  'wp_reopened_for_defect',
        'reason', v_comment,
        'round',  v_round,
        'source', 'internal',
        'via',    'review_rejection'
      )
    );
    v_new := 'rework';
  else
    -- needs_revision = evidence cure: the WP stays in the queue awaiting new
    -- photos, and the SA closes the loop with resubmit_work_package_evidence.
    v_new := v_status;
  end if;

  return v_new::text;
end;
$function$;

-- Reproduce the live grants exactly (a DROP+CREATE resets them): no PUBLIC/anon,
-- EXECUTE to authenticated + service_role.
revoke all on function public.decide_work_package(uuid, approval_decision, text, approval_revision_reason) from public, anon;
grant execute on function public.decide_work_package(uuid, approval_decision, text, approval_revision_reason) to authenticated, service_role;
