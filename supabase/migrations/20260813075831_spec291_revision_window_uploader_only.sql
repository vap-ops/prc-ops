-- Spec 291 amendment, part 2 (fresh-eyes fixes to migration 075830).
--
-- 075830 widened photo_wp_deletable() itself so a pending_approval WP unfroze
-- whenever its latest decision was needs_revision. Review found two holes:
--
--   1. It unfroze the set for EVERY role the photo_logs INSERT policy admits —
--      including project_manager / project_director, who reach the same
--      PhotoCaptureZone delete affordance on the WP-detail page (only
--      procurement is a read-only WP viewer). That hands the approver a way to
--      alter the evidence they are judging, which is the exact thing the freeze
--      exists to prevent. `/review` itself is read-only (PhaseGallery wires no
--      delete), but the WP-detail route is not.
--   2. The window never CLOSED. resubmit_work_package_evidence records the
--      answer as an audit row and writes no new `approvals` row, so after the SA
--      pressed ส่งตรวจอีกครั้ง the latest decision was still needs_revision and
--      the set stayed mutable while the reviewer re-reviewed it.
--
-- Corrected rule — a tombstone is admitted when EITHER:
--   • the WP is in an editable status (photo_wp_deletable, restored to its
--     original status-only meaning here), OR
--   • the ให้แก้ไข window is genuinely open: status = pending_approval, the
--     latest decision (decided_at desc, id desc — the ordering
--     resubmit_work_package_evidence and selectLatestDecisionByWorkPackage both
--     use) is needs_revision, that decision has NOT yet been answered by a
--     wp_evidence_resubmitted audit row, AND the caller is the person who
--     uploaded the photo being removed. The reviewer asks; the uploader fixes.
--
-- The policy conjunct moves from photo_wp_deletable(work_package_id) to
-- photo_removal_allowed(work_package_id, superseded_by) so the target photo's
-- uploader is in scope. Uploads (superseded_by IS NULL) stay untouched.

-- 1. Restore photo_wp_deletable to its pre-075830 body. It keeps its original
--    single meaning ("is this WP in an editable status") and is now one arm of
--    the rule below; 291-photo-delete-submit-gate.test.sql still pins it.
create or replace function public.photo_wp_deletable(p_wp uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select coalesce(
    (select status not in ('pending_approval', 'complete')
       from public.work_packages
      where id = p_wp),
    false);
$function$;

-- 2. The full removal rule, target-aware.
create or replace function public.photo_removal_allowed(p_wp uuid, p_target uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  with latest as (
    select a.id, a.decision
      from public.approvals a
     where a.work_package_id = p_wp
     order by a.decided_at desc, a.id desc
     limit 1
  )
  select
    public.photo_wp_deletable(p_wp)
    or coalesce(
      (select w.status = 'pending_approval'
         from public.work_packages w
        where w.id = p_wp)
      and (select l.decision from latest l) = 'needs_revision'
      and not exists (
        select 1
          from public.audit_log g
         where g.target_table = 'work_packages'
           and g.target_id = p_wp
           and g.payload->>'event' = 'wp_evidence_resubmitted'
           and g.payload->>'answers_decision_id' = (select l.id::text from latest l)
      )
      and (select pl.uploaded_by from public.photo_logs pl where pl.id = p_target)
          = (select auth.uid()),
      false);
$function$;

revoke all on function public.photo_removal_allowed(uuid, uuid) from public, anon;
grant execute on function public.photo_removal_allowed(uuid, uuid) to authenticated;

-- 3. Repoint the tombstone gate. Same policy otherwise — the role list,
--    can_see_wp and the uploaded_by attribution clause are unchanged, and the
--    scalar-subselect wrappers are preserved (a drop+create is a REWRITE, so
--    losing them would reintroduce the per-row DEFINER call 075829 fixed).
drop policy "photo_logs insert by sa/pm/super" on public.photo_logs;

create policy "photo_logs insert by sa/pm/super"
  on public.photo_logs
  for insert
  to authenticated
  with check (
    (select public.current_user_role()) = any (
      array['site_admin', 'project_manager', 'super_admin', 'project_director']::public.user_role[]
    )
    and (select public.can_see_wp(photo_logs.work_package_id))
    and uploaded_by = (select auth.uid())
    and (
      superseded_by is null
      or public.photo_removal_allowed(work_package_id, superseded_by)
    )
  );
