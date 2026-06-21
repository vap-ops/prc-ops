-- Spec 165 U4 / ADR 0016 (amended) — delete an EMPTY งวด (deliverable).
--
-- delete_deliverable(p_deliverable_id) — SECURITY DEFINER, role-gated PM/super/
-- director, membership-gated via can_see_project on the งวด's project. REFUSES
-- (P0001) if ANY work_packages reference the งวด: the FK is ON DELETE SET NULL,
-- so without this guard a delete would silently ungroup its งาน — the guard is
-- what makes this empty-only. A populated งวด is emptied first (ungroup its งาน
-- via set_work_package_deliverable(…, null)). Writes an audit_log row. Mirrors
-- delete_work_package (spec 157) and the archive-not-delete exception ADR 0059
-- §3 introduced for WPs. Allowed on closed projects (delete, not insert).

create function public.delete_deliverable(p_deliverable_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid     uuid := auth.uid();
  v_role    public.user_role := public.current_user_role();
  v_project uuid;
  v_code    text;
  v_name    text;
begin
  if v_role not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'delete_deliverable: role not permitted' using errcode = '42501';
  end if;

  select project_id, code, name into v_project, v_code, v_name
    from public.deliverables where id = p_deliverable_id;
  if v_project is null then
    return false;
  end if;
  if not public.can_see_project(v_project) then
    raise exception 'delete_deliverable: not a member of this project' using errcode = '42501';
  end if;

  if exists (select 1 from public.work_packages where deliverable_id = p_deliverable_id) then
    raise exception 'delete_deliverable: deliverable still has work packages — remove them first'
      using errcode = 'P0001';
  end if;

  delete from public.deliverables where id = p_deliverable_id;

  insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
  values (
    v_uid, v_role, 'other', 'deliverables', p_deliverable_id,
    jsonb_build_object('event', 'deliverable_deleted', 'code', v_code, 'name', v_name)
  );

  return true;
end;
$$;

revoke all on function public.delete_deliverable(uuid) from public, anon;
grant execute on function public.delete_deliverable(uuid) to authenticated;

comment on function public.delete_deliverable(uuid) is
  'Spec 165 / ADR 0016 — hard-delete an EMPTY งวด (PM/super/director, membership-gated). Refuses (P0001) if any work_packages reference it — ungroup them first. Audited.';
