begin;
select plan(10);

-- ============================================================================
-- Spec 195 Phase 3 / ADR 0063 — receive a store-bound (WP-less) PO line into the
-- store. Operator decision (AskUserQuestion 2026-06-24): the RECEIPT books the
-- inventory; the store-bound purchase's WIP posting is SUPPRESSED (no double AP).
--
--   * post_purchase_to_gl returns null for a WP-less PR (no Dr WIP / Cr AP).
--   * the enqueue trigger does NOT enqueue a purchase GL job for a WP-less PR.
--   * when a WP-less PR is received (status → delivered), an AFTER UPDATE trigger
--     creates a stock_receipt (linked via purchase_request_id) at the PR's all-in
--     cost (amount/qty) and rolls stock_on_hand — the receipt then books
--     Dr Inventory 1500 / Cr AP via the existing spec-178 B6a poster.
--   * a WP-bound purchase still posts to WIP (regression).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('d1111111-1111-1111-1111-111111111212', 'pm@r212.local', '{}'::jsonb);
update public.users set role='project_manager' where id='d1111111-1111-1111-1111-111111111212';

insert into public.projects (id, code, name) values
  ('a2120000-0000-0000-0000-000000000212', 'PRC-212', 'รับเข้าสโตร์ 212');
insert into public.work_packages (id, project_id, code, name) values
  ('c2120000-0000-0000-0000-000000000212', 'a2120000-0000-0000-0000-000000000212', 'WP212', 'งาน 212');
insert into public.catalog_items (id, category, base_item, spec_attrs, unit, is_active) values
  ('e2120000-0000-0000-0000-000000000212', 'electrical', 'ปูนซีเมนต์', null, 'ถุง', true);
insert into public.suppliers (id, name, created_by) values
  ('5e120000-0000-0000-0000-000000000212', 'ร้านวัสดุ 212', 'd1111111-1111-1111-1111-111111111212');

-- A store-bound (WP-less) PR, purchased, all-in amount 1070 for qty 10 → unit_cost 107.00.
insert into public.purchase_requests
  (id, project_id, work_package_id, catalog_item_id, item_description, quantity, unit,
   status, source, requested_by, supplier_id, amount, purchased_at)
values
  ('b2120000-0000-0000-0000-000000000212',
   'a2120000-0000-0000-0000-000000000212', null,
   'e2120000-0000-0000-0000-000000000212', 'ปูนซีเมนต์', 10, 'ถุง',
   'purchased', 'app', 'd1111111-1111-1111-1111-111111111212',
   '5e120000-0000-0000-0000-000000000212', 1070, now());

-- A WP-bound PR, purchased (regression: still posts to WIP + enqueues).
insert into public.purchase_requests
  (id, project_id, work_package_id, catalog_item_id, item_description, quantity, unit,
   status, source, requested_by, supplier_id, amount, purchased_at)
values
  ('b2130000-0000-0000-0000-000000000212',
   'a2120000-0000-0000-0000-000000000212', 'c2120000-0000-0000-0000-000000000212',
   'e2120000-0000-0000-0000-000000000212', 'ปูนซีเมนต์', 5, 'ถุง',
   'purchased', 'app', 'd1111111-1111-1111-1111-111111111212',
   '5e120000-0000-0000-0000-000000000212', 535, now());

-- ============================================================================
-- A. Enqueue suppression — a WP-less purchase enqueues NO purchase GL job.
-- ============================================================================
select is(
  (select count(*)::int from public.gl_posting_outbox
     where source_table='purchase_requests' and source_id='b2120000-0000-0000-0000-000000000212'),
  0, 'a WP-less purchase enqueues no purchase GL job (booked as inventory at receipt)');
select is(
  (select count(*)::int from public.gl_posting_outbox
     where source_table='purchase_requests' and source_id='b2130000-0000-0000-0000-000000000212'),
  1, 'a WP-bound purchase still enqueues its purchase GL job');

-- ============================================================================
-- B. Poster suppression — post_purchase_to_gl no-ops for a WP-less PR.
-- ============================================================================
select is(
  (select public.post_purchase_to_gl('b2120000-0000-0000-0000-000000000212')),
  null, 'post_purchase_to_gl returns null for a WP-less PR (no WIP posting)');
select isnt(
  (select public.post_purchase_to_gl('b2130000-0000-0000-0000-000000000212')),
  null, 'post_purchase_to_gl still posts a WP-bound purchase (regression)');

-- ============================================================================
-- C. Receive → stock-in. Driving status to 'delivered' fires the stock-in trigger.
-- ============================================================================
update public.purchase_requests
   set delivered_at = now(), status = 'delivered'
 where id = 'b2120000-0000-0000-0000-000000000212';

select is(
  (select count(*)::int from public.stock_receipts
     where purchase_request_id='b2120000-0000-0000-0000-000000000212'),
  1, 'receiving a WP-less PR creates one linked stock_receipt');
select is(
  (select qty from public.stock_receipts
     where purchase_request_id='b2120000-0000-0000-0000-000000000212'),
  10::numeric, 'the receipt carries the PR quantity');
select is(
  (select unit_cost from public.stock_receipts
     where purchase_request_id='b2120000-0000-0000-0000-000000000212'),
  107.00::numeric, 'the receipt unit_cost is the PR all-in cost (amount/qty)');
select is(
  (select qty_on_hand from public.stock_on_hand
     where project_id='a2120000-0000-0000-0000-000000000212'
       and catalog_item_id='e2120000-0000-0000-0000-000000000212'),
  10::numeric, 'stock_on_hand is rolled by the receipt');

-- ============================================================================
-- D. The link is unique (one receipt per PR) + the receipt books inventory.
-- ============================================================================
select has_index('public', 'stock_receipts', 'stock_receipts_pr_uniq',
  'a partial unique index pins one stock_receipt per purchase_request');
select isnt(
  (select public.post_stock_receipt_to_gl(
     (select id from public.stock_receipts
        where purchase_request_id='b2120000-0000-0000-0000-000000000212'))),
  null, 'the PR-sourced receipt books Dr Inventory 1500 / Cr AP (spec 178 B6a poster)');

select * from finish();
rollback;
