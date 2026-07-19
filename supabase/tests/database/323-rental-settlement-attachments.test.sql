begin;
select plan(20);

-- ============================================================================
-- Spec 323 U1d — rental_settlement_attachments: the vendor tax-invoice / payment
-- slip document metadata for a rental settlement (store the receipt, not just its
-- number). ZERO-GRANT money-adjacent table (mirrors rental_settlements): RLS on,
-- NO policy, NO authenticated grant — the metadata row is written ONLY by the
-- admin (service-role) client behind requireRole(BACK_OFFICE_ROLES); a mirrored
-- authenticated INSERT policy would have to join rental_settlements (zero-grant,
-- 0 rows to the caller) and always deny, and granting select on the ฿ table would
-- break the money invariant (spec review HIGH catch). APPEND-ONLY (block
-- update/delete/truncate). The bytes go to the private rental-settlement-receipts
-- bucket via a BACK_OFFICE-role-scoped storage INSERT policy; reads are
-- service-role signed URLs only (pr-attachments posture — no SELECT policy).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110323', 'super@rsa.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220323', 'sa@rsa.local', '{}'::jsonb);
update public.users set role = 'super_admin' where id = '11111111-1111-1111-1111-111111110323';
update public.users set role = 'site_admin'  where id = '22222222-2222-2222-2222-222222220323';

insert into public.suppliers (id, name, created_by) values
  ('bb000323-0000-4000-8000-000000000001', 'บ.เช่าทดสอบ Attach',
   '11111111-1111-1111-1111-111111110323');
insert into public.equipment_rental_batches
    (id, supplier_id, monthly_rate, starts_on, created_by) values
  ('aa000323-0000-4000-8000-000000000001',
   'bb000323-0000-4000-8000-000000000001', 90000, date '2026-07-01',
   '11111111-1111-1111-1111-111111110323');
-- A settlement to attach to (direct owner insert — append-only guards UPDATE/DELETE,
-- not INSERT; the GL enqueue trigger just queues a harmless job in this rolled-back txn).
insert into public.rental_settlements
    (id, agreement_id, invoice_no, invoice_date, base_amount, overtime_amount,
     fees_amount, net_amount, method, created_by) values
  ('cc000323-0000-4000-8000-000000000001',
   'aa000323-0000-4000-8000-000000000001', 'INV-ATT', date '2026-07-05',
   100, 0, 0, 100, 'bank_transfer', '11111111-1111-1111-1111-111111110323');

-- The F2 storage-policy asserts run under `set role authenticated`; the pgTAP runner
-- collects each assertion into _tap_buf, so authenticated needs write access to it
-- (else 42501 errors the whole file — pgtap-tapbuf-grant-role-switch).
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ---- A. Enum + table shape ----
select is(
  (select string_agg(e.enumlabel, ',' order by e.enumsortorder)
     from pg_type t join pg_enum e on e.enumtypid = t.oid
    where t.typname = 'rental_receipt_purpose'),
  'payment_slip,tax_invoice',
  'rental_receipt_purpose enum has payment_slip + tax_invoice');
select is(
  (select string_agg(column_name, ',' order by ordinal_position)
     from information_schema.columns
    where table_schema = 'public' and table_name = 'rental_settlement_attachments'),
  'id,settlement_id,storage_path,purpose,uploaded_by,uploaded_at',
  'rental_settlement_attachments has exactly the spec columns');

-- ---- B. Zero-grant money posture ----
select ok((select relrowsecurity from pg_class where oid = 'public.rental_settlement_attachments'::regclass),
  'RLS enabled on rental_settlement_attachments');
select is((select count(*)::int from pg_policy where polrelid = 'public.rental_settlement_attachments'::regclass),
  0, 'zero-grant money-adjacent table: NO policies at all');
select is(has_table_privilege('authenticated', 'public.rental_settlement_attachments', 'INSERT'),
  false, 'authenticated has no INSERT grant');
select is(has_table_privilege('authenticated', 'public.rental_settlement_attachments', 'SELECT'),
  false, 'authenticated has no SELECT grant (zero-grant — reads via admin only)');
select is(has_table_privilege('authenticated', 'public.rental_settlement_attachments', 'UPDATE'),
  false, 'authenticated has no UPDATE grant');
select is(has_table_privilege('anon', 'public.rental_settlement_attachments', 'SELECT'),
  false, 'anon has no SELECT grant');
-- The admin (service-role) client is the ONLY writer/reader.
select is(has_table_privilege('service_role', 'public.rental_settlement_attachments', 'INSERT'),
  true, 'service_role may INSERT (the admin metadata write)');
select is(has_table_privilege('service_role', 'public.rental_settlement_attachments', 'SELECT'),
  true, 'service_role may SELECT (the admin read for signed URLs)');

-- ---- C. Append-only guard ----
select is(
  (select count(*)::int from pg_trigger where tgrelid = 'public.rental_settlement_attachments'::regclass
     and not tgisinternal and tgname in
       ('rental_settlement_attachments_no_update_delete', 'rental_settlement_attachments_no_truncate')),
  2, 'append-only guard triggers installed');

-- ---- D. A valid metadata row inserts (FK to a real settlement), then is immutable ----
insert into public.rental_settlement_attachments (id, settlement_id, storage_path, purpose, uploaded_by)
values ('dd000323-0000-4000-8000-000000000001',
        'cc000323-0000-4000-8000-000000000001',
        'cc000323-0000-4000-8000-000000000001/dd000323-0000-4000-8000-000000000001.pdf',
        'tax_invoice', '11111111-1111-1111-1111-111111110323');
select is((select purpose::text from public.rental_settlement_attachments
             where id = 'dd000323-0000-4000-8000-000000000001'),
  'tax_invoice', 'a valid attachment row persists');
select throws_ok(
  $$ update public.rental_settlement_attachments set purpose = 'payment_slip'
       where id = 'dd000323-0000-4000-8000-000000000001' $$,
  'P0001', null, 'append-only: direct UPDATE is blocked');
select throws_ok(
  $$ delete from public.rental_settlement_attachments
       where id = 'dd000323-0000-4000-8000-000000000001' $$,
  'P0001', null, 'append-only: direct DELETE is blocked');
-- FK integrity: a bogus settlement_id is rejected.
select throws_ok(
  $$ insert into public.rental_settlement_attachments (settlement_id, storage_path, purpose, uploaded_by)
       values ('00000000-0000-0000-0000-000000000000',
               'x/y.pdf', 'payment_slip', '11111111-1111-1111-1111-111111110323') $$,
  '23503', null, 'FK: an unknown settlement_id is rejected');

-- ---- E. Private bucket + BACK_OFFICE-scoped storage INSERT policy ----
select ok(
  exists (select 1 from storage.buckets where id = 'rental-settlement-receipts' and public = false),
  'private rental-settlement-receipts bucket exists');
select is(
  (select count(*)::int from pg_policy
     where polrelid = 'storage.objects'::regclass
       and polname = 'rental settlement receipt uploads by back office'),
  1, 'storage INSERT policy for the receipts bucket installed');

-- ---- F2. The storage INSERT policy BEHAVES: BACK_OFFICE + depth-1 path allowed,
-- non-back-office denied (fail-closed role scope), wrong folder depth denied. Proves
-- the with-check, not just its existence. ----
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110323"}';  -- super_admin (BACK_OFFICE)
select lives_ok(
  $$ insert into storage.objects (id, bucket_id, name) values
       (gen_random_uuid(), 'rental-settlement-receipts',
        'cc000323-0000-4000-8000-000000000001/ee000323-0000-4000-8000-000000000001.pdf') $$,
  'a BACK_OFFICE role may upload to the receipts bucket at a depth-1 path');
select throws_ok(
  $$ insert into storage.objects (id, bucket_id, name) values
       (gen_random_uuid(), 'rental-settlement-receipts', 'flat-no-folder.pdf') $$,
  '42501', null, 'a wrong folder depth (0) is denied by the policy');
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220323"}';  -- site_admin (NOT back office)
select throws_ok(
  $$ insert into storage.objects (id, bucket_id, name) values
       (gen_random_uuid(), 'rental-settlement-receipts',
        'cc000323-0000-4000-8000-000000000001/ff000323-0000-4000-8000-000000000001.pdf') $$,
  '42501', null, 'a non-BACK_OFFICE role is denied (fail-closed role scope)');
reset role;

select * from finish();
rollback;
