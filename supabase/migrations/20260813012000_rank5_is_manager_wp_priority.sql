-- Architecture-quality audit rank 5 (sql-role-helpers), stage 2 — per-domain
-- ADOPTION of the SQL role predicates from stage 1 (migration 20260813003200).
--
-- PILOT domain: work-package priority. The inline manager gate
--   current_user_role() not in ('project_manager', 'super_admin', 'project_director')
-- is replaced by the SSOT predicate
--   not public.is_manager(public.current_user_role())
-- which is the SQL counterpart of isManagerRole (src/lib/auth/role-home.ts).
--
-- BEHAVIOUR-PRESERVING: is_manager(role) is defined (20260813003200) as exactly
-- role in ('project_manager','super_admin','project_director'), and pgTAP 231
-- asserts TS↔SQL parity of that set — so this is a pure refactor of the gate, no
-- change to who may call the RPC. The denial coverage in pgTAP 46 (site_admin /
-- visitor → 42501, PM → ok) re-confirms it.
--
-- Body sourced from LIVE via pg_get_functiondef (not a migration file — the
-- repeated re-source trap); the ONLY change is the gate predicate. Additive
-- CREATE OR REPLACE (same signature) preserves the EXECUTE grants; re-asserted
-- below for clarity and to keep the anon-exec invariant (pgTAP 229) explicit.

create or replace function public.set_work_package_priority(
  p_work_package_id uuid,
  p_priority public.work_package_priority
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_manager(public.current_user_role()) then
    raise exception 'set_work_package_priority: role not permitted'
      using errcode = '42501';
  end if;

  update public.work_packages
     set priority = p_priority
   where id = p_work_package_id;
  return found;
end;
$$;

revoke all on function public.set_work_package_priority(uuid, public.work_package_priority) from public, anon;
grant execute on function public.set_work_package_priority(uuid, public.work_package_priority) to authenticated;
