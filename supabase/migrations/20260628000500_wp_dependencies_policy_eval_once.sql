-- Spec 92 Unit A fix-forward — wrap current_user_role() in the
-- work_package_dependencies SELECT policy in a scalar subquery so it evaluates
-- ONCE per query rather than per row (the repo's eval-once RLS convention,
-- enforced by pgTAP 40). The original policy (20260628000400) called it bare.
drop policy "wp_dependencies readable by privileged roles" on public.work_package_dependencies;
create policy "wp_dependencies readable by privileged roles"
  on public.work_package_dependencies for select
  using ((select public.current_user_role()) in ('site_admin', 'project_manager', 'super_admin'));
