-- Spec 201 (bug fix from feedback triage) — a project_director could not upload
-- photos: their capture enqueued, the bytes upload to the `photos` bucket was denied
-- by RLS, and the offline queue stuck forever on the misleading "รอส่งรูป … เมื่อมีสัญญาณ"
-- banner (on every device, with working internet).
--
-- Root cause: ADR 0058 (spec 152, mig 20260752000000) made project_director a
-- see-all writer and added it to the photo_logs INSERT policy — but that sweep only
-- reconstructed public.* table policies from pg_policies; the photos STORAGE bucket
-- upload policy lives on storage.objects and was missed. So a director's metadata
-- insert would have succeeded while the prerequisite bytes upload was refused.
--
-- Fix: add project_director to the photos upload policy, matching photo_logs. The
-- policy name is kept (precedent: 20260752 added project_director to
-- "photo_logs insert by sa/pm/super" without renaming it). No CREATE OR REPLACE for
-- policies in Postgres → DROP + CREATE from the original body (this policy has not
-- been modified since 20260524040000).
--
-- NOTE: the sibling pr-attachments bucket upload policies carry the same ADR-0058
-- gap (delivery-confirmation / invoice photos) but were re-touched by later
-- migrations; fixing those safely needs a source-from-LIVE pass and is tracked
-- separately.

drop policy "photos uploads by sa/pm/super" on storage.objects;
create policy "photos uploads by sa/pm/super"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'photos'
    and public.current_user_role() in (
      'site_admin', 'project_manager', 'super_admin', 'project_director'
    )
  );
