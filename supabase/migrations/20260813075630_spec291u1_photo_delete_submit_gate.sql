-- Spec 291 U1 — photo self-delete gated at submit.
--
-- Progress photos are per-WP approval evidence. A delete is a tombstone
-- (storage_path NULL, superseded_by set — ADR 0015), an append-only supersede.
-- Today the photo_logs INSERT policy admits a tombstone at ANY WP status, so a
-- user can alter a submitted evidence set. Gate the SUPERSEDE-insert (only) so a
-- tombstone is admitted while the WP is still editable and refused once it is
-- submitted for approval or complete. Normal uploads (superseded_by NULL) are
-- untouched — this never adds an UPDATE/DELETE path (append-only preserved).
--
-- Deletable statuses  = not_started · in_progress · on_hold · rework
-- Locked (delete off) = pending_approval · complete

-- photo_wp_deletable(uuid): SECURITY DEFINER so the RLS predicate can read
-- work_packages.status regardless of the caller's row visibility. coalesce-false
-- so a missing WP fails CLOSED (the RLS self-check coalesce trap). Gates on a WP
-- STATUS, not a role — the 254 rls-audit null-unsafe-role-gate scan does not
-- apply, and coalesce keeps it null-safe either way. Explicit anon revoke per
-- the spec 284 lesson (`from public` alone is insufficient).
create or replace function public.photo_wp_deletable(p_wp uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select status not in ('pending_approval', 'complete')
       from public.work_packages
      where id = p_wp),
    false);
$$;

revoke all on function public.photo_wp_deletable(uuid) from public, anon;
grant execute on function public.photo_wp_deletable(uuid) to authenticated;

-- Re-state the live WITH CHECK verbatim (role gate + can_see_wp + own-attribution)
-- and add the delete-only conjunct. ALTER POLICY replaces the whole expression,
-- so the three existing conjuncts are reproduced exactly — the ONLY new behaviour
-- is that a tombstone (superseded_by NOT NULL) additionally requires the WP to be
-- deletable. A normal insert (superseded_by NULL) short-circuits the OR to true.
alter policy "photo_logs insert by sa/pm/super" on public.photo_logs
with check (
  ((select current_user_role()) = any (array['site_admin', 'project_manager', 'super_admin', 'project_director']::user_role[]))
  and (select can_see_wp(photo_logs.work_package_id))
  and (uploaded_by = (select auth.uid()))
  and (superseded_by is null or public.photo_wp_deletable(photo_logs.work_package_id))
);
