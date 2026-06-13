-- Spec 71 — work-package notes (backup capture).
--
-- An editable free-text note on the work package: the catch-all a user
-- can write into when a structured field doesn't have a home (operator:
-- "backups in case we forgot a field"). The WP is the center of
-- information (WP-centric principle), so it gets the first notes slice.
--
-- Write path mirrors set_work_package_contractor (spec 31 / ADR 0011):
-- site_admin is the on-site note author but has NO work_packages UPDATE
-- policy, and widening that policy would hand SA every WP column. The
-- SECURITY DEFINER RPC writes the notes column ONLY, role-gated inside.
-- No audit row (consistent with set_work_package_contractor — WP-column
-- edits aren't individually audited; a note is benign ops text).

alter table public.work_packages
  add column notes text,
  -- App caps at 1000 (the spec-48 requester-notes cap); this CHECK is the
  -- abuse backstop a step above it, and starts closing the queued
  -- DB-CHECK gap for this new column.
  add constraint work_packages_notes_len
    check (notes is null or length(notes) <= 2000);

create function public.set_work_package_notes(
  p_work_package_id uuid,
  p_notes text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.current_user_role() not in ('site_admin', 'project_manager', 'super_admin') then
    raise exception 'set_work_package_notes: role not permitted'
      using errcode = '42501';
  end if;

  update public.work_packages
     set notes = nullif(btrim(p_notes), '')
   where id = p_work_package_id;
  return found;
end;
$$;

revoke all on function public.set_work_package_notes(uuid, text) from public, anon;
grant execute on function public.set_work_package_notes(uuid, text) to authenticated;
