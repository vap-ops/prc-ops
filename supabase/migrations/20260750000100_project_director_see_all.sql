-- Spec 152 U1 / ADR 0058 — project_director sees every project (see-all).
--
-- The ONE way project_director differs from project_manager: visibility is
-- see-all, like super_admin / project_coordinator, instead of membership-scoped.
-- ADR 0056 built the cascade so this is a single function edit — can_see_wp /
-- can_see_photo_log delegate to can_see_project, so the director inherits see-all
-- on every project-scoped child table for free.
--
-- create-or-replace keeps the signature, grants, and dependents intact; only the
-- see-all role list widens. Body otherwise identical to 20260728000000.

create or replace function public.can_see_project(p_project_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select case
    when public.current_user_role() in
      ('super_admin', 'project_coordinator', 'project_director') then true
    when public.current_user_role() in ('project_manager', 'site_admin') then (
      exists (
        select 1 from public.project_members m
         where m.project_id = p_project_id and m.user_id = auth.uid()
      )
      or exists (
        select 1 from public.projects p
         where p.id = p_project_id and p.project_lead_id = auth.uid()
      )
    )
    else false
  end
$$;

comment on function public.can_see_project(uuid) is
  'ADR 0056/0058 — true if the caller may see a project: super_admin/project_coordinator/project_director always; project_manager/site_admin iff member or lead; else false (never NULL).';
