-- ERD audit (2026-06-29) — finding M2. The work_packages UPDATE policy is
-- column-blind: it admits project_manager/super_admin/project_director to UPDATE
-- ANY column, so a direct user-context UPDATE can set status (e.g. rework ->
-- complete, skipping re-approval) or bump rework_round arbitrarily, bypassing the
-- status-machine RPCs and their mandatory audit_log writes.
--
-- Fix: column-scope the table UPDATE grant so status / rework_round can change
-- ONLY through the SECURITY DEFINER status-machine functions
-- (reopen_work_package_for_defect, the new set_work_package_hold below, the
-- approve/submit/decision paths via the service-role admin client). Those run as
-- the function owner / service role and bypass the column grant; a direct
-- authenticated UPDATE of status/rework_round is now rejected with 42501.
--
-- The ONLY user-context (RLS-client) writer of status was setHoldStatus
-- (src/app/review/work-packages/[workPackageId]/actions.ts). It moves here into
-- a definer RPC; every other status write already goes through a definer RPC or
-- the admin client (verified). So no legitimate path breaks.

-- ----------------------------------------------------------------------------
-- 1. set_work_package_hold — the PM on-hold toggle, lifted out of the RLS client.
--    hold:  not_started/in_progress -> on_hold.
--    release: on_hold -> re-derived from CURRENT During photos (in_progress if any
--             exist, else not_started), matching deriveReleaseStatus +
--             selectCurrentPhotosByPhase (a photo is current iff storage_path is
--             not null — not a tombstone — and not superseded by a newer row).
--    Role: PM_ROLES (pm/super/project_director); membership via can_see_wp.
-- ----------------------------------------------------------------------------
create function public.set_work_package_hold(p_wp uuid, p_hold boolean)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status     public.work_package_status;
  v_has_during boolean;
  v_new        public.work_package_status;
begin
  if not (public.current_user_role()
          = any (array['project_manager', 'super_admin', 'project_director']::public.user_role[])) then
    raise exception 'set_work_package_hold: role not permitted' using errcode = '42501';
  end if;
  if not public.can_see_wp(p_wp) then
    raise exception 'set_work_package_hold: not a member of this project' using errcode = '42501';
  end if;

  select status into v_status from public.work_packages where id = p_wp;
  if not found then
    raise exception 'set_work_package_hold: work package not found' using errcode = 'P0001';
  end if;

  if p_hold then
    if v_status not in ('not_started', 'in_progress') then
      raise exception 'set_work_package_hold: cannot hold from status %', v_status using errcode = 'P0001';
    end if;
    update public.work_packages set status = 'on_hold'
      where id = p_wp and status in ('not_started', 'in_progress');
    v_new := 'on_hold';
  else
    if v_status <> 'on_hold' then
      raise exception 'set_work_package_hold: work package is not on hold' using errcode = 'P0001';
    end if;
    select exists (
      select 1 from public.photo_logs pl
      where pl.work_package_id = p_wp
        and pl.phase = 'during'
        and pl.storage_path is not null
        and not exists (select 1 from public.photo_logs n where n.superseded_by = pl.id)
    ) into v_has_during;
    v_new := case when v_has_during then 'in_progress' else 'not_started' end;
    update public.work_packages set status = v_new
      where id = p_wp and status = 'on_hold';
  end if;

  return v_new::text;
end;
$$;

revoke all on function public.set_work_package_hold(uuid, boolean) from public, anon;
grant execute on function public.set_work_package_hold(uuid, boolean) to authenticated;

-- ----------------------------------------------------------------------------
-- 2. Column-scope the table UPDATE grant. work_packages had no explicit grant —
--    authenticated held table-wide UPDATE via Supabase's default
--    GRANT ON ALL TABLES. REVOKE it and re-GRANT every column EXCEPT status and
--    rework_round. (Definer RPCs + the service-role admin client bypass this, so
--    every legitimate transition keeps working; the RLS UPDATE policy still gates
--    rows for the granted columns.)
-- ----------------------------------------------------------------------------
revoke update on public.work_packages from authenticated, anon;
grant update (
  id, project_id, code, name, description, created_at, updated_at,
  deliverable_id, owner_id, contractor_id, notes, priority,
  planned_start, planned_end, category_id
) on public.work_packages to authenticated;
