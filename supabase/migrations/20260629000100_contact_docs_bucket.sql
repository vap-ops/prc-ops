-- Spec 97 — the private `contact-docs` bucket + path-bound upload policy for
-- contact documents (ID card / bank book). Mirrors the pr-attachments bucket
-- (20260614100200): PM/super-only INSERT, path shape bound, reads via
-- service-role signed URLs only (NO select policy). No UPDATE/DELETE policies —
-- append-only; orphans accepted (the contact_attachments table is the truth).
--
-- Name-capture hazard honored: the object key is qualified `objects.name` — an
-- unqualified `name` would silently resolve against another table's column.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'contact-docs',
  'contact-docs',
  false,
  26214400,   -- 25 MiB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

-- Path: {kind}/{contactId}/{attachmentId}.{ext} → foldername = [kind, contactId].
create policy "contact doc uploads by pm"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'contact-docs'
    and public.current_user_role() in ('project_manager', 'super_admin')
    and array_length(storage.foldername(objects.name), 1) = 2
    and (storage.foldername(objects.name))[1] in ('contractor', 'supplier', 'service_provider')
  );
