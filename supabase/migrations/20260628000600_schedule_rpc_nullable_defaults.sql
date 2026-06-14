-- Spec 92 Unit A addendum — give set_work_package_schedule's date params a
-- DEFAULT NULL so typegen marks them optional and the action can OMIT an arg to
-- clear a date (the set_work_package_contractor pattern). Body unchanged; the
-- signature (uuid, date, date) is unchanged, so the existing execute grant holds.
create or replace function public.set_work_package_schedule(
  p_work_package_id uuid,
  p_start date default null,
  p_end   date default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'set_work_package_schedule: role not permitted' using errcode = '42501';
  end if;
  if p_start is not null and p_end is not null and p_end < p_start then
    return false;
  end if;
  update public.work_packages
     set planned_start = p_start, planned_end = p_end
   where id = p_work_package_id;
  return found;
end;
$$;
