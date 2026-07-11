-- Spec 295 — scope the SA/site_owner pending-applicant queue to the SA's project.
--
-- can_see_staff_registration's SA/site_owner arm was `status='pending'` ONLY, so
-- every site_admin saw the entire firm-wide pending applicant queue — including
-- applicants for projects they are not a member of (feedback b0ff6cea). The
-- project edge already exists on the row: staff_registrations.invited_project_id
-- is stamped from the SA's per-project self-onboard QR (spec 279 F2a/F2b) at
-- start_staff_registration time.
--
-- This CREATE OR REPLACE narrows the SA/site_owner arm to only PENDING rows whose
-- invited_project_id the caller can see (can_see_project). Unreferred (NULL)
-- pending rows carry no project edge, so they stay visible to the BACK-OFFICE arm
-- ONLY (procurement_manager/project_director/super_admin) — least-privilege. The
-- back-office arm is unchanged; it still sees every registration.
--
-- invited_project_id remains VISITOR-SUPPLIED/advisory (spec 279 F2b) but here it
-- only NARROWS an already role-gated read — it can only reduce what an SA sees,
-- never grant a non-SA anything, and a forged/stale ref is existence-coerced to
-- NULL at write time (075450), which fails this predicate closed.
--
-- CREATE OR REPLACE preserves the existing ACL (anon already revoked; authenticated
-- retains EXECUTE), so no re-grant/revoke is needed.

create or replace function public.can_see_staff_registration(p_registration_id uuid)
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select
    -- back-office approver set: sees every registration.
    (select public.current_user_role())
      in ('procurement_manager', 'project_director', 'super_admin')
    or (
      -- SA + site_owner: read-only view of PENDING applicants, scoped to a
      -- project they can see (the QR-stamped invited_project_id, spec 279 F2a/F2b).
      -- Unreferred (NULL) pending rows are back-office-only (spec 295, b0ff6cea).
      (select public.current_user_role()) in ('site_admin', 'site_owner')
      and exists (
        select 1 from public.staff_registrations r
         where r.id = p_registration_id
           and r.status = 'pending'
           and r.invited_project_id is not null
           and public.can_see_project(r.invited_project_id)
      )
    );
$function$;
