-- Spec 155 / ADR 0059 §1 — bind a work package to a deliverable (งวดงาน).
--
-- set_work_package_deliverable(p_work_package_id, p_deliverable_id) — SECURITY
-- DEFINER, role-gated to project_manager / super_admin / project_director, AND
-- membership-gated via can_see_wp (ADR 0056, the reopen_work_package_for_defect
-- precedent). p_deliverable_id NULL = ungroup. A non-null deliverable must EXIST
-- and belong to the SAME project as the WP (cross-project / unknown rejected,
-- 22023). Mirrors set_work_package_priority; no audit row (benign metadata,
-- ADR 0059 §6). The read/grouping path (deliverable lens) already consumes
-- work_packages.deliverable_id — no read change.
--
-- Ordering note: the membership gate runs first, so an unknown WP id yields
-- 42501 (can_see_wp is false for a missing WP) — we never disclose WP existence
-- to a non-member. The post-gate not-found guard is a race-safety only.

create function public.set_work_package_deliverable(
  p_work_package_id uuid,
  p_deliverable_id uuid
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

revoke all on function public.set_work_package_deliverable(uuid, uuid) from public, anon;
grant execute on function public.set_work_package_deliverable(uuid, uuid) to authenticated;

comment on function public.set_work_package_deliverable(uuid, uuid) is
  'Spec 155 / ADR 0059 — bind a WP to a deliverable (PM/super/director, membership-gated). NULL = ungroup. A non-null deliverable must share the WP project (else 22023). No audit (benign metadata).';
