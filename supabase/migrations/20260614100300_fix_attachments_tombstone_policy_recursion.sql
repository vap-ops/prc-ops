-- Spec 23 / ADR 0028 fix-forward — the INSERT policy's tombstone-target
-- subquery SELECTed purchase_request_attachments from within that same
-- table's policy, which re-evaluates RLS on the relation → 42P17
-- infinite recursion (found by pgTAP role-sim D.1 on the live DB).
--
-- Same cure as the users-RLS recursion (20260523213246 / ADR 0011): a
-- SECURITY DEFINER helper performs the self-referential check with RLS
-- bypassed. Safe here for the same reason current_user_role() is safe:
-- the helper takes scalar args, reads one row by primary key, leaks
-- nothing beyond "is this a tombstonable target for this caller", and
-- the policy still pins role/creator/parent-status on the NEW row.

create function public.pr_attachment_tombstone_target_ok(
  p_target uuid,
  p_parent uuid,
  p_caller uuid
)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.purchase_request_attachments target
    where target.id = p_target
      and target.purchase_request_id = p_parent
      and target.superseded_by is null
      and (target.purpose <> 'delivery_confirmation'
           or target.created_by = p_caller)
  );
$$;

revoke all on function public.pr_attachment_tombstone_target_ok(uuid, uuid, uuid) from public, anon;
grant execute on function public.pr_attachment_tombstone_target_ok(uuid, uuid, uuid) to authenticated;

drop policy "insert reference while pending or confirmation when delivered"
  on public.purchase_request_attachments;

create policy "insert reference while pending or confirmation when delivered"
  on public.purchase_request_attachments
  for insert
  to authenticated
  with check (
    public.current_user_role() in ('site_admin', 'project_manager', 'super_admin')
    and created_by = auth.uid()
    and (
      (
        purpose = 'reference'
        and exists (select 1 from public.purchase_requests pr
                    where pr.id = purchase_request_id
                      and pr.requested_by = auth.uid()
                      and pr.status = 'requested')
      )
      or
      (
        purpose = 'delivery_confirmation'
        and exists (select 1 from public.purchase_requests pr
                    where pr.id = purchase_request_id
                      and pr.status = 'delivered')
      )
    )
    and (superseded_by is null
         or public.pr_attachment_tombstone_target_ok(
              superseded_by, purchase_request_id, auth.uid()))
  );
