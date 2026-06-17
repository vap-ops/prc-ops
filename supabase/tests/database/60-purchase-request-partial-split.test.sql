begin;
select plan(25);

-- ============================================================================
-- Spec 134 U3 / ADR 0052 — split_purchase_request_on_receipt + the
-- split_from_request_id lineage column. A strictly-partial receipt splits an
-- in-transit PO member into a DELIVERED original (reduced) + a REMAINING child
-- (on_route, same PO); amounts split proportional-by-qty (default) or
-- buyer-entered, family sum = original exactly. Sections: A catalog, B guards
-- (role / qty / amount / non-member), C proportional happy path, D buyer-entered.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('22222222-2222-2222-2222-222222220134', 'sa@split.local', '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330134', 'vi@split.local', '{}'::jsonb);
update public.users set role = 'site_admin' where id = '22222222-2222-2222-2222-222222220134';
-- second user stays visitor

insert into public.projects (id, code, name) values
  ('cc000134-0000-4000-8000-000000000001', 'TAP-SPLIT', 'Split fixture');
insert into public.work_packages (id, project_id, code, name, status) values
  ('ee000134-0000-4000-8000-000000000001',
   'cc000134-0000-4000-8000-000000000001', 'WP-SPL-1', 'Split WP', 'in_progress');
insert into public.suppliers (id, name, created_by) values
  ('bb000134-0000-4000-8000-000000000001', 'ร้านแยกส่ง',
   '22222222-2222-2222-2222-222222220134');
insert into public.purchase_orders (id, supplier_id, supplier, created_by) values
  ('aa000134-0000-4000-8000-000000000001', 'bb000134-0000-4000-8000-000000000001',
   'ร้านแยกส่ง', '22222222-2222-2222-2222-222222220134');

-- In-transit PO members (direct INSERT as postgres bypasses RLS + the derive
-- trigger, which is UPDATE-only). m1 on_route priced 1000/100; m2 purchased
-- priced 1000/100; m3 approved one-off (no PO) for the non-member guard.
insert into public.purchase_requests
    (id, work_package_id, item_description, quantity, unit, status, source,
     requested_by, supplier, supplier_id, amount, purchase_order_id, purchased_at, shipped_at)
values
  ('c1000134-0000-4000-8000-000000000001', 'ee000134-0000-4000-8000-000000000001',
   'เหล็กเส้น', 100, 'เส้น', 'on_route', 'app', '22222222-2222-2222-2222-222222220134',
   'ร้านแยกส่ง', 'bb000134-0000-4000-8000-000000000001', 1000,
   'aa000134-0000-4000-8000-000000000001', now(), now()),
  ('c2000134-0000-4000-8000-000000000002', 'ee000134-0000-4000-8000-000000000001',
   'ปูน', 100, 'ถุง', 'purchased', 'app', '22222222-2222-2222-2222-222222220134',
   'ร้านแยกส่ง', 'bb000134-0000-4000-8000-000000000001', 1000,
   'aa000134-0000-4000-8000-000000000001', now(), null);
insert into public.purchase_requests
    (id, work_package_id, item_description, quantity, unit, status, source, requested_by)
values
  ('c3000134-0000-4000-8000-000000000003', 'ee000134-0000-4000-8000-000000000001',
   'ทราย', 5, 'คิว', 'approved', 'app', '22222222-2222-2222-2222-222222220134');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Catalog.
-- ============================================================================
select has_column('public', 'purchase_requests', 'split_from_request_id',
  'split_from_request_id lineage column exists');
select has_function('public', 'split_purchase_request_on_receipt',
  'the split RPC exists');

-- ============================================================================
-- B. Guards (authenticated role-sim).
-- ============================================================================
set local role authenticated;

-- B.1 visitor refused (role gate).
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330134"}';
select throws_ok(
  $$ select public.split_purchase_request_on_receipt(
       'c1000134-0000-4000-8000-000000000001', 30) $$,
  '42501', null, 'a visitor cannot split a ticket');

set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220134"}';

-- B.2 qty = 0 (not > 0).
select throws_ok(
  $$ select public.split_purchase_request_on_receipt(
       'c1000134-0000-4000-8000-000000000001', 0) $$,
  'P0001', null, 'received qty 0 is rejected');
-- B.3 qty = ordered (full delivery, not a split).
select throws_ok(
  $$ select public.split_purchase_request_on_receipt(
       'c1000134-0000-4000-8000-000000000001', 100) $$,
  'P0001', null, 'received qty = ordered is rejected (full delivery path)');
-- B.4 qty > ordered.
select throws_ok(
  $$ select public.split_purchase_request_on_receipt(
       'c1000134-0000-4000-8000-000000000001', 150) $$,
  'P0001', null, 'received qty > ordered is rejected');
-- B.5 delivered amount out of range.
select throws_ok(
  $$ select public.split_purchase_request_on_receipt(
       'c1000134-0000-4000-8000-000000000001', 30, null, null, 2000) $$,
  'P0001', null, 'delivered amount > original is rejected');
-- B.6 not an in-transit PO member (approved one-off).
select throws_ok(
  $$ select public.split_purchase_request_on_receipt(
       'c3000134-0000-4000-8000-000000000003', 2) $$,
  'P0001', null, 'an approved one-off (no PO) cannot be split');

-- ============================================================================
-- C. Proportional happy path — split m1 (1000/100, on_route) receiving 30.
-- ============================================================================
select lives_ok(
  $$ select public.split_purchase_request_on_receipt(
       'c1000134-0000-4000-8000-000000000001', 30, 'หัวหน้าช่าง', 'มาแค่ครึ่ง') $$,
  'a strictly-partial receipt splits the ticket');

select ok((select status = 'delivered' from public.purchase_requests
  where id = 'c1000134-0000-4000-8000-000000000001'),
  'the original becomes the delivered portion (derive trigger)');
select ok((select quantity = 30 from public.purchase_requests
  where id = 'c1000134-0000-4000-8000-000000000001'),
  'the original quantity is reduced to the received amount');
select ok((select amount = 300 from public.purchase_requests
  where id = 'c1000134-0000-4000-8000-000000000001'),
  'the original amount is the proportional delivered share (1000*30/100)');
select ok((select delivered_at is not null and received_by = 'หัวหน้าช่าง'
  from public.purchase_requests where id = 'c1000134-0000-4000-8000-000000000001'),
  'the delivery facts are set on the original');

select is(
  (select count(*)::int from public.purchase_requests
     where split_from_request_id = 'c1000134-0000-4000-8000-000000000001'),
  1, 'exactly one remaining child was created');
select ok((select status = 'on_route' from public.purchase_requests
  where split_from_request_id = 'c1000134-0000-4000-8000-000000000001'),
  'the child carries the remainder as on_route');
select ok((select quantity = 70 from public.purchase_requests
  where split_from_request_id = 'c1000134-0000-4000-8000-000000000001'),
  'the child quantity is ordered − received');
select ok((select amount = 700 from public.purchase_requests
  where split_from_request_id = 'c1000134-0000-4000-8000-000000000001'),
  'the child amount is the remainder (family sum = original)');
select ok((select purchase_order_id = 'aa000134-0000-4000-8000-000000000001'
  from public.purchase_requests
  where split_from_request_id = 'c1000134-0000-4000-8000-000000000001'),
  'the child belongs to the same PO');
select ok((select pr_number is not null from public.purchase_requests
  where split_from_request_id = 'c1000134-0000-4000-8000-000000000001'),
  'the child got its own pr_number (sequence default)');

select ok(
  (select count(*) >= 1 from public.audit_log
     where target_id = 'c1000134-0000-4000-8000-000000000001'
       and action = 'update' and payload ? 'split_child_id'),
  'a split audit row was written');
-- Spec 134 U7: the delivered portion is stamped with its own delivery batch.
select ok((select delivery_batch_id is not null from public.purchase_requests
  where id = 'c1000134-0000-4000-8000-000000000001'),
  'the delivered portion gets a delivery_batch_id');

-- ============================================================================
-- D. Buyer-entered amount — split m2 (1000/100, purchased) receiving 40 @ 250.
-- ============================================================================
select lives_ok(
  $$ select public.split_purchase_request_on_receipt(
       'c2000134-0000-4000-8000-000000000002', 40, null, null, 250) $$,
  'a buyer-entered delivered amount is accepted');
select ok((select amount = 250 from public.purchase_requests
  where id = 'c2000134-0000-4000-8000-000000000002'),
  'the original amount is the buyer-entered value');
select ok((select amount = 750 from public.purchase_requests
  where split_from_request_id = 'c2000134-0000-4000-8000-000000000002'),
  'the child amount is original − entered');
select ok((select quantity = 60 from public.purchase_requests
  where split_from_request_id = 'c2000134-0000-4000-8000-000000000002'),
  'the child quantity is ordered − received');

reset role;

select * from finish();
rollback;
