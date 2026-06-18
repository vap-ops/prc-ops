-- Spec 144 U1 — reopen a completed work package for a defect.
--
-- SECURITY DEFINER, role-gated to site_admin / project_manager / super_admin
-- (operator decision: site agents find defects in the field) AND membership-
-- gated via can_see_wp (so a scoped SA/PM must be on the project; super always
-- passes; ADR 0056). Only a 'complete' WP can be reopened; it flips to 'rework'
-- and an audit_log row records the defect reason. The site then re-captures the
-- After photo (the transition predicate now admits 'rework') → pending_approval
-- → PM re-approves → complete (which re-freezes the labor cost via the existing
-- approve path).

create function public.reopen_work_package_for_defect(p_wp uuid, p_reason text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status public.work_package_status;
  v_reason text := btrim(coalesce(p_reason, ''));
  v_uid    uuid := auth.uid();
  v_role   public.user_role := public.current_user_role();
begin
  if v_role not in ('site_admin', 'project_manager', 'super_admin') then
    raise exception 'reopen_work_package_for_defect: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_wp(p_wp) then
    raise exception 'reopen_work_package_for_defect: not a member of this project'
      using errcode = '42501';
  end if;
  if v_reason = '' or char_length(v_reason) > 1000 then
    raise exception 'reopen_work_package_for_defect: reason required (<= 1000 chars)'
      using errcode = '22023';
  end if;

  select status into v_status from public.work_packages where id = p_wp;
  if not found then
    raise exception 'reopen_work_package_for_defect: unknown work package' using errcode = '22023';
  end if;
  if v_status <> 'complete' then
    raise exception 'reopen_work_package_for_defect: only a complete work package can be reopened'
      using errcode = '22023';
  end if;

  update public.work_packages set status = 'rework' where id = p_wp;

  insert into public.audit_log (actor_id, actor_role, action, target_table, target_id, payload)
  values (
    v_uid, v_role, 'other', 'work_packages', p_wp,
    jsonb_build_object('event', 'wp_reopened_for_defect', 'reason', v_reason)
  );

  return true;
end;
$$;

revoke all on function public.reopen_work_package_for_defect(uuid, text) from public, anon;
grant execute on function public.reopen_work_package_for_defect(uuid, text) to authenticated;

comment on function public.reopen_work_package_for_defect(uuid, text) is
  'Spec 144 — reopen a complete WP to rework for a defect (site_admin/PM/super, membership-gated). Records the reason in audit_log. Only complete → rework.';
