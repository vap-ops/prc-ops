-- Fix (operator-reported 2026-07-11): procurement + site_admin cannot upload
-- delivery-receipt photos to the pr-attachments bucket.
--
-- Root cause. The storage.objects INSERT policy "pr attachment uploads by request
-- owner or receiver" gated the byte-upload with an EXISTS that INNER-joined
-- work_packages (wp.id = pr.work_package_id) and matched wp.project_id:
--
--     from purchase_requests pr join work_packages wp on wp.id = pr.work_package_id
--     where pr.id::text = foldername[2] and wp.project_id::text = foldername[1] ...
--
-- Since spec 195 P1 (purchase requests are WP-optional, project_id NOT NULL) and
-- spec 208 (store-first: deliveries land in the store, no WP), store-bound PRs
-- have work_package_id NULL — the inner join yields zero rows → EXISTS false →
-- RLS denies the upload. The client uploader then reports "saved, will auto-send"
-- but the offline queue marks it authz-denied and never sends. At report time
-- 209/209 on_route|delivered PRs had work_package_id NULL, so effectively every
-- delivery-photo upload (procurement grid + the SA `การรับของ` store-receipt card,
-- which share one DeliveryPhotoUploader) failed.
--
-- The canonical path is {project_id}/{purchase_request_id}/{attachment_id}.{ext}
-- where segment 1 is the PR's OWN project_id (buildPrAttachmentStoragePath, fed
-- from pr.project_id server-side). The purchase_request_attachments INSERT policy's
-- delivery arm is already WP-agnostic (it keys on pr.id + pr.status only); the
-- storage policy is the one that never caught up.
--
-- Fix. DROP + CREATE the SAME-named policy, reconstructed VERBATIM from the live
-- policy (20260809001500_spec182u4_quote_attachment) with two changes:
--   1. the EXISTS drops the work_packages join and matches pr.project_id
--      (= path segment 1) — mirroring the table policy, covering WP-less and
--      WP-bound PRs alike (pr.project_id is NOT NULL for both);
--   2. add 'procurement_manager' to the role gate — the table INSERT policy
--      already admits it (procurement lead / zeeparn), the storage gate did not,
--      so a procurement_manager was double-blocked.
-- Name unchanged → the policies_are / name pins (pgTAP file 21) stay green.
-- objects.name stays qualified inside foldername() — the name-capture hazard
-- against work_packages.name is now moot (no work_packages ref), but the pattern
-- is kept. No data change; the bucket, its privacy, and append-only posture are
-- untouched.

drop policy "pr attachment uploads by request owner or receiver"
  on storage.objects;

create policy "pr attachment uploads by request owner or receiver"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'pr-attachments'
    and public.current_user_role() in
      ('site_admin', 'project_manager', 'procurement', 'procurement_manager',
       'super_admin', 'project_director')
    and array_length(storage.foldername(objects.name), 1) = 2
    and exists (
      select 1
      from public.purchase_requests pr
      where pr.id::text = (storage.foldername(objects.name))[2]
        and pr.project_id::text = (storage.foldername(objects.name))[1]
        and (
          (pr.requested_by = auth.uid() and pr.status = 'requested')
          or pr.status in ('approved', 'purchased', 'on_route', 'delivered', 'site_purchased')
        )
    )
  );
