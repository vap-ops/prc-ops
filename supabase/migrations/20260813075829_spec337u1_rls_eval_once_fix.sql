-- Spec 337 U1 — restore the initplan wrapper on the audit_log rework-events
-- policy that …075828 recreated.
--
-- A NEW file, not an edit of …075828: that migration is already applied, and
-- re-pushing an edited applied migration silently no-ops.
--
-- …075828 widened the policy's event allowlist but rewrote the role check as a
-- BARE `public.current_user_role()`. Every public RLS policy must wrap such a
-- call in a scalar subselect so the planner evaluates it ONCE per query instead
-- of once per row (migrations 20260625000600/000700/000800); the
-- `40-rls-eval-once` pgTAP guard exists precisely to catch this and did — a
-- per-row DEFINER call on audit_log is a real scan cost, not a style point.
-- Same predicate, wrapped.

drop policy if exists "audit_log select wp rework events" on public.audit_log;
create policy "audit_log select wp rework events" on public.audit_log
  for select to authenticated
  using (
    coalesce((select public.current_user_role())::text, '') = any (
      array['site_admin', 'procurement', 'procurement_manager'])
    and (payload->>'event') in ('wp_reopened_for_defect', 'wp_evidence_resubmitted')
  );
