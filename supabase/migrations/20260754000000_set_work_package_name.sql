-- Spec 156 / ADR 0059 §2 — edit a work package's name.
--
-- set_work_package_name(p_work_package_id, p_name) — SECURITY DEFINER, role-gated
-- to project_manager / super_admin / project_director, AND membership-gated via
-- can_see_wp (ADR 0056). Name is trimmed, non-empty, <= 200 chars (mirrors
-- create_work_package's bound) — else 22023. No audit (benign edit, ADR 0059 §6).
-- code stays immutable (a cross-surface business key — deferred, ADR 0059 §2).
--
-- Like set_work_package_priority, returns `found`; but the membership gate runs
-- first, so an unknown WP id yields 42501 (can_see_wp is false for a missing WP).

create function public.set_work_package_name(
  p_work_package_id uuid,
  p_name text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
begin
  if public.current_user_role() not in ('project_manager', 'super_admin', 'project_director') then
    raise exception 'set_work_package_name: role not permitted'
      using errcode = '42501';
  end if;
  if not public.can_see_wp(p_work_package_id) then
    raise exception 'set_work_package_name: not a member of this project'
      using errcode = '42501';
  end if;
  if v_name = '' or char_length(v_name) > 200 then
    raise exception 'set_work_package_name: invalid name'
      using errcode = '22023';
  end if;

  update public.work_packages
     set name = v_name
   where id = p_work_package_id;
  return found;
end;
$$;

revoke all on function public.set_work_package_name(uuid, text) from public, anon;
grant execute on function public.set_work_package_name(uuid, text) to authenticated;

comment on function public.set_work_package_name(uuid, text) is
  'Spec 156 / ADR 0059 — rename a WP (PM/super/director, membership-gated). Trimmed, non-empty, <= 200 chars (else 22023). code stays immutable. No audit (benign edit).';
