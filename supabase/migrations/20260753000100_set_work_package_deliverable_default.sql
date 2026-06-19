-- Spec 155 / ADR 0059 — give set_work_package_deliverable's p_deliverable_id a
-- DEFAULT NULL so typegen marks the arg optional and the server action can OMIT
-- it to ungroup (the same idiom as set_work_package_schedule's optional dates /
-- set_work_package_contractor). Passing NULL explicitly still works. Body is
-- unchanged from 20260753000000 — CREATE OR REPLACE only adds the default and
-- preserves existing grants.

create or replace function public.set_work_package_deliverable(
  p_work_package_id uuid,
  p_deliverable_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_project_id     uuid;
  v_del_project_id uuid;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'set_work_package_deliverable: role not permitted'
      using errcode = '42501';
  end if;
  if not public.can_see_wp(p_work_package_id) then
    raise exception 'set_work_package_deliverable: not a member of this project'
      using errcode = '42501';
  end if;

  select project_id into v_project_id
    from public.work_packages where id = p_work_package_id;
  if not found then
    return false;
  end if;

  if p_deliverable_id is not null then
    select project_id into v_del_project_id
      from public.deliverables where id = p_deliverable_id;
    if not found then
      raise exception 'set_work_package_deliverable: unknown deliverable'
        using errcode = '22023';
    end if;
    if v_del_project_id <> v_project_id then
      raise exception 'set_work_package_deliverable: deliverable belongs to another project'
        using errcode = '22023';
    end if;
  end if;

  update public.work_packages
     set deliverable_id = p_deliverable_id
   where id = p_work_package_id;
  return true;
end;
$$;
