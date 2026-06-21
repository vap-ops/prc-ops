-- Spec 165 U1 / ADR 0059 §2 — rename a งวดงาน (deliverable).
--
-- set_deliverable_name(p_deliverable_id, p_name) — SECURITY DEFINER, role-gated
-- to project_manager / super_admin / project_director, AND membership-gated via
-- can_see_project on the งวด's project (deliverables have no can_see_* of their
-- own — the project is the unit of visibility). An unknown id or a project the
-- caller can't see yields 42501 (mirrors set_work_package_name's can_see-first
-- behaviour: a missing/invisible row is denied, not a silent false). Name is
-- trimmed, non-empty, <= 200 chars (mirrors create_deliverable) — else 22023.
-- code stays immutable (a cross-surface business key). No audit (benign edit).

create function public.set_deliverable_name(
  p_deliverable_id uuid,
  p_name text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name       text := btrim(coalesce(p_name, ''));
  v_project_id uuid;
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'set_deliverable_name: role not permitted'
      using errcode = '42501';
  end if;

  select project_id into v_project_id
    from public.deliverables where id = p_deliverable_id;
  if v_project_id is null or not public.can_see_project(v_project_id) then
    raise exception 'set_deliverable_name: not a member of this project'
      using errcode = '42501';
  end if;

  if v_name = '' or char_length(v_name) > 200 then
    raise exception 'set_deliverable_name: invalid name'
      using errcode = '22023';
  end if;

  update public.deliverables
     set name = v_name
   where id = p_deliverable_id;
  return found;
end;
$$;

revoke all on function public.set_deliverable_name(uuid, text) from public, anon;
grant execute on function public.set_deliverable_name(uuid, text) to authenticated;

comment on function public.set_deliverable_name(uuid, text) is
  'Spec 165 / ADR 0059 — rename a งวดงาน (PM/super/director, membership-gated via can_see_project). Trimmed, non-empty, <= 200 chars (else 22023). code immutable. No audit (benign edit).';
