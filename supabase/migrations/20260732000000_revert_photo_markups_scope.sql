-- Spec 143 U3 — fix-forward: revert the photo_markups scoping from
-- 20260731000000.
--
-- That migration scoped photo_markups SELECT to can_see_photo_log and added the
-- helper to its INSERT WITH CHECK. But photo_markups' INSERT policy
-- self-references photo_markups (the tombstone-target EXISTS subquery) — safe
-- only while the SELECT policy was a trivial role check. With a function-based
-- SELECT policy, Postgres raises 42P17 "infinite recursion detected in policy
-- for relation photo_markups" on every markup INSERT. Restore the original
-- working policies (verbatim pre-U3 form) to un-break prod.
--
-- The labor_logs + work_package_dependencies read-scoping and the write-mirrors
-- from 20260731000000 are correct and remain. Correctly scoping photo_markups
-- needs a SECURITY DEFINER tombstone-target helper (the
-- pr_attachment_tombstone_target_ok precedent, ADR 0011) so the policy no longer
-- self-joins the table — deferred to spec 143 U4. The now-unused
-- can_see_photo_log helper is dropped.

drop policy "photo_markups readable by privileged roles" on public.photo_markups;
create policy "photo_markups readable by privileged roles"
  on public.photo_markups for select
  using (
    current_user_role() in ('site_admin', 'project_manager', 'super_admin')
  );

drop policy "photo_markups insert content or own tombstone" on public.photo_markups;
create policy "photo_markups insert content or own tombstone"
  on public.photo_markups for insert
  with check (
    current_user_role() in ('site_admin', 'project_manager', 'super_admin')
    and created_by = auth.uid()
    and exists (
      select 1 from public.photo_logs pl where pl.id = photo_markups.photo_log_id
    )
    and (
      superseded_by is null
      or exists (
        select 1 from public.photo_markups target
        where target.id = photo_markups.superseded_by
          and target.photo_log_id = photo_markups.photo_log_id
          and target.superseded_by is null
          and target.created_by = auth.uid()
      )
    )
  );

drop function public.can_see_photo_log(uuid);
