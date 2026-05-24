-- Create the private `photos` Supabase Storage bucket and the
-- role-gated INSERT policy on storage.objects that governs uploads to it.
--
-- This is the storage half of the photo → approval → PDF pipeline; the
-- table half landed in 20260524020000_create_photo_logs.sql. photo_logs
-- stores a `storage_path` text reference into this bucket; the bucket
-- holds the original image bytes, unmodified.
--
-- Design (locked, see docs/feature-specs/02-photos-and-approvals.md):
--   * PRIVATE bucket. Photos are internal client project data. No
--     public read access. Reads will go through server-generated signed
--     URLs minted by the service role (which bypasses Storage RLS) —
--     deferred to the upload UI unit, NOT in this migration.
--   * Originals only. The watermark is rendered on-demand server-side
--     at view/export time. The bucket never holds a watermarked file
--     (ADR 0003).
--   * Path convention (NOT enforced at the bucket level — applied by
--     application code that mints upload URLs in the next unit):
--       {project_id}/{work_package_id}/{photo_log_id}.{ext}
--     UUID-based, no human-readable names. Authorisation lives in the
--     RLS policy on `public.photo_logs` and in the signed-URL minting
--     endpoint; the path string is just an identifier.
--   * UPLOADS: direct client → Storage, governed by the INSERT policy
--     below. site_admin / project_manager / super_admin may upload
--     (matches photo_logs INSERT policy — same set, same justification:
--     all three privileged roles can both upload AND tombstone).
--   * READS: NO storage.objects SELECT policy in this unit. The reader
--     path is signed URLs minted via the service role, which bypasses
--     Storage RLS. Leaving SELECT unpolicied keeps every read going
--     through the application path that decides "may this user see
--     this photo" — the only place that decision belongs.
--   * UPDATES / DELETES on storage.objects: NO policies. Append-only
--     posture consistent with photo_logs. Tombstoned objects are LEFT
--     in place for v1 (the photo_logs tombstone row is the source of
--     truth for visibility; the underlying object becomes a quiet
--     orphan). Orphan cleanup is a v2 concern.
--   * Bucket-level constraints: 25 MiB file size limit, restricted to
--     common image MIME types (jpeg / png / webp / heic). Construction
--     photos from modern phones are typically 3–8 MB; HEIC originals
--     can run larger. 25 MiB is comfortable headroom without inviting
--     casual abuse.
--   * Policy uses public.current_user_role() (ADR 0011). The helper is
--     SECURITY DEFINER and bypasses RLS, so calling it from inside a
--     storage.objects policy is safe and does not introduce a new
--     recursion vector (storage.objects RLS does not read public.users
--     directly; the helper reads public.users with RLS bypassed).

-- 1. Bucket row. ON CONFLICT (id) DO NOTHING for idempotence — same
--    seed pattern projects/seed.sql uses. The bucket's configuration
--    is part of the schema; if a future migration needs to RECONFIGURE
--    the bucket, it ships as its own explicit ALTER (or UPDATE) so the
--    intent is visible in history.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'photos',
  'photos',
  false,
  26214400,   -- 25 MiB
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']
)
on conflict (id) do nothing;

-- 2. INSERT policy on storage.objects, scoped to bucket_id = 'photos'.
--    Restricted `to authenticated` so it does not also apply to anon or
--    service_role (anon has no upload right; service_role bypasses RLS
--    by design). Same role set as photo_logs INSERT — all three
--    privileged v1 roles upload AND tombstone.
create policy "photos uploads by sa/pm/super"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'photos'
    and public.current_user_role() in (
      'site_admin', 'project_manager', 'super_admin'
    )
  );

-- No SELECT / UPDATE / DELETE policies on storage.objects for the
-- `photos` bucket in this unit, by design (see header comment).
