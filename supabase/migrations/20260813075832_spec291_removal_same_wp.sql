-- Spec 291 amendment, part 3 — correlate the tombstone's work package with the
-- photo it supersedes (second fresh-eyes pass on 075831).
--
-- The gate never checked that the target photo actually belongs to the WP named
-- on the tombstone row. That is a PRE-EXISTING hole (the original conjunct
-- `photo_wp_deletable(work_package_id)` looked only at the row's own
-- work_package_id), and the window arm inherits it: a caller with ONE deletable
-- or unfrozen WP could supersede their own photo on a DIFFERENT, frozen WP by
-- pointing `superseded_by` at it while naming the permitted WP —
--   • the role gate passes,
--   • `can_see_wp` is checked on the NAMED wp,
--   • `uploaded_by = auth.uid()` is checked on the TOMBSTONE row,
--   • photo_removal_allowed(named_wp, foreign_photo) returned true.
-- The frozen WP's gallery still shows the photo (its read is scoped by
-- work_package_id), but every "is this row superseded" anti-join is NOT scoped —
-- ADR 0009's current-state read and resubmit_work_package_evidence's
-- new-photo gate both treat the foreign photo as removed.
--
-- The sibling guard for `answers_photo_id` already enforces exactly this
-- invariant (`target.work_package_id <> new.work_package_id` raises 23514,
-- migration 061000); the supersede path never did. Same-WP is now required for
-- BOTH arms, inside the function, so the policy needs no further rewrite.

create or replace function public.photo_removal_allowed(p_wp uuid, p_target uuid)
 returns boolean
 language sql
 stable security definer
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
        -- The reviewer asks, the uploader fixes.
        and (select t.uploaded_by from target t) = (select auth.uid())
      )
    ),
    false);
$function$;
