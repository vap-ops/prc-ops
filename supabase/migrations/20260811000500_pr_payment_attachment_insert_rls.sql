-- Procurement bug 2 (cont.) — allow attaching a PAYMENT proof (purpose 'payment')
-- to a PR that has a purchase to pay for. A SEPARATE permissive INSERT policy
-- (permissive policies OR together) so the large existing attachment insert
-- policy stays untouched. Mirrors the 'invoice' arm: any back-office writer (the
-- attachment role set) may attach once status is purchased | on_route |
-- delivered | site_purchased. Reads ride the existing purpose-agnostic
-- "select via parent" policy; the column-level insert grant already covers
-- purpose. Supersede (edit/remove) reuses the shared tombstone guard.

create policy "insert payment proof when purchased"
  on public.purchase_request_attachments for insert to authenticated
  with check (
    (select public.current_user_role()) = any (array[
      'site_admin', 'project_manager', 'procurement', 'super_admin', 'project_director'
    ]::public.user_role[])
    and created_by = (select auth.uid())
    and purpose = 'payment'
    and exists (
      select 1 from public.purchase_requests pr
       where pr.id = purchase_request_attachments.purchase_request_id
         and pr.status = any (array[
           'purchased', 'on_route', 'delivered', 'site_purchased'
         ]::public.purchase_request_status[])
    )
    and (
      superseded_by is null
      or public.pr_attachment_tombstone_target_ok(
           superseded_by, purchase_request_id, (select auth.uid()))
    )
  );
