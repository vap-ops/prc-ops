-- Spec 164 U1 / ADR 0016 + ADR 0059 §1 — the in-app "add งวดงาน" write path.
--
-- create_deliverable was deferred when the WP→deliverable binding shipped
-- (Spec 155); until now งวดงาน existed only via seed-deliverables.sql, so a
-- project created (or imported) in-app had no deliverables and no way to make
-- one. This RPC is the missing door.
--
-- Posture mirrors create_work_package (Spec 142 U4): SECURITY DEFINER, role
-- gated internally. The gate adds project_director (Spec 152 / matches the
-- set_work_package_deliverable binding gate). sort_order is auto-assigned to
-- max+1 within the project so new งวด land at the end of the seeded ordering.
-- Duplicate (project_id, code) raises 23505 for the UI to surface. No
-- closed-project block: adding a งวด is benign metadata and binding is already
-- allowed on closed projects (ADR 0059 §5).

create function public.create_deliverable(
  p_project_id uuid,
  p_code       text,
  p_name       text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text := btrim(coalesce(p_code, ''));
  v_name text := btrim(coalesce(p_name, ''));
  v_sort integer;
  v_id   uuid;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'create_deliverable: role not permitted' using errcode = '42501';
  end if;
  if v_code = '' or char_length(v_code) > 50 then
    raise exception 'create_deliverable: invalid code' using errcode = '22023';
  end if;
  if v_name = '' or char_length(v_name) > 200 then
    raise exception 'create_deliverable: invalid name' using errcode = '22023';
  end if;
  if not exists (select 1 from public.projects p where p.id = p_project_id) then
    raise exception 'create_deliverable: unknown project' using errcode = '22023';
  end if;

  select coalesce(max(sort_order), 0) + 1 into v_sort
    from public.deliverables where project_id = p_project_id;

  insert into public.deliverables (project_id, code, name, sort_order)
  values (p_project_id, v_code, v_name, v_sort)
  returning id into v_id;

  return v_id;
end;
$$;

revoke all on function public.create_deliverable(uuid, text, text) from public, anon;
grant execute on function public.create_deliverable(uuid, text, text) to authenticated;

comment on function public.create_deliverable(uuid, text, text) is
  'Spec 164 — create a งวดงาน (deliverable) under a project (PM/super/director, SECURITY DEFINER). sort_order auto = max+1. Duplicate (project_id, code) raises 23505.';
