-- Spec 143 U1 / ADR 0056 — membership-scoped project visibility (amends 0013).
--
-- project_manager / site_admin now see only the projects they are INVOLVED with
-- (a project_members row OR the project_lead_id). super_admin + project_coordinator
-- see all. procurement keeps its spec-102 cross-project read on projects /
-- work_packages / purchase_requests. Enforced at every project-scoped table, via
-- two SECURITY DEFINER helpers (ADR 0011: definer reads the membership/parent
-- tables without re-triggering the policies that call them — no recursion).
--
-- Writes/INSERT/UPDATE policies are unchanged — this is read visibility only.

-- ----------------------------------------------------------------------------
-- Helpers.
-- ----------------------------------------------------------------------------
create function public.can_see_project(p_project_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select case
    when public.current_user_role() in ('super_admin', 'project_coordinator') then true
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

revoke all on function public.can_see_project(uuid) from public, anon;
grant execute on function public.can_see_project(uuid) to authenticated;

comment on function public.can_see_project(uuid) is
  'ADR 0056 — true if the caller may see a project: super_admin/project_coordinator always; project_manager/site_admin iff member or lead; else false (never NULL).';

create function public.can_see_wp(p_work_package_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select public.can_see_project(w.project_id)
       from public.work_packages w
      where w.id = p_work_package_id),
    false)
$$;

revoke all on function public.can_see_wp(uuid) from public, anon;
grant execute on function public.can_see_wp(uuid) to authenticated;

comment on function public.can_see_wp(uuid) is
  'ADR 0056 — can_see_project for a work package''s project (false if the WP is gone).';

-- ----------------------------------------------------------------------------
-- Backfill: keep current leads visible to themselves once scoping turns on.
-- ----------------------------------------------------------------------------
insert into public.project_members (project_id, user_id, added_by)
  select p.id, p.project_lead_id, p.project_lead_id
    from public.projects p
   where p.project_lead_id is not null
on conflict (project_id, user_id) do nothing;

-- ----------------------------------------------------------------------------
-- Rewritten SELECT policies. Eval-once wrapped form (pgTAP file 40). Each keeps
-- its table's existing exceptions.
-- ----------------------------------------------------------------------------

-- projects: procurement keeps all (spec 102); otherwise membership-scoped.
drop policy "projects readable by privileged roles" on public.projects;
create policy "projects readable by privileged roles"
  on public.projects for select
  using (
    (select public.current_user_role()) = 'procurement'
    or (select public.can_see_project(id))
  );

-- work_packages: procurement keeps all (spec 102); otherwise scoped.
drop policy "work_packages readable by privileged roles" on public.work_packages;
create policy "work_packages readable by privileged roles"
  on public.work_packages for select
  using (
    (select public.current_user_role()) = 'procurement'
    or (select public.can_see_project(project_id))
  );

-- deliverables: scoped (procurement never had it).
drop policy "deliverables readable by privileged roles" on public.deliverables;
create policy "deliverables readable by privileged roles"
  on public.deliverables for select
  using ((select public.can_see_project(project_id)));

-- photo_logs: WP-scoped.
drop policy "photo_logs readable by privileged roles" on public.photo_logs;
create policy "photo_logs readable by privileged roles"
  on public.photo_logs for select
  using ((select public.can_see_wp(work_package_id)));

-- approvals: WP-scoped.
drop policy "approvals readable by sa/pm/super" on public.approvals;
create policy "approvals readable by sa/pm/super"
  on public.approvals for select
  using ((select public.can_see_wp(work_package_id)));

-- purchase_requests: keep the requester self-read + procurement; otherwise scoped.
-- The separate "appsheet_writer select by status" policy is untouched.
drop policy "purchase_requests select own or privileged" on public.purchase_requests;
create policy "purchase_requests select own or privileged"
  on public.purchase_requests for select
  using (
    requested_by = (select auth.uid())
    or (select public.current_user_role()) = 'procurement'
    or (select public.can_see_wp(work_package_id))
  );

-- reports: scoped, and still never visible to site_admin (spec 19).
drop policy "reports readable by pm or super_admin" on public.reports;
create policy "reports readable by pm or super_admin"
  on public.reports for select
  using (
    (select public.can_see_project(project_id))
    and (select public.current_user_role()) <> 'site_admin'
  );
