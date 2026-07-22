-- Spec 340 U1, second cut — two holes a fresh-eyes pass found in 075833.
--
-- 075833 let super_admin remove another user's photo inside an open ให้แก้ไข
-- window. Both fixes below keep that, and close what it accidentally also
-- allowed. Forward-only: 075833 stays applied, this refines it.
--
-- (1) SELF-JUDGED REMOVAL. super_admin is in the `approvals insert by pm/super`
--     WITH CHECK, so the operator can be the decider. Without a guard they could
--     press ให้แก้ไข and then delete the uploader's photo on their own decision —
--     exactly the approver-alters-the-evidence-they-judge hazard 075831 closed,
--     reopened for one principal. The rationale written into 075833 ("a reviewer
--     decision is on record BEFORE the evidence changes") only holds if that
--     decision is somebody else's. Same shape as spec 337 U2, where the decider
--     is not allowed to answer their own bounce.
--
-- (2) REMOVAL, NOT SUBSTITUTION. The photo_logs INSERT policy admits any row
--     carrying `superseded_by`, including one that also carries a storage_path —
--     i.e. a REPLACEMENT image, not a tombstone. Before 075833 the
--     `uploaded_by = auth.uid()` conjunct inside photo_removal_allowed blocked
--     that for every non-uploader; widening the arm silently widened swapping
--     too. `removePhoto` only ever builds tombstones, but RLS is the authority
--     and a direct PostgREST insert is not. So: superseding WITH an image stays
--     restricted to the photo's own uploader (that is the re-shoot the reviewer
--     asked for); everyone else the window admits may only tombstone.

-- The policy needs the TARGET row's uploader, and photo_logs' own RLS would
-- otherwise recurse. Definer, and locked down the same way every other helper
-- here is (a bare `revoke … from anon` leaves Postgres's default PUBLIC grant).
create or replace function public.photo_target_uploaded_by(p_target uuid)
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $function$
  select pl.uploaded_by from public.photo_logs pl where pl.id = p_target;
$function$;

revoke all on function public.photo_target_uploaded_by(uuid) from public, anon;
grant execute on function public.photo_target_uploaded_by(uuid) to authenticated, service_role;

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
    select a.id, a.decision, a.decided_by
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
        -- them (spec 340). This arm widens WHO, never WHEN, and never covers the
        -- operator acting on their OWN decision: `is distinct from` so a null
        -- decided_by cannot open it either.
        and (
          (select t.uploaded_by from target t) = (select auth.uid())
          or (
            (select public.current_user_role()) = 'super_admin'
            and (select l.decided_by from latest l) is distinct from (select auth.uid())
          )
        )
      )
    ),
    false);
$function$;

-- Policy REWRITE (drop+create): every pre-existing conjunct is reproduced with
-- its scalar-subselect wrapping intact — the 40-rls-eval-once guard fails a
-- policy that calls a function per row instead of once per statement.
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
  -- Spec 340: a row that supersedes AND carries an image is a substitution.
  -- Only the photo's own uploader may do that; the widened removal arm gets
  -- tombstones (storage_path null) and nothing more.
  and (
    superseded_by is null
    or storage_path is null
    or public.photo_target_uploaded_by(superseded_by) = (select auth.uid())
  )
);
