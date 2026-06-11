-- Spec 23 / ADR 0028 (spec 16 §4 locked design) — private
-- `pr-attachments` bucket + the path-bound upload policy.
--
-- Unlike the photos bucket's role-only policy, this policy BINDS THE
-- PATH to a parent purchase request the caller may attach to (spec-16
-- adversarial pass): {project_id}/{purchase_request_id}/{attachment_id}.{ext}.
-- Two branches mirroring the table INSERT policy (ADR 0028):
--   1. reference uploads — caller owns the parent and it is 'requested';
--   2. delivery-confirmation uploads — parent is 'delivered' (any
--      requester-capable role; receiver is often not the requester).
--
-- Name-capture hazard honored: the object key inside the subquery is
-- qualified `objects.name` — an unqualified `name` would silently
-- resolve against work_packages.name and the policy would fail open
-- to cross-project paths.
--
-- Reads: NO SELECT policy — signed URLs via service role only (and the
-- future ADR 0029 bridge). No UPDATE/DELETE policies — append-only;
-- orphans accepted; the table is the source of truth.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'pr-attachments',
  'pr-attachments',
  false,
  26214400,   -- 25 MiB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

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
          or pr.status = 'delivered'
        )
    )
  );
