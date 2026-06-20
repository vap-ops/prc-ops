-- Spec 160 U3 / ADR 0061 (invariant 5/6) — the portal as the worker's home.
-- First Stage-0 step: surface each crew member's CURRENT PROJECT (U1's
-- workers.project_id) on the external DC portal (ADR 0051). Record, not coin —
-- coins stay super_admin-only (ADR 0060 §4 externals-invisible + gift-first).
--
-- get_my_crew_assignments() is read-only and scoped to the CALLER'S OWN crew via
-- the ADR 0051 binding (current_user_contractor_id()). SECURITY DEFINER so an
-- external contractor can read only THEIR assigned projects' code/name past the
-- staff-scoped projects RLS — an unbound / staff caller (no binding → NULL) gets
-- zero rows, and no contractor ever sees another's crew. Same posture as
-- get_my_dc_payments (revoke public/anon; grant execute to authenticated).

create function public.get_my_crew_assignments()
returns table (
  worker_id    uuid,
  name         text,
  active       boolean,
  project_id   uuid,
  project_code text,
  project_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select w.id, w.name, w.active, w.project_id, p.code, p.name
  from public.workers w
  left join public.projects p on p.id = w.project_id
  -- NULL binding (staff / unbound) => `contractor_id = NULL` matches no row.
  where w.contractor_id = public.current_user_contractor_id()
  order by w.name;
$$;

revoke all on function public.get_my_crew_assignments() from public, anon;
grant execute on function public.get_my_crew_assignments() to authenticated;
