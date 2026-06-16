-- Spec 125 — conform the purchase_order_attachments policies to the RLS
-- eval-once standard (rank-3 hardening, 20260625000600/000700/000800): wrap
-- current_user_role() / auth.uid() in a scalar subselect so the planner
-- evaluates them ONCE per query (InitPlan), not per row. 20260703000000 shipped
-- them bare (mirroring the pre-hardening pr-attachments form); file 40 pins the
-- public-schema standard. DROP+CREATE in place, policy NAMES unchanged.
--
-- The storage upload policy is wrapped too (file 40 only scans public, but
-- eval-once is a pure win on a multi-file upload's per-row check).

drop policy "insert source document by back office" on public.purchase_order_attachments;

create policy "insert source document by back office"
  on public.purchase_order_attachments
  for insert
  to authenticated
  with check (
    (select public.current_user_role()) in
      ('site_admin', 'project_manager', 'procurement', 'super_admin')
    and created_by = (select auth.uid())
    and superseded_by is null
    and exists (select 1 from public.purchase_orders po where po.id = purchase_order_id)
  );

drop policy "po attachment uploads by back office" on storage.objects;

create policy "po attachment uploads by back office"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'po-attachments'
    and (select public.current_user_role()) in
      ('site_admin', 'project_manager', 'procurement', 'super_admin')
    and array_length(storage.foldername(objects.name), 1) = 1
    and exists (
      select 1 from public.purchase_orders po
      where po.id::text = (storage.foldername(objects.name))[1]
    )
  );
