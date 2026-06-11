-- Fix-forward: p_contractor_id gains DEFAULT NULL so the generated
-- client types mark it optional — the action clears an assignment by
-- omitting the arg (typegen renders non-default args as required
-- `string`, which rejects null). Same function identity; body unchanged.
create or replace function public.set_work_package_contractor(
  p_work_package_id uuid,
  p_contractor_id uuid default null
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
