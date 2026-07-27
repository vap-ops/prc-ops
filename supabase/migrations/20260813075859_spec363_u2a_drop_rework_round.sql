-- Spec 363 U2a, fresh-eyes follow-up — drop `rework_round` from wp_status_history.
--
-- 075858 returned `nullif(payload->>'rework_round','')::integer`. That is an
-- UNGUARDED cast over a jsonb text field, on a column nothing reads: the rail
-- never renders it. One non-numeric value in any payload — a break-glass row, a
-- future payload shape — raises 22P02 for the WHOLE call, which the loader then
-- swallows into an empty list, so EVERY status row on that work package would
-- vanish silently and permanently. A column that cannot be seen must not be able
-- to take the rail down with it.
--
-- Written as a NEW migration rather than an edit to 075858: that file is already
-- applied, and editing an applied migration is a silent no-op against the live
-- database. The return type changes, so CREATE OR REPLACE cannot do it — DROP
-- first. Safe here because the function was added minutes ago in this same
-- unreleased branch and nothing in main references it.

drop function if exists public.wp_status_history(uuid);

create function public.wp_status_history(p_work_package_id uuid)
returns table (
  at timestamptz,
  from_status text,
  to_status text,
  actor_id uuid
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
  -- so without the explicit `is null` the raise is skipped and the gate OPENS.
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
  -- would turn this into an existence oracle over every work-package id.
  if v_project is null or not public.can_see_project(v_project) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
  select
    a.created_at,
    a.payload ->> 'from_status',
    a.payload ->> 'to_status',
    a.actor_id
  from public.audit_log a
  where a.target_table = 'work_packages'
    and a.target_id = p_work_package_id
    and a.payload ->> 'event' = 'wp_status_transition'
  order by a.created_at asc;
end;
$$;

comment on function public.wp_status_history(uuid) is
  'Spec 363 U2a — a WP''s status transitions for the ประวัติ rail. SECURITY DEFINER because audit_log''s site-staff SELECT policy is an event allowlist that excludes wp_status_transition; gated on a project-scopable role set + can_see_project so no project''s history leaks to another. RLS untouched.';

revoke all on function public.wp_status_history(uuid) from public, anon;
grant execute on function public.wp_status_history(uuid) to authenticated;
