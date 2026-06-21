-- Spec 173 U1 — procurement reads deliverables + work_package_dependencies.
--
-- procurement is a cross-project read-only browse role (spec 102 / ADR 0056). Its
-- `current_user_role() = 'procurement'` arm already lives on the projects +
-- work_packages SELECT policies, but deliverables (งวดงาน) and
-- work_package_dependencies post-dated that work and only gate on
-- can_see_project / can_see_wp — both FALSE for procurement (it is a member of no
-- project), so the schedule swimlanes + the งวดงาน grouping render EMPTY for it.
--
-- This adds the same OR-arm to both SELECT policies, KEEPING the can_see_*
-- predicate (the membership-scoped path for PM / site_admin is unchanged; files
-- 70/73 pin that the qual still names those helpers). Read-only widening — no
-- INSERT/UPDATE arm is touched. DROP+CREATE preserves the policy name, the
-- PERMISSIVE class, and the TO public default that the originals carried.

drop policy "deliverables readable by privileged roles" on public.deliverables;
create policy "deliverables readable by privileged roles"
  on public.deliverables
  for select
  using (
    (select current_user_role()) = 'procurement'::public.user_role
    or (select can_see_project(deliverables.project_id))
  );

drop policy "wp_dependencies readable by privileged roles" on public.work_package_dependencies;
create policy "wp_dependencies readable by privileged roles"
  on public.work_package_dependencies
  for select
  using (
    (select current_user_role()) = 'procurement'::public.user_role
    or (select can_see_wp(work_package_dependencies.predecessor_id))
  );

-- project_members: the project's team list (shown in the ⓘ info sheet). This
-- policy is a flat staff role-list (not can_see_*), so procurement is appended to
-- it directly — project_director stays in the list (file 91 doctrine). Lets the
-- team-member names resolve for procurement's project-info view. roles stays
-- TO authenticated, matching the original.
drop policy "project members readable by staff" on public.project_members;
create policy "project members readable by staff"
  on public.project_members
  for select
  to authenticated
  using (
    (select current_user_role()) = any (array[
      'site_admin'::public.user_role,
      'project_manager'::public.user_role,
      'super_admin'::public.user_role,
      'project_director'::public.user_role,
      'procurement'::public.user_role
    ])
  );
