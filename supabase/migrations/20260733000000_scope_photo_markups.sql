-- Spec 143 U4 / ADR 0056 — scope photo_markups, recursion-free.
--
-- U3 (20260731000000) tried to scope photo_markups but its INSERT policy
-- self-joins photo_markups (the tombstone-target EXISTS), which Postgres flags
-- as 42P17 infinite recursion once the SELECT policy is function-based; that
-- was reverted in 20260732000000. This migration scopes it correctly by moving
-- the self-read into a SECURITY DEFINER helper (the
-- pr_attachment_tombstone_target_ok precedent, ADR 0011) so the policy no longer
-- references photo_markups directly — no recursion. Closes the last read leak
-- from the lifecycle audit; completes ADR 0056 "full isolation".

-- ----------------------------------------------------------------------------
-- Helpers.
-- ----------------------------------------------------------------------------
-- Recreated (dropped in 20260732000000): photo_log → WP → can_see_wp.
create function public.can_see_photo_log(p_photo_log_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (select public.can_see_wp(pl.work_package_id)
       from public.photo_logs pl
      where pl.id = p_photo_log_id),
    false)
$$;

revoke all on function public.can_see_photo_log(uuid) from public, anon;
grant execute on function public.can_see_photo_log(uuid) to authenticated;

comment on function public.can_see_photo_log(uuid) is
  'ADR 0056 — can_see_wp for a photo_log''s work package (false if gone). For photo_markups scoping.';

-- Tombstone-target check, moved out of the INSERT policy to avoid the policy
-- self-joining photo_markups (42P17). Definer reads photo_markups bypassing
-- RLS; auth.uid() is still the caller, so the creator-pin holds.
create function public.photo_markup_tombstone_target_ok(
  p_superseded_by uuid,
  p_photo_log_id  uuid
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.photo_markups target
    where target.id = p_superseded_by
      and target.photo_log_id = p_photo_log_id
      and target.superseded_by is null
      and target.created_by = auth.uid()
  )
$$;

revoke all on function public.photo_markup_tombstone_target_ok(uuid, uuid) from public, anon;
grant execute on function public.photo_markup_tombstone_target_ok(uuid, uuid) to authenticated;

comment on function public.photo_markup_tombstone_target_ok(uuid, uuid) is
  'ADR 0056 — true if (superseded_by) is a non-superseded content markup on the same photo_log created by the caller. Definer so the photo_markups INSERT policy need not self-join photo_markups (no 42P17).';

-- ----------------------------------------------------------------------------
-- Scoped policies.
-- ----------------------------------------------------------------------------
drop policy "photo_markups readable by privileged roles" on public.photo_markups;
create policy "photo_markups readable by privileged roles"
  on public.photo_markups for select to authenticated
  using ((select public.can_see_photo_log(photo_log_id)));

-- INSERT: same content/own-tombstone rule as the original, but the tombstone
-- branch now calls the definer helper instead of an inline self-EXISTS, plus
-- the membership gate. Role list kept (project_coordinator stays read-only).
drop policy "photo_markups insert content or own tombstone" on public.photo_markups;
create policy "photo_markups insert content or own tombstone"
  on public.photo_markups for insert to authenticated
  with check (
    (select public.current_user_role()) in ('site_admin', 'project_manager', 'super_admin')
    and created_by = (select auth.uid())
    and exists (select 1 from public.photo_logs pl where pl.id = photo_log_id)
    and (
      superseded_by is null
      or (select public.photo_markup_tombstone_target_ok(superseded_by, photo_log_id))
    )
    and (select public.can_see_photo_log(photo_log_id))
  );
