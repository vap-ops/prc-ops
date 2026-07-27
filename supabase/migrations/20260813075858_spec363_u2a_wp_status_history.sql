-- Spec 363 U2a — wp_status_history: the ประวัติ timeline's status rows.
--
-- THE PROBLEM (spec 363 §4.1, re-verified live 2026-07-27):
-- audit_log has two SELECT policies. The privileged arm (super_admin,
-- project_director, accounting, project_manager) returns everything; the
-- SITE-STAFF arm (site_admin, procurement, procurement_manager) is an EVENT
-- ALLOWLIST restricted to 'wp_reopened_for_defect' and 'wp_evidence_resubmitted'.
-- 'wp_status_transition' is NOT on it — 552 rows in the last 30 days, still
-- being written today — so a site_admin cannot read the backbone of the very
-- tab this unit exists for. U2b shipped the rail without them by design.
--
-- WHY NOT JUST ADD THE EVENT TO THE ALLOWLIST:
-- that arm has NO project scoping. Adding 'wp_status_transition' would expose
-- EVERY project's status history to EVERY site admin. This RPC scopes per call
-- instead and leaves RLS untouched — the spec 358 U1 pattern.
--
-- ⚠️ THE ROLE SET IS NOT WP_DETAIL_ROLES, DELIBERATELY.
-- WP_DETAIL_ROLES includes plain `procurement`, but can_see_project() (read
-- live) returns TRUE only for super_admin/project_coordinator/project_director/
-- procurement_manager and membership-checks project_manager/site_admin/
-- site_owner/auditor — plain `procurement` falls to `else false`, always. So
-- admitting it here would add an arm that can never pass: an unreachable clause
-- in a security gate asserts a hazard that is not there, costs a per-call
-- check, and misleads the next reader (the spec-340 lesson). It is excluded
-- explicitly and pinned by a test, rather than left to fail confusingly.

create or replace function public.wp_status_history(p_work_package_id uuid)
returns table (
  at timestamptz,
  from_status text,
  to_status text,
  actor_id uuid,
  rework_round integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_role public.user_role := public.current_user_role();
  v_project uuid;
begin
  -- A NULL role (unbound caller / no public.users row) must be DENIED, not fall
  -- through: `null not in (...)` evaluates to NULL, which IF treats as not-true,
  -- so without the explicit `is null` the raise is skipped and the gate OPENS
  -- (the rls-self-check-coalesce trap).
  if v_role is null or v_role not in (
    'site_admin', 'project_manager', 'super_admin', 'project_director',
    'procurement_manager'
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  select w.project_id into v_project
    from public.work_packages w
   where w.id = p_work_package_id;

  -- Same errcode for "no such WP" as for "not yours": a distinguishable error
  -- would turn this into an existence oracle over every work package id.
  if v_project is null or not public.can_see_project(v_project) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
  select
    a.created_at,
    a.payload ->> 'from_status',
    a.payload ->> 'to_status',
    a.actor_id,
    nullif(a.payload ->> 'rework_round', '')::integer
  from public.audit_log a
  where a.target_table = 'work_packages'
    and a.target_id = p_work_package_id
    and a.payload ->> 'event' = 'wp_status_transition'
  order by a.created_at asc;
end;
$$;

comment on function public.wp_status_history(uuid) is
  'Spec 363 U2a — a WP''s status transitions for the ประวัติ rail. SECURITY DEFINER because audit_log''s site-staff SELECT policy is an event allowlist that excludes wp_status_transition; gated on a project-scopable role set + can_see_project so no project''s history leaks to another. RLS untouched.';

-- The gate lives in the body, so the grant is the ordinary one — but PUBLIC and
-- anon must be stripped explicitly: a fresh function is EXECUTE-able by PUBLIC
-- by default, which would hand an unauthenticated caller a DEFINER read.
revoke all on function public.wp_status_history(uuid) from public, anon;
grant execute on function public.wp_status_history(uuid) to authenticated;
