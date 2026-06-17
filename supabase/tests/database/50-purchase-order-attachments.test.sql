begin;
select plan(29);

-- ============================================================================
-- Spec 125 / ADR 0046 Layer B — purchase_order_attachments (the PO source
-- document) + the po-attachments bucket. Mirrors the pr-attachments posture:
-- append-only, back-office RLS-gated INSERT (content-only v1), service-role
-- reads. Sections: B catalog, C checks/trigger/view (postgres), D role-sim RLS,
-- E bucket.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110050', 'pm@poa.local',  '{}'::jsonb),
  ('44444444-4444-4444-4444-444444440050', 'proc@poa.local','{}'::jsonb),
  ('22222222-2222-2222-2222-222222220050', 'sa@poa.local',  '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330050', 'vi@poa.local',  '{}'::jsonb);
update public.users set role = 'project_manager' where id = '11111111-1111-1111-1111-111111110050';
update public.users set role = 'procurement'     where id = '44444444-4444-4444-4444-444444440050';
update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-222222220050';
-- fourth user stays visitor

insert into public.suppliers (id, name, created_by) values
  ('bb000050-0000-4000-8000-000000000001', 'ผู้ขายทดสอบ PO doc',
   '11111111-1111-1111-1111-111111110050');

-- A PO to attach the source document to (RPC-only-writer table; this direct
-- INSERT runs as the postgres superuser, which bypasses RLS).
insert into public.purchase_orders (id, supplier_id, supplier, created_by) values
  ('aa000050-0000-4000-8000-000000000001', 'bb000050-0000-4000-8000-000000000001',
   'ผู้ขายทดสอบ PO doc', '11111111-1111-1111-1111-111111110050');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- B. Catalog.
-- ============================================================================
select enum_has_labels('public', 'purchase_order_attachment_kind',
  array['image', 'pdf'], 'kind enum is exactly {image,pdf} (a PO doc is a file, never a link)');
select has_table('public', 'purchase_order_attachments', 'attachments table exists');
select has_column('public', 'purchase_order_attachments', 'purchase_order_id', 'purchase_order_id column exists');
select has_column('public', 'purchase_order_attachments', 'kind', 'kind column exists');
select has_column('public', 'purchase_order_attachments', 'storage_path', 'storage_path column exists');
select has_column('public', 'purchase_order_attachments', 'superseded_by', 'superseded_by column exists');
select has_view('public', 'purchase_order_attachments_current', 'current-state view exists');

-- ============================================================================
-- C. CHECK shapes, block-write trigger, view semantics (postgres).
-- ============================================================================
select throws_ok(
  $$ insert into public.purchase_order_attachments (purchase_order_id, kind, created_by)
     values ('aa000050-0000-4000-8000-000000000001', 'pdf',
             '22222222-2222-2222-2222-222222220050') $$,
  '23514', null, 'content row with no storage_path violates poa_content_shape');

select throws_ok(
  $$ insert into public.purchase_order_attachments
       (purchase_order_id, kind, storage_path, superseded_by, created_by)
     values ('aa000050-0000-4000-8000-000000000001', 'image', 'po/x.jpg',
             gen_random_uuid(), '22222222-2222-2222-2222-222222220050') $$,
  '23514', null, 'tombstone carrying a payload violates poa_tombstone_shape');

select lives_ok(
  $$ insert into public.purchase_order_attachments
       (id, purchase_order_id, kind, storage_path, created_by)
     values ('ca000050-0000-4000-8000-000000000010', 'aa000050-0000-4000-8000-000000000001',
             'pdf', 'aa000050-0000-4000-8000-000000000001/ca000050-0000-4000-8000-000000000010.pdf',
             '22222222-2222-2222-2222-222222220050') $$,
  'a well-formed pdf source-document content row inserts');

select throws_ok(
  $$ update public.purchase_order_attachments set storage_path = 'po/changed.pdf'
     where id = 'ca000050-0000-4000-8000-000000000010' $$,
  'P0001', null, 'UPDATE is blocked (append-only, supersede via INSERT)');

select throws_ok(
  $$ delete from public.purchase_order_attachments
     where id = 'ca000050-0000-4000-8000-000000000010' $$,
  'P0001', null, 'DELETE is blocked (append-only)');

select is(
  (select count(*)::int from public.purchase_order_attachments_current
     where id = 'ca000050-0000-4000-8000-000000000010'),
  1, '_current includes the live content row');

-- ============================================================================
-- D. Role-simulation RLS (authenticated + JWT claims).
-- ============================================================================
set local role authenticated;

-- D.1 back-office (site_admin) attaches a source document on an existing PO.
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220050"}';
select lives_ok(
  $$ insert into public.purchase_order_attachments
       (id, purchase_order_id, kind, storage_path, created_by)
     values ('da000050-0000-4000-8000-000000000020', 'aa000050-0000-4000-8000-000000000001',
             'image', 'aa000050-0000-4000-8000-000000000001/da000050-0000-4000-8000-000000000020.jpg',
             '22222222-2222-2222-2222-222222220050') $$,
  'back-office attaches a PO source document (content row)');

-- D.2 visitor is denied (role gate).
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330050"}';
select throws_ok(
  $$ insert into public.purchase_order_attachments
       (purchase_order_id, kind, storage_path, created_by)
     values ('aa000050-0000-4000-8000-000000000001', 'image', 'po/deny.jpg',
             '33333333-3333-3333-3333-333333330050') $$,
  '42501', null, 'a visitor cannot attach a PO source document');

-- D.3 content-only: a tombstone INSERT is denied (no removal arm v1; the
--     with_check requires superseded_by IS NULL). The composite FK target
--     (the D.1 image row) exists, so the policy — not the FK — refuses.
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220050"}';
select throws_ok(
  $$ insert into public.purchase_order_attachments
       (purchase_order_id, kind, superseded_by, created_by)
     values ('aa000050-0000-4000-8000-000000000001', 'image',
             'da000050-0000-4000-8000-000000000020',
             '22222222-2222-2222-2222-222222220050') $$,
  '42501', null, 'tombstone INSERT denied — content-only policy (removal UI is a later unit)');

-- D.4 SELECT via parent — back-office sees the PO's documents.
select ok(
  (select count(*)::int from public.purchase_order_attachments_current
     where purchase_order_id = 'aa000050-0000-4000-8000-000000000001') >= 1,
  'back-office reads the PO source documents via the current view');

reset role;

-- ============================================================================
-- E. The po-attachments bucket.
-- ============================================================================
select is(
  (select count(*)::int from storage.buckets where id = 'po-attachments'),
  1, 'po-attachments bucket exists');
select is(
  (select public from storage.buckets where id = 'po-attachments'),
  false, 'po-attachments bucket is PRIVATE');
select is(
  (select file_size_limit from storage.buckets where id = 'po-attachments'),
  26214400::bigint, 'po-attachments size limit is 25 MiB');
select is(
  (select allowed_mime_types from storage.buckets where id = 'po-attachments'),
  array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'],
  'po-attachments mime list is the four image types + application/pdf (PDF from day one)');
select is(
  (select count(*)::int from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'po attachment uploads by back office' and cmd = 'INSERT'),
  1, 'the path-bound upload policy exists by name');
select ok(
  (select with_check like '%foldername%' and with_check like '%current_user_role%'
     from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'po attachment uploads by back office'),
  'upload policy WITH CHECK binds path (foldername) AND role (current_user_role)');

-- ============================================================================
-- F. purpose discriminator (spec 134 U4a).
-- ============================================================================
select enum_has_labels('public', 'purchase_order_attachment_purpose',
  array['source_document', 'proof_of_delivery'],
  'purpose enum is exactly {source_document, proof_of_delivery}');
select has_column('public', 'purchase_order_attachments', 'purpose',
  'purpose column exists on the table');
select has_column('public', 'purchase_order_attachments_current', 'purpose',
  'purpose column is carried on the current-state view');

-- An insert that omits purpose (the existing create-PO source-doc path) defaults
-- to 'source_document' — the content row from section C.
select is(
  (select purpose::text from public.purchase_order_attachments
     where id = 'ca000050-0000-4000-8000-000000000010'),
  'source_document', 'an insert without purpose defaults to source_document');

-- A proof-of-delivery content row inserts and the current view surfaces its purpose.
select lives_ok(
  $$ insert into public.purchase_order_attachments
       (id, purchase_order_id, kind, purpose, storage_path, created_by)
     values ('ea000050-0000-4000-8000-000000000030', 'aa000050-0000-4000-8000-000000000001',
             'image', 'proof_of_delivery',
             'aa000050-0000-4000-8000-000000000001/ea000050-0000-4000-8000-000000000030.jpg',
             '22222222-2222-2222-2222-222222220050') $$,
  'a proof_of_delivery content row inserts');
select is(
  (select purpose::text from public.purchase_order_attachments_current
     where id = 'ea000050-0000-4000-8000-000000000030'),
  'proof_of_delivery', 'the current view surfaces the proof_of_delivery purpose');

select * from finish();
rollback;
