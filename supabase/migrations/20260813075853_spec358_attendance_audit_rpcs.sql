-- Spec 358 U1 — attendance audit read RPCs for the office/payroll audience.
-- muster_* RLS is can_see_project-scoped (FALSE for accounting/hr/legal/procurement),
-- so these SECURITY DEFINER reads serve them without touching RLS. Gated on a NEW
-- 7-role allowlist (is_back_office excludes accounting/hr — the primary audience).
-- The full set = cross-project; project_manager = can_see_project-scoped. Read-only,
-- money-free (reads muster_* + workers/users/projects for names only).

create function public.audit_attendance_summary(
  p_from date,
  p_to date,
  p_project_id uuid default null
) returns table (
  worker_id uuid,
  worker_name text,
  days_present integer,
  ot_hours_total numeric,
  project_count integer,
  manual_in_count integer,
  qr_in_count integer,
  auto_out_count integer,
  open_out_count integer,
  unclosed_day_count integer
) language plpgsql stable security definer set search_path = public as $$
declare
  v_role public.user_role := public.current_user_role();
begin
  -- NULL role (unbound caller / no users row) must be DENIED, not fall through:
  -- `null not in (...)` is NULL, which an IF treats as not-true, so without the
  -- explicit `is null` the raise is skipped (rls-self-check-coalesce trap).
  if v_role is null or v_role not in (
    'accounting', 'hr', 'project_director', 'project_coordinator',
    'procurement_manager', 'super_admin', 'project_manager'
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
         v_role in ('accounting', 'hr', 'project_director', 'project_coordinator', 'procurement_manager', 'super_admin')
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
$$;

create function public.audit_attendance_detail(
  p_from date,
  p_to date,
  p_project_id uuid default null,
  p_worker_id uuid default null
) returns table (
  worker_id uuid,
  worker_name text,
  project_id uuid,
  project_name text,
  work_date date,
  session public.muster_session,
  in_at timestamptz,
  in_method public.muster_method,
  out_at timestamptz,
  out_method public.muster_method,
  out_auto boolean,
  ot_hours numeric,
  scanned_by uuid,
  scanned_by_name text,
  team_lead_name text,
  day_closed boolean
) language plpgsql stable security definer set search_path = public as $$
declare
  v_role public.user_role := public.current_user_role();
begin
  -- NULL role (unbound caller / no users row) must be DENIED, not fall through:
  -- `null not in (...)` is NULL, which an IF treats as not-true, so without the
  -- explicit `is null` the raise is skipped (rls-self-check-coalesce trap).
  if v_role is null or v_role not in (
    'accounting', 'hr', 'project_director', 'project_coordinator',
    'procurement_manager', 'super_admin', 'project_manager'
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
      v_role in ('accounting', 'hr', 'project_director', 'project_coordinator', 'procurement_manager', 'super_admin')
      or public.can_see_project(t.project_id)
    )
  order by a.work_date, w.name, a.session;
end;
$$;

revoke all on function public.audit_attendance_summary(date, date, uuid) from public;
revoke execute on function public.audit_attendance_summary(date, date, uuid) from anon;
grant execute on function public.audit_attendance_summary(date, date, uuid) to authenticated;

revoke all on function public.audit_attendance_detail(date, date, uuid, uuid) from public;
revoke execute on function public.audit_attendance_detail(date, date, uuid, uuid) from anon;
grant execute on function public.audit_attendance_detail(date, date, uuid, uuid) to authenticated;
