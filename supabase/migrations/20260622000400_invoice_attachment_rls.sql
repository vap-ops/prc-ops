-- Spec 66 / ADR 0043 — invoice attachments. Extend the attachments INSERT
-- policy and the pr-attachments storage upload policy with an invoice arm,
-- and make 'invoice' creator-only removable.
--
-- DROP+CREATE in place (policy NAME unchanged → the policies_are pgTAP pin
-- stays green). The tombstone clause routes through
-- pr_attachment_tombstone_target_ok (the 42P17 recursion cure,
-- 20260614100300) — NEVER an inline self-referential subquery. Every outer
-- reference is table-qualified; storage uses objects.name (name-capture
-- hazard, see the bucket migration header).

-- 1. Tombstone helper: 'invoice' joins 'delivery_confirmation' as
--    creator-only removable.
create or replace function public.pr_attachment_tombstone_target_ok(
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
      and (target.purpose not in ('delivery_confirmation', 'invoice')
           or target.created_by = p_caller)
  );
$$;

-- 2. Attachments INSERT policy: add the invoice arm. Invoices attach once
--    goods/docs exist — parent status purchased | on_route | delivered |
--    site_purchased — by any requester-capable role, pinned to the caller.
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
                      and pr.status in ('on_route', 'delivered'))
      )
      or
      (
        purpose = 'invoice'
        and exists (select 1 from public.purchase_requests pr
                    where pr.id = purchase_request_id
                      and pr.status in ('purchased', 'on_route', 'delivered', 'site_purchased'))
      )
    )
    and (superseded_by is null
         or public.pr_attachment_tombstone_target_ok(
              superseded_by, purchase_request_id, auth.uid()))
  );

-- 3. Storage upload policy: widen the receiver branch so invoice uploads
--    to purchased | site_purchased parents (in addition to on_route |
--    delivered) are admitted at the path layer. The table policy above is
--    the real per-purpose gate; storage cannot see purpose. objects.name
--    qualified to avoid name-capture against work_packages.name.
drop policy "pr attachment uploads by request owner or receiver"
  on storage.objects;

create policy "pr attachment uploads by request owner or receiver"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'pr-attachments'
    and public.current_user_role() in ('site_admin', 'project_manager', 'super_admin')
    and array_length(storage.foldername(objects.name), 1) = 2
    and exists (
      select 1
      from public.purchase_requests pr
      join public.work_packages wp on wp.id = pr.work_package_id
      where pr.id::text = (storage.foldername(objects.name))[2]
        and wp.project_id::text = (storage.foldername(objects.name))[1]
        and (
          (pr.requested_by = auth.uid() and pr.status = 'requested')
          or pr.status in ('purchased', 'on_route', 'delivered', 'site_purchased')
        )
    )
  );
