-- Architecture-quality audit rank 5 (sql-role-helpers), stage 1 — SQL role
-- predicates that mirror the TypeScript role-set SSOT (src/lib/auth/role-home.ts).
--
-- Problem: ~140 SECURITY DEFINER RPC gates inline the manager/back-office role
-- list as `current_user_role() not in ('project_manager','super_admin',
-- 'project_director')`. There is no SQL predicate and zero TS↔SQL parity, so a
-- membership change (e.g. spec 152 adding project_director) is shotgun surgery on
-- the SQL side AND can silently diverge from the TS gates. These predicates are
-- the SQL counterpart of isManagerRole / BACK_OFFICE_ROLES / SITE_STAFF_ROLES.
--
-- This migration is ADDITIVE only — it introduces the predicates and a parity
-- pgTAP guard. Adopting them inside the existing RPC gates (replacing the inline
-- arrays with `not public.is_manager(public.current_user_role())`) is deliberately
-- STAGED per-domain in follow-up units, so a behaviour-preserving rewrite of the
-- money/data RPCs is reviewed in small, testable batches rather than one sweep.
--
-- Safety: pure IMMUTABLE functions of their role argument — no table access, NOT
-- SECURITY DEFINER. The anon-exec-definer hardening (pgTAP 229 invariant) targets
-- definer functions only and does not apply here; anon-exec is inert (a boolean
-- over a passed enum, no data or privilege). Granted to authenticated so RLS
-- policies and gates may call them; mirrors current_user_role's grant.

-- is_manager — PM_ROLES (a see-all project_director rides along, ADR 0058).
create function public.is_manager(p_role public.user_role)
returns boolean
language sql
immutable
as $$
  select p_role in ('project_manager', 'super_admin', 'project_director')
$$;

-- is_back_office — BACK_OFFICE_ROLES: the PM set PLUS procurement, NOT site_admin
-- (supplier-master + purchase/shipment writes are financial data).
create function public.is_back_office(p_role public.user_role)
returns boolean
language sql
immutable
as $$
  select p_role in ('project_manager', 'super_admin', 'procurement', 'project_director')
$$;

-- is_site_staff — SITE_STAFF_ROLES: site_admin PLUS the PM set (field capture).
create function public.is_site_staff(p_role public.user_role)
returns boolean
language sql
immutable
as $$
  select p_role in ('site_admin', 'project_manager', 'super_admin', 'project_director')
$$;

grant execute on function public.is_manager(public.user_role) to authenticated;
grant execute on function public.is_back_office(public.user_role) to authenticated;
grant execute on function public.is_site_staff(public.user_role) to authenticated;
