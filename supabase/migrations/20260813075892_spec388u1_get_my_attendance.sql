-- Spec 388 U1 — get_my_attendance(): a ช่าง reads their OWN check-in/out record.
--
-- WHY THIS IS AN RPC AND NOT A QUERY. `muster_attendance` carries exactly one
-- SELECT policy — "muster attendance readable in visible projects", keyed on
-- can_see_project(team.project_id) — and that function's body falls to
-- `else false` for `technician`:
--
--     super_admin / project_coordinator / project_director /
--     procurement_manager            → true
--     project_manager / site_admin /
--     site_owner / auditor           → by project_members or project_lead_id
--     everything else                → false
--
-- So a bound worker cannot read a single row of their own attendance today.
-- Widening can_see_project to admit technician would hand a ช่าง every OTHER
-- worker's attendance in the same project, which is not what the surface needs
-- — hence a self-scoped DEFINER reader instead, mirroring the portal's existing
-- get_my_wage_payments / get_my_assigned_work / get_my_worker_profile shape.
--
-- WHAT IT DELIBERATELY DOES NOT RETURN. Not `setof muster_attendance`: the table
-- also carries scanned_by (another user's id), note and team_id, none of which
-- the ช่าง's own view renders. The projection is exactly the columns
-- src/lib/attendance/attendance-month.ts already models (spec 374's
-- AttendanceMusterRow) plus `session`, so the two audiences share one view model.
--
-- Methods and session are cast to text: attendance-month.ts types them as
-- `string | null` and the enums carry no display meaning the client re-derives.
--
-- ADDITIVE: one new function. No table, column, policy or grant is altered.

create function public.get_my_attendance()
 returns table (
   work_date    date,
   session      text,
   in_at        timestamptz,
   in_method    text,
   out_at       timestamptz,
   out_method   text,
   out_auto     boolean,
   ot_hours     numeric,
   project_name text
 )
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select
    a.work_date,
    a.session::text,
    a.in_at,
    a.in_method::text,
    a.out_at,
    a.out_method::text,
    a.out_auto,
    a.ot_hours,
    p.name
  from public.muster_attendance a
  join public.muster_teams t on t.id = a.team_id
  join public.projects p on p.id = t.project_id
  -- The explicit null guard is the point, not decoration: without it an unbound
  -- caller relies on `= null` matching nothing, which is true but incidental —
  -- and it is exactly the shape that opens a gate when a helper is later made
  -- to return something other than null for an unbound caller.
  where public.current_user_worker_id() is not null
    and a.worker_id = public.current_user_worker_id()
  -- Days newest first; WITHIN a day the sessions run in the order they actually
  -- happened (regular before OT), which is why the second key is ASC while the
  -- first is DESC. Leaving the pair unordered would let the planner decide.
  order by a.work_date desc, a.in_at asc;
$function$;

revoke all on function public.get_my_attendance() from public, anon;
grant execute on function public.get_my_attendance() to authenticated;

comment on function public.get_my_attendance() is
  'Spec 388 U1 — the caller''s OWN muster attendance (self-scoped on workers.user_id). DEFINER because muster_attendance''s only SELECT policy keys on can_see_project, which is false for technician.';
