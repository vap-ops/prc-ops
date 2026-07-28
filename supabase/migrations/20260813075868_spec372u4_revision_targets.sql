-- Spec 372 U4 — the PM says WHICH phases (and, from U4b, which photos) are wrong.
--
-- ADDITIVE. One new table + two new DEFAULTED params on decide_work_package. The RPC
-- body is sourced from the LIVE pg_get_functiondef; SECURITY DEFINER, search_path,
-- grants and every existing arm are unchanged.
--
-- Why: "ถ่ายรูปใหม่" on a work package carrying a MEDIAN OF 10 photos makes the site
-- admin hunt for an unnamed fault. The cause decides the axis — incomplete points at
-- ABSENCE (only a phase can carry it; you cannot tap a photo that was never taken),
-- mismatch points at photos that exist.
--
-- One table carries BOTH shapes with a CHECK enforcing exactly-one, so the photo half
-- (U4b) needs no further schema. Writes go through the RPC only: the table has a read
-- policy and no write policy at all.

create table if not exists public.approval_revision_targets (
  id            uuid primary key default gen_random_uuid(),
  approval_id   uuid not null references public.approvals(id) on delete cascade,
  -- Exactly one of these is set; the CHECK below is the enforcement.
  phase         public.photo_phase,
  photo_log_id  uuid references public.photo_logs(id),
  created_at    timestamptz not null default now(),
  constraint approval_revision_targets_exactly_one
    check ((phase is null) <> (photo_log_id is null))
);

comment on table public.approval_revision_targets is
  $c$Spec 372 U4 — what a needs_revision decision points AT: flagged lifecycle phases
(reason=incomplete) or flagged current photos (reason=mismatch). Append-only in
practice: written only by decide_work_package, and a decision is never edited.$c$;

-- Partial uniques, because the PK cannot span a nullable pair.
create unique index if not exists approval_revision_targets_phase_uniq
  on public.approval_revision_targets (approval_id, phase) where phase is not null;
create unique index if not exists approval_revision_targets_photo_uniq
  on public.approval_revision_targets (approval_id, photo_log_id) where photo_log_id is not null;
-- The read path is always "the targets of this decision".
create index if not exists approval_revision_targets_approval_idx
  on public.approval_revision_targets (approval_id);

alter table public.approval_revision_targets enable row level security;

-- Mirrors the PARENT approvals read policy exactly, one join away: whoever may read
-- the decision may read what it points at. Deliberately NO insert/update/delete
-- policy — decide_work_package is SECURITY DEFINER and is the only writer.
drop policy if exists "revision targets readable with their decision"
  on public.approval_revision_targets;
create policy "revision targets readable with their decision"
  on public.approval_revision_targets for select
  using (
    exists (
      select 1 from public.approvals a
       where a.id = approval_revision_targets.approval_id
         and (
           (select public.current_user_role()) = any (array['procurement', 'procurement_manager']::public.user_role[])
           or (select public.can_see_wp(a.work_package_id))
         )
    )
  );

grant select on public.approval_revision_targets to authenticated;

CREATE OR REPLACE FUNCTION public.decide_work_package(p_wp uuid, p_decision approval_decision, p_comment text DEFAULT NULL::text, p_revision_reason approval_revision_reason DEFAULT NULL::approval_revision_reason, p_target_phases photo_phase[] DEFAULT NULL::photo_phase[], p_target_photo_ids uuid[] DEFAULT NULL::uuid[])
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
  v_approval uuid;
  v_phase   public.photo_phase;
  v_photo   uuid;
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
  -- Spec 372 U4 — the CAUSE decides which target shape is legal. incomplete points
  -- at ABSENCE (only a phase can carry it); mismatch points at photos that exist.
  if (p_target_phases is not null or p_target_photo_ids is not null)
     and p_decision <> 'needs_revision' then
    raise exception 'decide_work_package: targets are only for needs_revision'
      using errcode = '22023';
  end if;
  if p_target_phases is not null and p_revision_reason <> 'incomplete' then
    raise exception 'decide_work_package: flagged phases are only for incomplete'
      using errcode = '22023';
  end if;
  if p_target_photo_ids is not null and p_revision_reason <> 'mismatch' then
    raise exception 'decide_work_package: flagged photos are only for mismatch'
      using errcode = '22023';
  end if;
  -- after_fix / defect are not the WP's completion evidence on a normal cycle, so
  -- 'this phase is missing' is meaningless for them.
  if p_target_phases is not null
     and exists (select 1 from unnest(p_target_phases) ph
                  where ph not in ('before', 'during', 'after')) then
    raise exception 'decide_work_package: only lifecycle phases can be flagged'
      using errcode = '22023';
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
  values (p_wp, p_decision, v_comment, v_uid, p_revision_reason)
  returning id into v_approval;

  -- Spec 372 U4 — WHAT the SA must fix, so a 10-photo work package does not send
  -- them hunting for an unnamed fault.
  if p_target_phases is not null then
    insert into public.approval_revision_targets (approval_id, phase)
    select distinct v_approval, ph from unnest(p_target_phases) ph;
  end if;
  if p_target_photo_ids is not null then
    foreach v_photo in array p_target_photo_ids loop
      -- CURRENT photo of THIS work package: real row (not a tombstone) and not
      -- superseded by any later row (ADR 0009 anti-join, never a plain
      -- superseded_by IS NULL test). Without this a flagged-then-replaced photo
      -- leaves a dangling mark pointing at a row nobody can see.
      if not exists (
        select 1 from public.photo_logs p
         where p.id = v_photo
           and p.work_package_id = p_wp
           and p.storage_path is not null
           and not exists (select 1 from public.photo_logs n where n.superseded_by = p.id)
      ) then
        raise exception
          'decide_work_package: a flagged photo must be a current photo of this work package'
          using errcode = '22023';
      end if;
      insert into public.approval_revision_targets (approval_id, photo_log_id)
      values (v_approval, v_photo)
      on conflict do nothing;
    end loop;
  end if;

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

-- The 4-arg overload must GO, not linger: with both present a 4-arg call matches two
-- candidates and Postgres refuses it as ambiguous. Dropping it is safe because the new
-- function defaults both new params, so the DEPLOYED app — which sends named args and
-- knows nothing of them — keeps resolving here through the deploy window.
drop function if exists public.decide_work_package(uuid, public.approval_decision, text, public.approval_revision_reason);

-- A CREATE OR REPLACE at a NEW signature creates a NEW function, which inherits the
-- default PUBLIC EXECUTE — so the widened RPC arrived callable by `anon`, exactly the
-- hazard 229-anon-exec-nova-coin-lockdown exists to catch (it did). The role gate
-- inside would still refuse an anon session, but the grant must not be there at all.
-- Mirrors the sibling RPCs: postgres | authenticated | service_role, never public/anon.
revoke all on function public.decide_work_package(
  uuid, public.approval_decision, text, public.approval_revision_reason,
  public.photo_phase[], uuid[]
) from public, anon;
grant execute on function public.decide_work_package(
  uuid, public.approval_decision, text, public.approval_revision_reason,
  public.photo_phase[], uuid[]
) to authenticated, service_role;
