-- Spec 327 follow-up (chip task_b1cddf5a) — project_categories SELECT gains the
-- procurement arm.
--
-- procurement / procurement_manager are cross-project read-only browse roles
-- (spec 102/143/173): they are not project members, so the can_see_project-only
-- qual read ZERO project_categories rows and the spec-277 category
-- letter/color/icon silently blanked on the /procurement scope view (spec 327
-- U2 #627 worked around it with an admin-client seam in scope-view.tsx — this
-- migration is the proper fix; the seam retires in the same PR).
--
-- The qual below is re-sourced VERBATIM from the LIVE database (pg_policies,
-- 2026-07-18 — NOT from any migration file, per db-migration-lessons) and
-- widened DETERMINISTICALLY: the procurement OR-arm is prepended, mirroring the
-- live "work_packages readable by privileged roles" wording (071000 pattern).
-- ALTER POLICY is qual-only — cmd (SELECT), roles ({authenticated}), and the
-- permissive flag are preserved; the membership path (can_see_project) and the
-- separate client full-tier policy are KEPT unchanged. Read-only widening — no
-- write arm; writes stay RPC-only (spec 207 DEFINER RPCs).

alter policy "project_categories readable by project members" on public.project_categories
  using (((( SELECT current_user_role() AS current_user_role) = ANY (ARRAY['procurement'::user_role, 'procurement_manager'::user_role])) OR ( SELECT can_see_project(project_categories.project_id) AS can_see_project)));
