-- Spec 70 — procurement onboarding: back-office RLS parity.
--
-- The app layer already declares procurement a back-office role
-- (isBackOfficeRole), the record_purchase/record_shipment SECURITY DEFINER
-- RPCs already gate it in, and the purchase_requests + suppliers SELECT
-- policies already admit it. Three RLS policies never caught up, so a
-- procurement user on /requests would see no work-package identity and hit
-- broken upload buttons. This migration aligns the privilege layer: it adds
-- 'procurement' to three existing role IN-lists. No new object, no new column.
--
-- Posture preserved:
--   * work_packages: procurement gains SELECT only. INSERT/UPDATE stay
--     project_manager/super_admin (procurement never writes WPs).
--   * Each policy is DROP+CREATE in place with its NAME unchanged, so the
--     policies_are pgTAP pins (files 08, 20, 21) stay green; only role-set
--     assertions change.
--   * appsheet_writer is unaffected: current_user_role() returns NULL for
--     that DB role, so none of these USING/WITH CHECK arms admit it (it has
--     its own TO appsheet_writer policies).
--   * Every outer reference inside the storage policy stays table-qualified
--     (objects.name) — the name-capture hazard against work_packages.name
--     (see 20260614100200 / 20260622000400 headers).

-- 1. work_packages SELECT — procurement may read all WPs (WP identity on the
--    worklist + project_id for the detail-page uploaders). Reproduces
--    20260524010000's policy verbatim plus 'procurement'.
drop policy "work_packages readable by privileged roles" on public.work_packages;

create policy "work_packages readable by privileged roles"
  on public.work_packages for select
  using (
    public.current_user_role() in (
      'site_admin', 'project_manager', 'procurement', 'super_admin'
    )
  );

-- 2. purchase_request_attachments INSERT — procurement joins the back-office
--    uploaders (invoice + delivery-confirmation). Reproduces 20260622000400's
--    policy verbatim plus 'procurement' in the role gate; the per-purpose
--    arms are unchanged (the reference arm's own-parent + status='requested'
--    predicate keeps it inert for a non-requester).
drop policy "insert reference while pending or confirmation when delivered"
  on public.purchase_request_attachments;

create policy "insert reference while pending or confirmation when delivered"
  on public.purchase_request_attachments
  for insert
  to authenticated
  with check (
    public.current_user_role() in ('site_admin', 'project_manager', 'procurement', 'super_admin')
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

-- 3. storage pr-attachments INSERT — procurement admitted at the path layer.
--    Reproduces 20260622000400's storage policy verbatim plus 'procurement'.
--    The table policy above is the real per-purpose gate; storage cannot see
--    purpose. objects.name stays qualified (name-capture hazard).
drop policy "pr attachment uploads by request owner or receiver"
  on storage.objects;

create policy "pr attachment uploads by request owner or receiver"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'pr-attachments'
    and public.current_user_role() in ('site_admin', 'project_manager', 'procurement', 'super_admin')
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
