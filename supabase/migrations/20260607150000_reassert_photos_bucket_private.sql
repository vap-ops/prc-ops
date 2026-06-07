-- Re-assert the photos Storage bucket as PRIVATE (public = false).
--
-- ADR 0003: photos are private; reads happen only via service-role-minted
-- short-TTL signed URLs (src/lib/photos/signed-urls.ts) + the worker's
-- service-role download. The bucket's create migration declared
-- public = false, but the live DB was found at public = true on
-- 2026-06-07 — dashboard drift, not a code change (no migration sets it
-- true). A public bucket serves objects at a predictable unauthenticated
-- URL, degrading the access model from "signed-URL-only" to URL-obscurity.
--
-- This repairs the drift through the git+CLI flow per
-- docs/policies/change-management.md §4. Re-drift to public=true after
-- this migration is evidence of continued out-of-band dashboard access
-- and should be investigated, not silently re-fixed.

update storage.buckets set public = false where id = 'photos';
