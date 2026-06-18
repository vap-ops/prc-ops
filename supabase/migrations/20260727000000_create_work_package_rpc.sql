-- Spec 142 U4 — the in-app "add work package" write path.
--
-- create_work_package is SECURITY DEFINER and gates on role internally
-- (project_manager / super_admin) — the same posture as create_project (U1).
-- The work_packages INSERT policy is already PM/super, but a definer RPC
-- sidesteps the table-grant question and gives one validated entry point. code
-- is unique WITHIN a project (composite unique) → a duplicate raises 23505 for
-- the UI to surface.

create function public.create_work_package(
  p_project_id  uuid,
  p_code        text,
  p_name        text,
  p_description text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := btrim(coalesce(p_code, ''));
  v_name text := btrim(coalesce(p_name, ''));
  v_desc text := nullif(btrim(coalesce(p_description, '')), '');
  v_id   uuid;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'create_work_package: role not permitted' using errcode = '42501';
  end if;
  if v_code = '' or char_length(v_code) > 50 then
    raise exception 'create_work_package: invalid code' using errcode = '22023';
  end if;
  if v_name = '' or char_length(v_name) > 200 then
    raise exception 'create_work_package: invalid name' using errcode = '22023';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception 'create_work_package: unknown project' using errcode = '22023';
  end if;

  insert into public.work_packages (project_id, code, name, description)
  values (p_project_id, v_code, v_name, v_desc)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_work_package(uuid, text, text, text) from public, anon;
grant execute on function public.create_work_package(uuid, text, text, text) to authenticated;

comment on function public.create_work_package(uuid, text, text, text) is
  'Spec 142 — create a work package under a project (PM/super, SECURITY DEFINER). Duplicate (project_id, code) raises 23505 for the UI to surface.';
