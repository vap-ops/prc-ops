-- Spec 102: procurement project visibility. Widen the projects SELECT policy to
-- include procurement (read-only) so it can browse projects + WP context while
-- processing purchases. The APP gives procurement a read-only WP list only —
-- the capture-heavy WP detail + schedule stay site-staff. INSERT/UPDATE are
-- unchanged (super_admin only).
--
-- ALTER POLICY (not DROP+CREATE) keeps the policy NAME (policies_are pins stay
-- green) and the eval-once wrapped call form (migrations 20260625000600/700) —
-- (select public.current_user_role()) evaluates once per query, not per row.

alter policy "projects readable by privileged roles"
  on public.projects
  using (
    (select public.current_user_role()) in (
      'site_admin', 'project_manager', 'super_admin', 'procurement'
    )
  );
