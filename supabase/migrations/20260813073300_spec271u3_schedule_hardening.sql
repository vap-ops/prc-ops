-- Spec 271 U3 / ADR 0075 §4.7 — set_work_package_schedule hardening.
--
-- The live function gated on is_manager() only: no membership check, no
-- is_group rejection, and any manager could move any project's dates. It
-- becomes: manager-tier OR site_owner (D4 resequence authority), member of the
-- WP's project (can_see_wp — site_owner rides the new 073100 arm), งานย่อย
-- only (dates never live on a งาน group; its window derives from children).
-- The old p_end < p_start → return false contract is kept for existing
-- callers. Audit rows come from the 073200 trigger — the RPC adds none.
--
-- The direct planned_start/planned_end column UPDATE grant is REVOKED: the RPC
-- becomes the only authenticated edit path (the status/rework_round lockdown
-- precedent, ERD-audit M2). Definer RPCs and the service-role client are
-- unaffected.
--
-- Body sourced from LIVE; signature unchanged (no DROP needed).

create or replace function public.set_work_package_schedule(
  p_work_package_id uuid,
  p_start date default null,
  p_end date default null
)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_role     public.user_role := public.current_user_role();
  v_is_group boolean;
begin
  if not (public.is_manager(v_role) or coalesce(v_role = 'site_owner', false)) then
    raise exception 'set_work_package_schedule: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_wp(p_work_package_id) then
    raise exception 'set_work_package_schedule: not a member of this project'
      using errcode = '42501';
  end if;

  select is_group into v_is_group
    from public.work_packages where id = p_work_package_id;
  if not found then
    raise exception 'set_work_package_schedule: unknown work package' using errcode = '22023';
  end if;
  if v_is_group then
    raise exception 'set_work_package_schedule: a group work package cannot hold dates'
      using errcode = '22023';
  end if;

  if p_start is not null and p_end is not null and p_end < p_start then
    return false;
  end if;
  update public.work_packages
     set planned_start = p_start, planned_end = p_end
   where id = p_work_package_id;
  return found;
end;
$function$;

revoke update (planned_start, planned_end) on public.work_packages from authenticated;
