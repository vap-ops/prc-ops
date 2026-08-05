-- Spec 397 U1 — `procurement` joins the attendance audit audience.
--
-- Operator, 2026-08-05: "At the moment, procurement team is double checking the
-- attendance, enable them." Plain `procurement` (4 users) was refused by both
-- audit RPCs, so that double-check happened outside the app entirely.
--
-- Two allowlists live inside each function and BOTH move together:
--   1. the outer 42501 gate — who may call at all;
--   2. the inner `v_role in (...)` arm — who reads CROSS-PROJECT.
-- Widening only (1) would drop `procurement` into the `can_see_project` arm, which
-- is FALSE for that role — the report would open and render NOTHING. A silent
-- empty is worse than a refusal, so the two lists are edited in one migration and
-- pinned together in 358-attendance-audit.test.sql.
--
-- Mirrors `ATTENDANCE_AUDIT_ROLES` / `ATTENDANCE_AUDIT_ALL_PROJECT_ROLES` in
-- src/lib/auth/role-home.ts verbatim (spec 358's own rule: the page gate and the
-- RPC allowlist must never drift).
--
-- Read-only, money-free: neither function writes, and neither reads a wage. Both
-- keep their signature, so this is a true CREATE OR REPLACE — no overload, and the
-- existing EXECUTE grants (and the anon/public revokes) are untouched.

create or replace function public.audit_attendance_summary(
  p_from date,
  p_to date,
  p_project_id uuid default null
)
returns table(
  worker_id uuid, worker_name text, days_present integer, ot_hours_total numeric,
  project_count integer, manual_in_count integer, qr_in_count integer,
  auto_out_count integer, open_out_count integer, unclosed_day_count integer
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_role public.user_role := public.current_user_role();
begin
  -- NULL role (unbound caller / no users row) must be DENIED, not fall through:
  -- `null not in (...)` is NULL, which an IF treats as not-true, so without the
  -- explicit `is null` the raise is skipped (rls-self-check-coalesce trap).
  if v_role is null or v_role not in (
    'accounting', 'hr', 'project_director', 'project_coordinator',
    'procurement_manager', 'procurement', 'super_admin', 'project_manager'
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
  with visible as (
    select a.worker_id, a.work_date, a.session, a.in_method, a.out_at,
           a.out_auto, a.ot_hours, t.project_id
      from public.muster_attendance a
      join public.muster_teams t on t.id = a.team_id
     where a.work_date between p_from and p_to
       and (p_project_id is null or t.project_id = p_project_id)
       and (
         v_role in ('accounting', 'hr', 'project_director', 'project_coordinator', 'procurement_manager', 'procurement', 'super_admin')
         or public.can_see_project(t.project_id)
       )
  )
  select
    w.id,
    w.name,
    count(distinct v.work_date) filter (where v.session = 'regular')::int,
    coalesce(sum(v.ot_hours) filter (where v.session = 'ot'), 0)::numeric,
    count(distinct v.project_id)::int,
    count(*) filter (where v.in_method = 'manual')::int,
    count(*) filter (where v.in_method = 'qr')::int,
    count(*) filter (where v.out_auto)::int,
    count(*) filter (where v.out_at is null)::int,
    count(distinct (v.project_id, v.work_date)) filter (
      where not exists (
        select 1 from public.muster_day_closures c
         where c.project_id = v.project_id and c.work_date = v.work_date
      )
    )::int
  from visible v
  join public.workers w on w.id = v.worker_id
  group by w.id, w.name
  order by w.name;
end;
$function$;

create or replace function public.audit_attendance_detail(
  p_from date,
  p_to date,
  p_project_id uuid default null,
  p_worker_id uuid default null
)
returns table(
  worker_id uuid, worker_name text, project_id uuid, project_name text,
  work_date date, session muster_session, in_at timestamp with time zone,
  in_method muster_method, out_at timestamp with time zone,
  out_method muster_method, out_auto boolean, ot_hours numeric,
  scanned_by uuid, scanned_by_name text, team_lead_name text, day_closed boolean
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_role public.user_role := public.current_user_role();
begin
  -- NULL role (unbound caller / no users row) must be DENIED, not fall through:
  -- `null not in (...)` is NULL, which an IF treats as not-true, so without the
  -- explicit `is null` the raise is skipped (rls-self-check-coalesce trap).
  if v_role is null or v_role not in (
    'accounting', 'hr', 'project_director', 'project_coordinator',
    'procurement_manager', 'procurement', 'super_admin', 'project_manager'
  ) then
    raise exception 'not authorized' using errcode = '42501';
  end if;

  return query
  select
    a.worker_id,
    w.name,
    t.project_id,
    p.name,
    a.work_date,
    a.session,
    a.in_at,
    a.in_method,
    a.out_at,
    a.out_method,
    a.out_auto,
    a.ot_hours,
    a.scanned_by,
    su.full_name,
    lead.name,
    exists (
      select 1 from public.muster_day_closures c
       where c.project_id = t.project_id and c.work_date = a.work_date
    )
  from public.muster_attendance a
  join public.muster_teams t on t.id = a.team_id
  join public.workers w on w.id = a.worker_id
  join public.projects p on p.id = t.project_id
  left join public.workers lead on lead.id = t.lead_worker_id
  left join public.users su on su.id = a.scanned_by
  where a.work_date between p_from and p_to
    and (p_project_id is null or t.project_id = p_project_id)
    and (p_worker_id is null or a.worker_id = p_worker_id)
    and (
      v_role in ('accounting', 'hr', 'project_director', 'project_coordinator', 'procurement_manager', 'procurement', 'super_admin')
      or public.can_see_project(t.project_id)
    )
  order by a.work_date, w.name, a.session;
end;
$function$;
