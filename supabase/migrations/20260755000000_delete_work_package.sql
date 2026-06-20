-- Spec 157 / ADR 0059 §3 — delete a work package (Tier 1: empty-only hard delete).
--
-- delete_work_package(p_work_package_id) — SECURITY DEFINER, role-gated to
-- project_manager / super_admin / project_director, AND membership-gated via
-- can_see_wp (ADR 0056). REFUSES (P0001) if the WP has ANY child row — photo_logs,
-- labor_logs, approvals, purchase_requests, work_package_members, or a schedule
-- dependency (as predecessor or successor). Covers only the "created by mistake,
-- no captured evidence" case; a WP WITH history is cancelled instead (Tier 2,
-- deferred). The empty-guard is essential: without it a WP delete would
-- CASCADE-delete its purchase_requests / members / dependencies (silent data
-- loss) and abort on the append-only photo_logs/approvals triggers. Writes an
-- audit_log row (ADR 0059 §6). Allowed on closed projects (delete, not insert).
--
-- The membership gate runs first, so an unknown WP id yields 42501.

create function public.delete_work_package(p_work_package_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_role public.user_role := public.current_user_role();
  v_code text;
  v_name text;
begin
  if v_role not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'delete_work_package: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_wp(p_work_package_id) then
    raise exception 'delete_work_package: not a member of this project' using errcode = '42501';
  end if;

  select code, name into v_code, v_name
    from public.work_packages where id = p_work_package_id;
  if not found then
    return false;
  end if;

  if exists (select 1 from public.photo_logs where work_package_id = p_work_package_id)
     or exists (select 1 from public.labor_logs where work_package_id = p_work_package_id)
     or exists (select 1 from public.approvals where work_package_id = p_work_package_id)
     or exists (select 1 from public.purchase_requests where work_package_id = p_work_package_id)
     or exists (select 1 from public.work_package_members where work_package_id = p_work_package_id)
     or exists (select 1 from public.work_package_dependencies
                 where predecessor_id = p_work_package_id or successor_id = p_work_package_id)
  then
    raise exception 'delete_work_package: work package has history (photos/labor/requests/members/dependencies) — cancel it instead'
      using errcode = 'P0001';
  end if;

  delete from public.work_packages where id = p_work_package_id;

  insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
  values (
    v_uid, v_role, 'other', 'work_packages', p_work_package_id,
    jsonb_build_object('event', 'wp_deleted', 'code', v_code, 'name', v_name)
  );

  return true;
end;
$$;

revoke all on function public.delete_work_package(uuid) from public, anon;
grant execute on function public.delete_work_package(uuid) to authenticated;

comment on function public.delete_work_package(uuid) is
  'Spec 157 / ADR 0059 — hard-delete an EMPTY work package (PM/super/director, membership-gated). Refuses (P0001) if any child row exists — cancel a WP with history instead. Audited.';
