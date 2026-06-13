-- Data-architecture hardening (rank 3, final RLS correction) — photo_markups
-- must have BOTH policies bare, not just its INSERT policy (reverted in
-- 20260625000700). The INSERT policy's tombstone-target check self-references
-- photo_markups; when that subquery reads the table, photo_markups' SELECT
-- policy is applied. With the SELECT policy wrapped in (select ...) for
-- eval-once, that re-application recurses (42P17 infinite recursion). Revert the
-- SELECT policy to its original bare form. photo_markups is therefore the single
-- table fully excluded from eval-once (low-volume photo annotations); routing
-- its tombstone check through a SECURITY DEFINER helper, like attachments'
-- pr_attachment_tombstone_target_ok, would let both policies rejoin the
-- optimization later. All other 66 public policies remain correctly wrapped.

drop policy "photo_markups readable by privileged roles" on public.photo_markups;
create policy "photo_markups readable by privileged roles"
  on public.photo_markups for select
  to authenticated
  using (
    public.current_user_role() in ('site_admin', 'project_manager', 'super_admin')
  );
