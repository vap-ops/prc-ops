-- Spec 91 follow-up — manual WP priority flag (the operator's alignment
-- lever). PM/super set a work package's urgency; the Field-First worklist's
-- "ต้องทำ" band sorts by it and renders a "ด่วน" tag. This is the HUMAN
-- override, distinct from the future critical-path engine (which will write
-- a separate is_critical column).
--
-- Authz mirrors set_work_package_contractor (ADR 0033 / ADR 0011): the write
-- goes through a SECURITY DEFINER RPC with the role check inside (search_path
-- pinned, revoke-then-grant execute). Priority is a PM/super decision, so the
-- RPC permits only those two roles — site_admin is denied (42501).

-- 1. Enum. Declaration order normal < urgent < critical, so an enum
--    comparison / ORDER BY sorts by urgency with no extra machinery (same
--    idiom as purchase_request_priority).
create type public.work_package_priority as enum ('normal', 'urgent', 'critical');

-- 2. Column. NOT NULL DEFAULT 'normal' — safe/backfilled on existing rows.
alter table public.work_packages
  add column priority public.work_package_priority not null default 'normal';

comment on column public.work_packages.priority is
  'Manual PM/super urgency flag (spec 91 follow-up). normal<urgent<critical by enum declaration order; drives the worklist ด่วน tag + ต้องทำ sort. Distinct from the future critical-path is_critical column.';

-- 3. Setter RPC — mirrors set_work_package_contractor. PM/super only.
create function public.set_work_package_priority(
  p_work_package_id uuid,
  p_priority public.work_package_priority
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
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
