-- Spec 171 U3 — procurement reads the contractors master.
--
-- U2 admits procurement to the WP detail screen read-only, but the
-- contractors SELECT policy was sa/pm/super/director only, so the WP's
-- assigned-contractor name was blank in procurement's read-only info sheet.
-- Add procurement to the role list. contractors is global master data (not
-- project-scoped), so this is a plain role-level read — consistent with
-- procurement already reading the suppliers/vendors master (BACK_OFFICE_ROLES).
--
-- DROP+CREATE in place, name unchanged → file 24 `policies_are` pin holds.
-- project_director stays in the list (pgTAP file 91: every policy naming
-- project_manager must also name project_director). The separate
-- "contractors readable by bound contractor" external self-read policy
-- (spec 130) is untouched. Additive + reversible.

drop policy "contractors readable by privileged roles" on public.contractors;
create policy "contractors readable by privileged roles"
  on public.contractors for select
  using (
    (select public.current_user_role()) in
      ('site_admin', 'project_manager', 'super_admin', 'project_director', 'procurement')
  );
