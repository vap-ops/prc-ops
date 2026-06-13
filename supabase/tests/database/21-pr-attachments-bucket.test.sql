begin;
select plan(8);

-- ============================================================================
-- Spec 23 / ADR 0028 — pr-attachments bucket + path-bound upload policy.
-- ============================================================================

select is(
  (select count(*)::int from storage.buckets where id = 'pr-attachments'),
  1, 'pr-attachments bucket exists');

select is(
  (select public from storage.buckets where id = 'pr-attachments'),
  false, 'pr-attachments bucket is PRIVATE (the photos public=true drift is the standing exemplar)');

select is(
  (select file_size_limit from storage.buckets where id = 'pr-attachments'),
  26214400::bigint, 'pr-attachments size limit is 25 MiB');

select is(
  (select allowed_mime_types from storage.buckets where id = 'pr-attachments'),
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic'],
  'pr-attachments mime list is exactly the four image types (no PDF — spec 16 Q3)');

select is(
  (select count(*)::int from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'pr attachment uploads by request owner or receiver'
       and cmd = 'INSERT'),
  1, 'the path-bound upload policy exists by name');

-- "Contains foldername" alone passes broken SQL — pin the role gate and
-- the path-binding function together (spec 16 §7 doctrine).
select ok(
  (select with_check like '%foldername%' and with_check like '%current_user_role%'
     from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'pr attachment uploads by request owner or receiver'),
  'upload policy WITH CHECK binds path (foldername) AND role (current_user_role)');

select ok(
  (select with_check like '%requested%' and with_check like '%delivered%'
     from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'pr attachment uploads by request owner or receiver'),
  'upload policy carries BOTH branches: pending-owner reference + delivered confirmation (ADR 0028)');

-- Spec 70: procurement is admitted by the path-bound upload policy's role
-- gate (back-office parity — it files invoices and delivery confirmations).
select ok(
  (select with_check like '%procurement%'
     from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'pr attachment uploads by request owner or receiver'),
  'upload policy role gate admits procurement (spec 70)');

select * from finish();
rollback;
