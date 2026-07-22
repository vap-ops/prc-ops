-- Spec 340 U1 — super_admin removes a wrong photo on the uploader's behalf.
--
-- Spec 291 (mig 075831/075832) ends the ให้แก้ไข arm with
-- `target.uploaded_by = auth.uid()`: inside an open revision window only the
-- person who took the photo may remove it, so the approver can never quietly
-- alter the evidence they are judging. That rule is kept — it is the reason the
-- window is safe — but it left nobody able to help when the uploader cannot
-- (off site, phone lost, cannot find the button), and super_admin is already a
-- permitted photo_logs INSERT role.
--
-- Operator call 2026-07-22: super_admin bypasses the UPLOADER check ONLY. The
-- FREEZE is untouched — on a submitted-and-not-bounced or complete WP nobody
-- deletes, super_admin included. The honest path there stays ผอ./PM press
-- ให้แก้ไข, which puts a reviewer decision on record BEFORE the evidence
-- changes, rather than adding a silent back door around it. The freeze is a
-- state rule, not a role rule; keeping it that way is what makes the audit
-- story hold.
--
-- Forward-only, body-only replace: signature, STABLE/SECURITY DEFINER, the
-- search_path pin and the existing grants are all unchanged, so the photo_logs
-- INSERT policy that calls this keeps working untouched. The added call is
-- wrapped in a scalar subselect for the same reason every other one here is —
-- the 40-rls-eval-once guard (one evaluation per statement, not per row).

create or replace function public.photo_removal_allowed(p_wp uuid, p_target uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  with target as (
    select pl.work_package_id, pl.uploaded_by
      from public.photo_logs pl
     where pl.id = p_target
  ),
  latest as (
    select a.id, a.decision
      from public.approvals a
     where a.work_package_id = p_wp
     order by a.decided_at desc, a.id desc
     limit 1
  )
  select coalesce(
    -- The photo being removed must live on the work package named by the
    -- tombstone. Fails closed when p_target is null or unknown.
    (select t.work_package_id from target t) = p_wp
    and (
      public.photo_wp_deletable(p_wp)
      or (
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
        -- The reviewer asks, the uploader fixes — or the operator does it for
        -- them (spec 340). Note this arm widens WHO, never WHEN: the enclosing
        -- branch still requires an outstanding ให้แก้ไข ask.
        and (
          (select t.uploaded_by from target t) = (select auth.uid())
          or (select public.current_user_role()) = 'super_admin'
        )
      )
    ),
    false);
$function$;
