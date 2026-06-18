-- Spec 142 U6 — copy work packages from an existing project into another.
--
-- clone_work_packages is SECURITY DEFINER, PM/super (same posture as
-- create_work_package, U4). It copies the WP SKELETON only — code, name,
-- description. A new project starts status/photos/labor/approvals/owner/schedule
-- clean; those are never cloned. Codes the destination already has are skipped
-- (composite unique (project_id, code) → on conflict do nothing), so a clone is
-- idempotent and safe to re-run. Returns the number of rows actually inserted.

create function public.clone_work_packages(
  p_src_project_id uuid,
  p_dst_project_id uuid
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin') then
    raise exception 'clone_work_packages: role not permitted' using errcode = '42501';
  end if;
  if p_src_project_id = p_dst_project_id then
    raise exception 'clone_work_packages: source and destination must differ'
      using errcode = '22023';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_src_project_id)
     or not exists (select 1 from public.projects p where p.id = p_dst_project_id) then
    raise exception 'clone_work_packages: unknown project' using errcode = '22023';
  end if;

  insert into public.work_packages (project_id, code, name, description)
    select p_dst_project_id, w.code, w.name, w.description
      from public.work_packages w
     where w.project_id = p_src_project_id
  on conflict (project_id, code) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function public.clone_work_packages(uuid, uuid) from public, anon;
grant execute on function public.clone_work_packages(uuid, uuid) to authenticated;

comment on function public.clone_work_packages(uuid, uuid) is
  'Spec 142 — copy the work-package skeleton (code/name/description) from one project into another (PM/super). Idempotent: skips codes the destination already has. Returns rows inserted.';
