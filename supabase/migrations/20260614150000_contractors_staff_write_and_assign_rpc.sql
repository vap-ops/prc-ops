-- Spec 31 amendment / ADR 0033 — operator: site admins must also add and
-- assign contractors (they run the field). Two changes:
--
-- 1. contractors INSERT/UPDATE policies widen from PM/super to all
--    requester-capable staff.
-- 2. Contractor ASSIGNMENT moves to a SECURITY DEFINER RPC: SA has no
--    work_packages UPDATE policy, and widening that policy would hand
--    SA every WP column. The RPC writes contractor_id ONLY, with the
--    role check inside (ADR 0011 checklist: search_path pinned,
--    revoke-then-grant execute).

drop policy "contractors insert by pm or super_admin" on public.contractors;
create policy "contractors insert by staff"
  on public.contractors
  for insert
  to authenticated
  with check (
    public.current_user_role() in ('site_admin', 'project_manager', 'super_admin')
    and created_by = auth.uid()
  );

drop policy "contractors update by pm or super_admin" on public.contractors;
create policy "contractors update by staff"
  on public.contractors
  for update
  to authenticated
  using (public.current_user_role() in ('site_admin', 'project_manager', 'super_admin'))
  with check (public.current_user_role() in ('site_admin', 'project_manager', 'super_admin'));

create function public.set_work_package_contractor(
  p_work_package_id uuid,
  p_contractor_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() not in ('site_admin', 'project_manager', 'super_admin') then
    raise exception 'set_work_package_contractor: role not permitted'
      using errcode = '42501';
  end if;

  if p_contractor_id is not null
     and not exists (select 1 from public.contractors c where c.id = p_contractor_id) then
    return false;
  end if;

  update public.work_packages
     set contractor_id = p_contractor_id
   where id = p_work_package_id;
  return found;
end;
$$;

revoke all on function public.set_work_package_contractor(uuid, uuid) from public, anon;
grant execute on function public.set_work_package_contractor(uuid, uuid) to authenticated;
