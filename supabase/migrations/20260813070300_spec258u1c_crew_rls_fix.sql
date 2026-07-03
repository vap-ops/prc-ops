-- Spec 258 U1c — fix: the RLS policies on subcontract_crew_members /
-- subcontract_crew_attachments referenced `public.subcontracts` directly
-- inside a USING clause evaluated as the CALLING role (authenticated). But
-- `subcontracts` is zero-authenticated-grant (money domain, spec 251) — so
-- the EXISTS subquery itself failed with `42501: permission denied for
-- table subcontracts`, not just "returns no rows". Caught by the pgTAP
-- suite (260-spec258-subcontract-crew.test.sql) before this ever reached a
-- real user.
--
-- Fix (matches can_see_project's own shape): wrap the subcontracts lookup in
-- a SECURITY DEFINER helper, which runs as its owner and so bypasses the
-- caller's missing grant, then reference the HELPER (not the raw table) from
-- the RLS policies. Also gives the two policies short names this time — the
-- original migration's policy names were silently truncated past Postgres'
-- 63-byte identifier limit (a harmless NOTICE, not the bug here, but worth
-- not repeating).

create function public.can_see_subcontract(p_subcontract_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.subcontracts s
     where s.id = p_subcontract_id
       and public.can_see_project(s.project_id)
  )
$$;

comment on function public.can_see_subcontract(uuid) is
  'Spec 258 — true if the caller may see a subcontract deal (delegates to can_see_project on the deal''s project_id). SECURITY DEFINER so it can read the zero-grant subcontracts table even though the caller has no direct SELECT on it — the RLS-policy analog of can_see_project itself.';

drop policy "subcontract_crew_members readable by pm and site_admin (project"
  on public.subcontract_crew_members;

create policy "subcontract_crew_members_select_pm_sa"
  on public.subcontract_crew_members
  for select
  to authenticated
  using (
    (select public.current_user_role()) in
      ('site_admin', 'project_manager', 'super_admin', 'project_director')
    and public.can_see_subcontract(subcontract_id)
  );

drop policy "subcontract_crew_attachments readable by pm and site_admin (pro"
  on public.subcontract_crew_attachments;

create policy "subcontract_crew_attachments_select_pm_sa"
  on public.subcontract_crew_attachments
  for select
  to authenticated
  using (
    (select public.current_user_role()) in
      ('site_admin', 'project_manager', 'super_admin', 'project_director')
    and exists (
      select 1 from public.subcontract_crew_members m
       where m.id = subcontract_crew_attachments.crew_member_id
         and public.can_see_subcontract(m.subcontract_id)
    )
  );
