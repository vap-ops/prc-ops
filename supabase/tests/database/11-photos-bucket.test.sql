begin;
select plan(6);

-- ============================================================================
-- Catalog-only assertions for the `photos` Storage bucket + upload policy.
-- NO auth-context simulation here — behavioral RLS proof on storage.objects
-- is deferred to the upload UI unit (which exercises the policy via a real
-- authenticated upload). These assertions guard the bucket row's existence
-- and configuration plus the INSERT policy's existence and shape, so a
-- future migration that drops or misconfigures either fails CI here.
--
-- The migration under test is 20260524040000_create_photos_bucket.sql.
-- ============================================================================

-- 1. Exactly one bucket row with id = 'photos'.
select is(
  (select count(*)::int from storage.buckets where id = 'photos'),
  1,
  'storage.buckets has a row with id = ''photos'''
);

-- 2. The bucket is PRIVATE — load-bearing. A public bucket would leak
--    project photos to anyone with a URL.
select is(
  (select public from storage.buckets where id = 'photos'),
  false,
  'photos bucket is private (public = false)'
);

-- 3. File size limit is 25 MiB (26214400 bytes). Construction phones can
--    produce large originals; this is comfortable headroom.
select is(
  (select file_size_limit from storage.buckets where id = 'photos'),
  26214400::bigint,
  'photos bucket file_size_limit = 25 MiB'
);

-- 4. Allowed MIME types are exactly the four common image formats. Ordering
--    matters here because the column is a text[]; the assertion is array
--    equality.
select is(
  (select allowed_mime_types from storage.buckets where id = 'photos'),
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic']::text[],
  'photos bucket allowed_mime_types is [jpeg, png, webp, heic]'
);

-- 5. INSERT policy on storage.objects named "photos uploads by sa/pm/super"
--    exists, restricted to the authenticated role. The full WITH CHECK
--    expression is verified by the bucket_id and current_user_role()
--    references inside it — checking just existence + cmd + role here is
--    enough at the catalog level; behavioral verification is deferred.
select is(
  (select count(*)::int from pg_policies
     where schemaname = 'storage'
       and tablename  = 'objects'
       and policyname = 'photos uploads by sa/pm/super'
       and cmd        = 'INSERT'
       and 'authenticated' = any(roles)),
  1,
  'INSERT policy "photos uploads by sa/pm/super" exists on storage.objects for authenticated'
);

-- 6. The upload policy admits project_director (spec 201 bug fix). ADR 0058 added
--    project_director to the photo_logs INSERT policy but its sweep (20260752) only
--    covered public.* table policies — this storage.objects policy was missed, so a
--    director's photo upload was denied (the queue stuck on "waiting for signal").
select is(
  (select count(*)::int from pg_policies
     where schemaname = 'storage'
       and tablename  = 'objects'
       and policyname = 'photos uploads by sa/pm/super'
       and with_check like '%project_director%'),
  1,
  'photos upload policy admits project_director'
);

select * from finish();
rollback;
