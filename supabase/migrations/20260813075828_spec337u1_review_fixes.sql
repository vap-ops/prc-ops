-- Spec 337 U1 — fresh-eyes review fixes on top of …075827.
--
-- A NEW migration rather than an edit of …075827: that file is already applied
-- on the shared remote DB, and re-pushing an edited applied migration silently
-- no-ops (house lesson, memory `prc-ops-db-migration-lessons`).
--
-- 1. F3 was surfacing NOTHING to the SA. `rejected` flipped the WP to rework,
--    but every "why is this WP in rework" reader — /sa's ต้องแก้ไข list
--    (src/app/sa/page.tsx), the WP detail rework banner + per-round หลังแก้ไข
--    gallery labels (src/lib/work-packages/load-detail.ts), and the review
--    page's round context — reads ONLY `wp_reopened_for_defect` audit rows.
--    Worse, that is the ONLY audit event a site_admin may read at all (RLS
--    policy "audit_log select wp rework events" filters on exactly that string),
--    so the PM's mandatory rejection comment was invisible to the person who has
--    to act on it. `decide_work_package` now records the rejection as a
--    rework-round row in that same shape — reason = the PM's comment, source =
--    'internal', plus a `via: 'review_rejection'` discriminator so a review
--    rejection stays distinguishable in the data from a post-complete defect
--    reopen (the spec 325 §3 arm depends on that distinction).
-- 2. `resubmit_work_package_evidence` was neither locked nor idempotent: a
--    double-tap of ส่งตรวจอีกครั้ง on a flaky connection passed the same gate
--    twice and pinged the decider twice. Takes the row lock and refuses a
--    second resubmit answering the same decision.
-- 3. `btrim(x)` strips SPACES ONLY, so a tab- or newline-only comment satisfied
--    the comment-required rule that the JS `.trim()` on the form rejects. Both
--    RPCs now trim the full whitespace set.
-- 4. Widen the site_admin/procurement audit_log read to the resubmit event —
--    the SA is the AUTHOR of that row and could not read it back, which also
--    blocks spec 337 U2's "clear the action-list item once a resubmit newer
--    than the decision exists" condition.

-- ============================================================================
-- 1 + 3. decide_work_package
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

-- ============================================================================
-- 2 + 3. resubmit_work_package_evidence
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

  -- FOR UPDATE serialises a double-tap of ส่งตรวจอีกครั้ง (flaky mobile
  -- connection, action retry) so the idempotency guard below cannot be raced.
  select id, code, name, project_id, status into v_wp
    from public.work_packages where id = p_wp for update;
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

  -- Idempotency: one resubmit per decision. Without this a retry enqueues a
  -- second ping for the same round and the decider is told twice.
  if exists (
    select 1 from public.audit_log a
     where a.target_table = 'work_packages'
       and a.target_id = p_wp
       and a.payload->>'event' = 'wp_evidence_resubmitted'
       and a.payload->>'answers_decision_id' = v_decision_id::text
  ) then
    raise exception 'resubmit_work_package_evidence: this revision request was already answered'
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
-- 4. Let the SA read back the row they just wrote.
-- ============================================================================
drop policy if exists "audit_log select wp rework events" on public.audit_log;
create policy "audit_log select wp rework events" on public.audit_log
  for select to authenticated
  using (
    coalesce(public.current_user_role()::text, '') = any (
      array['site_admin', 'procurement', 'procurement_manager'])
    and (payload->>'event') in ('wp_reopened_for_defect', 'wp_evidence_resubmitted')
  );
