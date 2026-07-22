-- Spec 340 U1, third cut — remove a guard 075834 added against a hazard that
-- cannot occur.
--
-- 075834 added a conjunct to the photo_logs INSERT policy so that a row which
-- both supersedes and carries an image (a SUBSTITUTION rather than a removal)
-- stayed restricted to the photo's own uploader. That responded to a fresh-eyes
-- finding, and the finding was reasoned from the policy alone. The table already
-- makes it impossible:
--
--   CHECK ((storage_path IS NULL) = (superseded_by IS NOT NULL))
--     -- photo_logs_path_supersede_well_formed
--
-- A superseding row is ALWAYS a tombstone, for every role, before and after
-- spec 340. Proven by the failing pgTAP: the uploader's own "re-shoot in place"
-- insert died 23514 on that constraint, not 42501 on RLS. So the added conjunct
-- was unreachable — and an unreachable clause inside a security policy is worse
-- than no clause: it implies a hazard that the reader will assume is live, and
-- it calls a definer function per row on a path that never runs.
--
-- Reverts the policy to its 075834-minus-the-dead-conjunct shape (subselect
-- wrapping intact for the 40-rls-eval-once guard) and drops the helper that
-- existed only to serve it. The self-judged-removal fix from 075834 —
-- super_admin cannot delete on their OWN ให้แก้ไข decision — is untouched and
-- stays live in photo_removal_allowed.

drop policy if exists "photo_logs insert by sa/pm/super" on public.photo_logs;

create policy "photo_logs insert by sa/pm/super"
on public.photo_logs
for insert
with check (
  (select public.current_user_role()) = any (array[
    'site_admin'::user_role,
    'project_manager'::user_role,
    'super_admin'::user_role,
    'project_director'::user_role
  ])
  and (select public.can_see_wp(photo_logs.work_package_id))
  and uploaded_by = (select auth.uid())
  and (superseded_by is null or public.photo_removal_allowed(work_package_id, superseded_by))
);

drop function if exists public.photo_target_uploaded_by(uuid);
