begin;
select plan(26);

-- ============================================================================
-- Spec 380 U6 — list_money_events_for_review.doc_count for purchase_requests
-- becomes the §3 coverage union, and a waiver discharges the ไม่มีเอกสาร tab.
--
-- Before U6 the PR half was BOTH purpose-blind (a reference/delivery photo
-- counted as an accounting document) and blind to every PO-level document, so
-- the tab over-counted (620 live rows vs ~272 truly missing) while silently
-- under-counting the orders that carry only a photo.
--
-- Pins here: the class SSOT helper over its COMPLETE domain (vat / non_vat /
-- unknown) · the PR purpose filter · the PO source_document union · the
-- class-aware typed rule (a cash bill does NOT discharge a VAT vendor — the
-- input-VAT gap this spec exists to close) · NEVER_SATISFYING types · the
-- _current supersede semantics · the waiver leaving/re-entering the tab, with
-- doc_count staying HONEST (a waiver is not a document).
--
-- ⚠️ The RPC unions LIVE prod rows — every assert is scoped to fixture ids or
-- the fixture month; NEVER a global count (doctrine: no global counts on
-- operator-writable tables).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('10000000-0000-4000-8000-000000000380', 'acct@dc380.local', '{}'::jsonb);
update public.users set role = 'accounting' where id = '10000000-0000-4000-8000-000000000380';

insert into public.projects (id, code, name) values
  ('c1000000-0000-4000-8000-000000000380', 'TAP-DC380', 'Doc count P1');
insert into public.work_packages (id, project_id, code, name) values
  ('e1000000-0000-4000-8000-000000000380', 'c1000000-0000-4000-8000-000000000380',
   'WP-DC380', 'doc count WP');

-- Two supplier classes. is_vat_registered is NOT NULL, so "unknown" is only
-- reachable by having NO supplier row at all (spec §2 amendment).
insert into public.suppliers (id, name, is_vat_registered, created_by) values
  ('5a000000-0000-4000-8000-000000000380', 'DC380 VAT vendor',  true,
   '10000000-0000-4000-8000-000000000380'),
  ('5b000000-0000-4000-8000-000000000380', 'DC380 cash vendor', false,
   '10000000-0000-4000-8000-000000000380');

insert into public.purchase_orders (id, supplier_id, supplier, created_by) values
  ('b0000000-0000-4000-8000-000000000380', '5b000000-0000-4000-8000-000000000380',
   'DC380 cash vendor', '10000000-0000-4000-8000-000000000380'),
  ('b1000000-0000-4000-8000-000000000380', '5b000000-0000-4000-8000-000000000380',
   'DC380 cash vendor', '10000000-0000-4000-8000-000000000380');

-- One PR per case. purchased_at pins them all into the fixture month so the
-- tab asserts below can filter to it.
insert into public.purchase_requests
  (id, project_id, work_package_id, item_description, quantity, unit,
   requested_by, status, amount, purchased_at, supplier_id, purchase_order_id)
values
  -- B. PR-half purpose filter
  ('a1000000-0000-4000-8000-000000000380', 'c1000000-0000-4000-8000-000000000380',
   'e1000000-0000-4000-8000-000000000380', 'reference only', 1, 'ea',
   '10000000-0000-4000-8000-000000000380', 'delivered', 100,
   '2001-03-15 09:00:00+00', '5b000000-0000-4000-8000-000000000380', null),
  ('a2000000-0000-4000-8000-000000000380', 'c1000000-0000-4000-8000-000000000380',
   'e1000000-0000-4000-8000-000000000380', 'delivery photo only', 1, 'ea',
   '10000000-0000-4000-8000-000000000380', 'delivered', 100,
   '2001-03-15 09:00:00+00', '5b000000-0000-4000-8000-000000000380', null),
  ('a3000000-0000-4000-8000-000000000380', 'c1000000-0000-4000-8000-000000000380',
   'e1000000-0000-4000-8000-000000000380', 'invoice purpose', 1, 'ea',
   '10000000-0000-4000-8000-000000000380', 'delivered', 100,
   '2001-03-15 09:00:00+00', '5b000000-0000-4000-8000-000000000380', null),
  ('a4000000-0000-4000-8000-000000000380', 'c1000000-0000-4000-8000-000000000380',
   'e1000000-0000-4000-8000-000000000380', 'payment purpose', 1, 'ea',
   '10000000-0000-4000-8000-000000000380', 'delivered', 100,
   '2001-03-15 09:00:00+00', '5b000000-0000-4000-8000-000000000380', null),
  ('a5000000-0000-4000-8000-000000000380', 'c1000000-0000-4000-8000-000000000380',
   'e1000000-0000-4000-8000-000000000380', 'quote purpose', 1, 'ea',
   '10000000-0000-4000-8000-000000000380', 'delivered', 100,
   '2001-03-15 09:00:00+00', '5b000000-0000-4000-8000-000000000380', null),
  -- C. PO-half union
  ('a6000000-0000-4000-8000-000000000380', 'c1000000-0000-4000-8000-000000000380',
   'e1000000-0000-4000-8000-000000000380', 'po source doc', 1, 'ea',
   '10000000-0000-4000-8000-000000000380', 'delivered', 100,
   '2001-03-15 09:00:00+00', '5b000000-0000-4000-8000-000000000380',
   'b0000000-0000-4000-8000-000000000380'),
  ('a7000000-0000-4000-8000-000000000380', 'c1000000-0000-4000-8000-000000000380',
   'e1000000-0000-4000-8000-000000000380', 'po delivery proof', 1, 'ea',
   '10000000-0000-4000-8000-000000000380', 'delivered', 100,
   '2001-03-15 09:00:00+00', '5b000000-0000-4000-8000-000000000380',
   'b1000000-0000-4000-8000-000000000380'),
  -- D. class-aware typed rule
  ('a8000000-0000-4000-8000-000000000380', 'c1000000-0000-4000-8000-000000000380',
   'e1000000-0000-4000-8000-000000000380', 'vat + full tax invoice', 1, 'ea',
   '10000000-0000-4000-8000-000000000380', 'delivered', 100,
   '2001-03-15 09:00:00+00', '5a000000-0000-4000-8000-000000000380', null),
  ('a9000000-0000-4000-8000-000000000380', 'c1000000-0000-4000-8000-000000000380',
   'e1000000-0000-4000-8000-000000000380', 'vat + cash bill', 1, 'ea',
   '10000000-0000-4000-8000-000000000380', 'delivered', 100,
   '2001-03-15 09:00:00+00', '5a000000-0000-4000-8000-000000000380', null),
  ('aa000000-0000-4000-8000-000000000380', 'c1000000-0000-4000-8000-000000000380',
   'e1000000-0000-4000-8000-000000000380', 'non-vat + cash bill', 1, 'ea',
   '10000000-0000-4000-8000-000000000380', 'delivered', 100,
   '2001-03-15 09:00:00+00', '5b000000-0000-4000-8000-000000000380', null),
  ('ab000000-0000-4000-8000-000000000380', 'c1000000-0000-4000-8000-000000000380',
   'e1000000-0000-4000-8000-000000000380', 'unknown + cert in lieu', 1, 'ea',
   '10000000-0000-4000-8000-000000000380', 'delivered', 100,
   '2001-03-15 09:00:00+00', null, null),
  ('ac000000-0000-4000-8000-000000000380', 'c1000000-0000-4000-8000-000000000380',
   'e1000000-0000-4000-8000-000000000380', 'vat + delivery note', 1, 'ea',
   '10000000-0000-4000-8000-000000000380', 'delivered', 100,
   '2001-03-15 09:00:00+00', '5a000000-0000-4000-8000-000000000380', null),
  ('ad000000-0000-4000-8000-000000000380', 'c1000000-0000-4000-8000-000000000380',
   'e1000000-0000-4000-8000-000000000380', 'non-vat + transfer slip', 1, 'ea',
   '10000000-0000-4000-8000-000000000380', 'delivered', 100,
   '2001-03-15 09:00:00+00', '5b000000-0000-4000-8000-000000000380', null),
  ('ae000000-0000-4000-8000-000000000380', 'c1000000-0000-4000-8000-000000000380',
   'e1000000-0000-4000-8000-000000000380', 'non-vat + other', 1, 'ea',
   '10000000-0000-4000-8000-000000000380', 'delivered', 100,
   '2001-03-15 09:00:00+00', '5b000000-0000-4000-8000-000000000380', null),
  -- E. supersede semantics
  ('af000000-0000-4000-8000-000000000380', 'c1000000-0000-4000-8000-000000000380',
   'e1000000-0000-4000-8000-000000000380', 'superseded invoice', 1, 'ea',
   '10000000-0000-4000-8000-000000000380', 'delivered', 100,
   '2001-03-15 09:00:00+00', '5b000000-0000-4000-8000-000000000380', null),
  -- F. waiver
  ('b2000000-0000-4000-8000-000000000380', 'c1000000-0000-4000-8000-000000000380',
   'e1000000-0000-4000-8000-000000000380', 'waived dead end', 1, 'ea',
   '10000000-0000-4000-8000-000000000380', 'delivered', 100,
   '2001-03-15 09:00:00+00', '5a000000-0000-4000-8000-000000000380', null);

insert into public.purchase_request_attachments
  (purchase_request_id, kind, purpose, doc_type, storage_path, created_by)
values
  ('a1000000-0000-4000-8000-000000000380', 'image', 'reference',              null, 'p/a1', '10000000-0000-4000-8000-000000000380'),
  ('a2000000-0000-4000-8000-000000000380', 'image', 'delivery_confirmation',  null, 'p/a2', '10000000-0000-4000-8000-000000000380'),
  ('a3000000-0000-4000-8000-000000000380', 'image', 'invoice',                null, 'p/a3', '10000000-0000-4000-8000-000000000380'),
  ('a4000000-0000-4000-8000-000000000380', 'image', 'payment',                null, 'p/a4', '10000000-0000-4000-8000-000000000380'),
  ('a5000000-0000-4000-8000-000000000380', 'image', 'quote',                  null, 'p/a5', '10000000-0000-4000-8000-000000000380'),
  ('a8000000-0000-4000-8000-000000000380', 'image', 'reference', 'tax_invoice_full',  'p/a8', '10000000-0000-4000-8000-000000000380'),
  ('a9000000-0000-4000-8000-000000000380', 'image', 'reference', 'receipt_cash_bill', 'p/a9', '10000000-0000-4000-8000-000000000380'),
  ('aa000000-0000-4000-8000-000000000380', 'image', 'reference', 'receipt_cash_bill', 'p/aa', '10000000-0000-4000-8000-000000000380'),
  ('ab000000-0000-4000-8000-000000000380', 'image', 'reference', 'cert_in_lieu',      'p/ab', '10000000-0000-4000-8000-000000000380'),
  ('ac000000-0000-4000-8000-000000000380', 'image', 'reference', 'delivery_note',     'p/ac', '10000000-0000-4000-8000-000000000380'),
  ('ad000000-0000-4000-8000-000000000380', 'image', 'reference', 'transfer_slip',     'p/ad', '10000000-0000-4000-8000-000000000380'),
  ('ae000000-0000-4000-8000-000000000380', 'image', 'reference', 'other',             'p/ae', '10000000-0000-4000-8000-000000000380');

-- E. Deleting an attachment. The table is append-only (UPDATE raises P0001), so
-- a delete INSERTS a payload-less TOMBSTONE carrying superseded_by → the row it
-- retires (pra_tombstone_shape: superseded_by is null OR storage_path is null).
-- Nothing points AT a tombstone, so a plain not-pointed-at anti-join KEEPS it
-- and a deleted invoice still reads as a document — which is why doc_count must
-- read through purchase_request_attachments_current.
insert into public.purchase_request_attachments
  (id, purchase_request_id, kind, purpose, doc_type, storage_path, created_by, superseded_by)
values
  ('f1000000-0000-4000-8000-000000000380', 'af000000-0000-4000-8000-000000000380',
   'image', 'invoice', null, 'p/af-old', '10000000-0000-4000-8000-000000000380', null),
  ('f2000000-0000-4000-8000-000000000380', 'af000000-0000-4000-8000-000000000380',
   'image', 'invoice', null, null, '10000000-0000-4000-8000-000000000380',
   'f1000000-0000-4000-8000-000000000380');

insert into public.purchase_order_attachments
  (purchase_order_id, kind, purpose, doc_type, storage_path, created_by)
values
  ('b0000000-0000-4000-8000-000000000380', 'image', 'source_document',   null, 'o/b0', '10000000-0000-4000-8000-000000000380'),
  ('b1000000-0000-4000-8000-000000000380', 'image', 'proof_of_delivery', null, 'o/b1', '10000000-0000-4000-8000-000000000380');

grant usage on schema public to authenticated, anon;
grant select, insert on table _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. The class SSOT helper, over its COMPLETE domain.
--    Mirrors SATISFYING_DOC_TYPES in src/lib/purchasing/doc-chase.ts; the two
--    are pinned to the same literal table on both sides so a one-sided edit reds.
-- ============================================================================
select is(public.purchase_doc_satisfying_types(true),
  array['tax_invoice_full']::public.purchase_doc_type[],
  'a VAT vendor is discharged ONLY by a full tax invoice');
select is(public.purchase_doc_satisfying_types(false),
  array['tax_invoice_full','receipt_cash_bill','payment_voucher','cert_in_lieu']::public.purchase_doc_type[],
  'a non-VAT vendor is discharged by the RD fallback ladder');
select is(public.purchase_doc_satisfying_types(null),
  array['tax_invoice_full','receipt_cash_bill','payment_voucher','cert_in_lieu']::public.purchase_doc_type[],
  'an unknown supplier (no row) gets the fallback ladder, not the VAT rule');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "10000000-0000-4000-8000-000000000380"}';

-- ============================================================================
-- B. PR half — the purpose filter (the under-count fix).
-- ============================================================================
select is((select doc_count from public.list_money_events_for_review('any', null, date '2001-03-01')
           where source_id = 'a1000000-0000-4000-8000-000000000380'),
  0, 'a reference photo is not an accounting document');
select is((select doc_count from public.list_money_events_for_review('any', null, date '2001-03-01')
           where source_id = 'a2000000-0000-4000-8000-000000000380'),
  0, 'a delivery-confirmation photo is not an accounting document');
select is((select doc_count from public.list_money_events_for_review('any', null, date '2001-03-01')
           where source_id = 'a3000000-0000-4000-8000-000000000380'),
  1, 'an untyped invoice-purpose attachment counts (covered-loose, §2 decision ②)');
select is((select doc_count from public.list_money_events_for_review('any', null, date '2001-03-01')
           where source_id = 'a4000000-0000-4000-8000-000000000380'),
  1, 'an untyped payment-purpose attachment counts (covered-loose)');
select is((select doc_count from public.list_money_events_for_review('any', null, date '2001-03-01')
           where source_id = 'a5000000-0000-4000-8000-000000000380'),
  0, 'a quote is not an accounting document');

-- ============================================================================
-- C. PO half — the union the count was entirely blind to.
-- ============================================================================
select is((select doc_count from public.list_money_events_for_review('any', null, date '2001-03-01')
           where source_id = 'a6000000-0000-4000-8000-000000000380'),
  1, 'a PO source_document discharges its purchase request');
select is((select doc_count from public.list_money_events_for_review('any', null, date '2001-03-01')
           where source_id = 'a7000000-0000-4000-8000-000000000380'),
  0, 'a PO proof-of-delivery photo does not');

-- ============================================================================
-- D. Class-aware typed rule.
-- ============================================================================
select is((select doc_count from public.list_money_events_for_review('any', null, date '2001-03-01')
           where source_id = 'a8000000-0000-4000-8000-000000000380'),
  1, 'a full tax invoice discharges a VAT vendor');
select is((select doc_count from public.list_money_events_for_review('any', null, date '2001-03-01')
           where source_id = 'a9000000-0000-4000-8000-000000000380'),
  0, 'a cash bill does NOT discharge a VAT vendor (the input-VAT gap)');
select is((select doc_count from public.list_money_events_for_review('any', null, date '2001-03-01')
           where source_id = 'aa000000-0000-4000-8000-000000000380'),
  1, 'a cash bill DOES discharge a non-VAT vendor');
select is((select doc_count from public.list_money_events_for_review('any', null, date '2001-03-01')
           where source_id = 'ab000000-0000-4000-8000-000000000380'),
  1, 'a cert-in-lieu discharges an unknown-class order');
select is((select doc_count from public.list_money_events_for_review('any', null, date '2001-03-01')
           where source_id = 'ac000000-0000-4000-8000-000000000380'),
  0, 'a delivery note never satisfies (ม.65 ตรี (18))');
select is((select doc_count from public.list_money_events_for_review('any', null, date '2001-03-01')
           where source_id = 'ad000000-0000-4000-8000-000000000380'),
  0, 'a transfer slip never satisfies');
select is((select doc_count from public.list_money_events_for_review('any', null, date '2001-03-01')
           where source_id = 'ae000000-0000-4000-8000-000000000380'),
  0, 'doc_type other never satisfies');

-- ============================================================================
-- E. Deleted attachments — neither the tombstone nor its target may count.
-- ============================================================================
select is((select doc_count from public.list_money_events_for_review('any', null, date '2001-03-01')
           where source_id = 'af000000-0000-4000-8000-000000000380'),
  0, 'a DELETED invoice counts as no document — the tombstone is not one either');

-- ============================================================================
-- F. The waiver discharges the tab — with doc_count staying honest.
--    Positive controls on both sides: an uncovered order IS in the tab and a
--    covered one is NOT, so "absent" cannot pass by the tab being empty.
-- ============================================================================
select is((select count(*) from public.list_money_events_for_review('no_docs', null, date '2001-03-01')
           where source_id = 'a1000000-0000-4000-8000-000000000380'),
  1::bigint, 'positive control — an uncovered order sits in the ไม่มีเอกสาร tab');
select is((select count(*) from public.list_money_events_for_review('no_docs', null, date '2001-03-01')
           where source_id = 'a3000000-0000-4000-8000-000000000380'),
  0::bigint, 'positive control — a covered order is absent from the tab');
select is((select count(*) from public.list_money_events_for_review('no_docs', null, date '2001-03-01')
           where source_id = 'b2000000-0000-4000-8000-000000000380'),
  1::bigint, 'before the waiver the dead-end order sits in the tab');

select lives_ok($$ select public.waive_purchase_docs(
  'b2000000-0000-4000-8000-000000000380', 'vendor_refused', 'ผู้ขายปฏิเสธ') $$,
  'accounting may waive the dead-end order');

select is((select count(*) from public.list_money_events_for_review('no_docs', null, date '2001-03-01')
           where source_id = 'b2000000-0000-4000-8000-000000000380'),
  0::bigint, 'a waived order leaves the ไม่มีเอกสาร tab — otherwise the waiver is inert');
select is((select doc_count from public.list_money_events_for_review('any', null, date '2001-03-01')
           where source_id = 'b2000000-0000-4000-8000-000000000380'),
  0, 'doc_count stays 0 for a waived order — a waiver is not a document');

select lives_ok($$ select public.unwaive_purchase_docs('b2000000-0000-4000-8000-000000000380') $$,
  'accounting may remove the waiver');
select is((select count(*) from public.list_money_events_for_review('no_docs', null, date '2001-03-01')
           where source_id = 'b2000000-0000-4000-8000-000000000380'),
  1::bigint, 'removing the waiver returns the order to the tab');

reset role;

select * from finish();
rollback;
