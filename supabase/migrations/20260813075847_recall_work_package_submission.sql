-- Spec 352 — ถอนงานกลับมาแก้ไข: recall a submitted WP to fix its evidence.
--
-- Photo removal on a pending_approval WP is frozen (photo_wp_deletable excludes
-- pending_approval/complete; the only unlock is an OPEN ให้แก้ไข window). A WP
-- submitted too early, or with misplaced photos, and not yet decided, strands
-- its evidence — nobody (not even super_admin) can fix it without a reviewer
-- first pressing ให้แก้ไข, charging the WORK a revision cycle for a PHOTO-only
-- mistake. Recall is the honest inverse of ส่งงานเข้าตรวจ: it pulls the WP back
-- to in_progress, where the existing remove/add flow already works, then the SA
-- re-submits. The 291/340 evidence freeze is preserved, not weakened — changing
-- photos now requires taking the WP OUT of review (this audited status change),
-- never a silent in-place edit on a frozen WP.

-- The shared predicate. The RPC enforces with it AND load-detail renders the
-- button from it, so RLS and the affordance share ONE authority and cannot
-- drift (the photo_removal_allowed pattern). SECURITY DEFINER because the
-- submitter read hits audit_log, whose SELECT is an EVENT ALLOWLIST that does
-- not admit wp_status_transition to a user session — the DEFINER reads it as
-- owner.
create or replace function public.can_recall_work_package(p_wp uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with latest as (
    select a.id, a.decision
      from public.approvals a
     where a.work_package_id = p_wp
     order by a.decided_at desc, a.id desc
     limit 1
  ),
  submitter as (
    -- The actor who last moved this WP into pending_approval. Spec 337 U1
    -- attributed transitions record it; a pre-337 submission has none, so this
    -- is null and only the super_admin arm below can open (fail closed).
    select g.actor_id
      from public.audit_log g
     where g.target_table = 'work_packages'
       and g.target_id = p_wp
       and g.payload->>'event' = 'wp_status_transition'
       and g.payload->>'to_status' = 'pending_approval'
     order by g.created_at desc, g.id desc
     limit 1
  )
  select coalesce(
    -- WP_SUBMIT_ROLES (src/lib/auth/role-home.ts) — the set the recall ACTION
    -- gates on, and the array the LIVE submit_work_package_for_approval re-states
    -- (widened to include procurement_manager by spec 348 U3; the original
    -- migration 075827 predated that, so read the live function, not the file).
    -- A since-demoted submitter now holding plain procurement (a read-only WP
    -- viewer) is excluded here and cannot recall.
    public.current_user_role() = any (array['site_admin', 'project_manager',
      'super_admin', 'project_director', 'procurement_manager']::public.user_role[])
    and public.can_see_wp(p_wp)
    and (select w.status = 'pending_approval' from public.work_packages w where w.id = p_wp)
    -- The ให้แก้ไข window must be CLOSED. Same shape as photo_removal_allowed's
    -- window arm (latest decision needs_revision, not yet answered by a
    -- wp_evidence_resubmitted row): recall and that in-place-removal window are
    -- mutually exclusive (spec 352 D4).
    and not (
      -- `is not distinct from` (not `=`): with NO decision yet (the fresh
      -- submission — the primary case) `null = 'needs_revision'` is NULL, and
      -- the negation would propagate NULL → coalesce false → a fresh WP would be
      -- wrongly un-recallable. `is not distinct from` yields false there, so
      -- no-decision reads as window-CLOSED (recallable).
      (select l.decision from latest l) is not distinct from 'needs_revision'
      and not exists (
        select 1 from public.audit_log g
         where g.target_table = 'work_packages'
           and g.target_id = p_wp
           and g.payload->>'event' = 'wp_evidence_resubmitted'
           and g.payload->>'answers_decision_id' = (select l.id::text from latest l)
      )
    )
    -- Authority: the original submitter, or super_admin (spec 352 D3). A null
    -- submitter (pre-337) makes `submitter = auth.uid()` null → the whole chain
    -- coalesces to false, so only the super_admin arm opens it.
    and (
      public.current_user_role() = 'super_admin'
      or (select s.actor_id from submitter s) = (select auth.uid())
    ),
    false);
$$;

-- The transition. Runs on the CALLER's session so the existing
-- work_packages_transition_audit trigger stamps the actor and
-- pending_approval → in_progress (no new audit event — that from/to pair is a
-- recall and nothing else). FOR UPDATE serialises against a concurrent
-- decide/submit so the status checked is the status written.
create or replace function public.recall_work_package_submission(p_wp uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.work_package_status;
begin
  select status into v_status from public.work_packages where id = p_wp for update;
  if not found then
    raise exception 'recall_work_package_submission: work package not found' using errcode = '22023';
  end if;
  -- can_recall_work_package folds role, membership, status and the window-closed
  -- authority into one boolean — the single authority the button also reads.
  if not public.can_recall_work_package(p_wp) then
    raise exception 'recall_work_package_submission: recall not permitted' using errcode = '42501';
  end if;
  update public.work_packages
     set status = 'in_progress'
   where id = p_wp
     and status = 'pending_approval';
  return true;
end;
$$;

-- House lockdown: neither PUBLIC nor anon may execute; only authenticated.
revoke all on function public.can_recall_work_package(uuid) from public, anon;
revoke all on function public.recall_work_package_submission(uuid) from public, anon;
grant execute on function public.can_recall_work_package(uuid) to authenticated;
grant execute on function public.recall_work_package_submission(uuid) to authenticated;
