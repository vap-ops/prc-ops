-- Spec 271 U3 / ADR 0075 §4.8 — visibility arms for site_owner + auditor.
--
-- can_see_project today hard-falls both roles to the ELSE FALSE branch, so
-- every surface and RPC membership check is closed to them. They join the
-- membership-scoped arm (project_members OR project lead — the same mechanism
-- as PM/SA; seeding a membership is the U0 appointment step).
--
-- Body sourced VERBATIM from LIVE (pg_get_functiondef) — the two roles added
-- to the membership arm are the only change.

create or replace function public.can_see_project(p_project_id uuid)
returns boolean
language sql
stable security definer
set search_path to 'public'
as $function$
  select case
    when public.current_user_role() in
      ('super_admin', 'project_coordinator', 'project_director') then true
    when public.current_user_role() in
      ('project_manager', 'site_admin', 'site_owner', 'auditor') then (
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
$function$;

-- The two site roles can read their OWN membership rows (their project list);
-- the staff-wide read policy stays unchanged — they never see other members.
create policy "project members self readable by site roles"
  on public.project_members for select
  to authenticated
  using (
    (select public.current_user_role()) in ('site_owner', 'auditor')
    and user_id = (select auth.uid())
  );
