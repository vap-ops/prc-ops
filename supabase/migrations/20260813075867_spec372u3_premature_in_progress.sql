-- Spec 372 U3 — "งานยังไม่เสร็จ" sends the work package back to the site.
--
-- ADDITIVE, body-only: sourced from the LIVE pg_get_functiondef (never a migration
-- file, which can be stale or edited-after-apply). Signature, SECURITY DEFINER,
-- search_path, grants, and the approved / rejected / photo-cause arms are byte-
-- identical to what is running; the only change is the new premature branch.
--
-- Why this matters: 0 of 59 needs_revision decisions have ever used premature, and
-- 0 of 397 work packages have ever entered rework. The review queue was holding
-- items nobody could action, which is exactly what spec 371 was reported for.
CREATE OR REPLACE FUNCTION public.decide_work_package(p_wp uuid, p_decision approval_decision, p_comment text DEFAULT NULL::text, p_revision_reason approval_revision_reason DEFAULT NULL::approval_revision_reason)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  elsif p_revision_reason = 'premature' then
    -- Spec 372 U3 — "งานยังไม่เสร็จ". The WORK is unfinished, so the WP goes back to
    -- the site as ordinary active work rather than sitting in a review queue nobody
    -- can action (the complaint that drove spec 371).
    --
    -- Deliberately NOT 'rework': canSubmitForApproval demands a CURRENT-ROUND
    -- after_fix photo once a WP is in rework, so an SA who merely FINISHED the work
    -- would be ordered to file completion photos as after-FIX for a repair that never
    -- happened. in_progress keeps 'after' as the completion evidence, and the WP is
    -- already in TRANSITIONABLE_FROM_STATUSES so the ordinary submit door reopens.
    --
    -- No round advance: nothing was defective, so this is not a rework cycle.
    -- p_revision_reason is non-null here — the guard above requires it for
    -- needs_revision, and the two other decisions returned before this branch.
    update public.work_packages
       set status = 'in_progress'
     where id = p_wp and status = 'pending_approval';
    v_new := 'in_progress';
  else
    -- The two PHOTO causes (incomplete / mismatch): the work is done and only the
    -- evidence is wrong, so the WP stays in the queue awaiting new photos and the SA
    -- closes the loop with resubmit_work_package_evidence.
    v_new := v_status;
  end if;

  return v_new::text;
end;
$function$
;
