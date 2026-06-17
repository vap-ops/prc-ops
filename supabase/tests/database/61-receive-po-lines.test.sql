begin;
select plan(13);

-- ============================================================================
-- Spec 134 U5 / ADR 0053 — receive_po_lines: explicit PO-level receive. Marks the
-- chosen in-transit members delivered (derive trigger flips status, audit trigger
-- logs); all-or-nothing; back-office gated; in-transit-only. Sections: A catalog,
-- B guards, C happy path, D all-or-nothing.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('22222222-2222-2222-2222-222222220153', 'sa@recv.local',   '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330153', 'vi@recv.local',   '{}'::jsonb),
  ('44444444-4444-4444-4444-444444440153', 'proc@recv.local', '{}'::jsonb);
update public.users set role = 'site_admin'  where id = '22222222-2222-2222-2222-222222220153';
update public.users set role = 'procurement' where id = '44444444-4444-4444-4444-444444440153';
-- second user stays visitor

insert into public.projects (id, code, name) values
  ('cc000153-0000-4000-8000-000000000001', 'TAP-RECV', 'Receive fixture');
insert into public.work_packages (id, project_id, code, name, status) values
  ('ee000153-0000-4000-8000-000000000001',
   'cc000153-0000-4000-8000-000000000001', 'WP-RCV-1', 'Receive WP', 'in_progress');
insert into public.suppliers (id, name, created_by) values
  ('bb000153-0000-4000-8000-000000000001', 'ร้านรับของ',
   '22222222-2222-2222-2222-222222220153');
insert into public.purchase_orders (id, supplier_id, supplier, created_by) values
  ('aa000153-0000-4000-8000-000000000001', 'bb000153-0000-4000-8000-000000000001',
   'ร้านรับของ', '22222222-2222-2222-2222-222222220153');

-- m1 on_route, m2 purchased (both in-transit), m3 already delivered, m4 on_route.
insert into public.purchase_requests
    (id, work_package_id, item_description, quantity, unit, status, source, requested_by,
     purchase_order_id, purchased_at, shipped_at, delivered_at)
values
  ('c1000153-0000-4000-8000-000000000001', 'ee000153-0000-4000-8000-000000000001',
   'ก', 10, 'ชิ้น', 'on_route',  'app', '22222222-2222-2222-2222-222222220153',
   'aa000153-0000-4000-8000-000000000001', now(), now(), null),
  ('c2000153-0000-4000-8000-000000000002', 'ee000153-0000-4000-8000-000000000001',
   'ข', 10, 'ชิ้น', 'purchased', 'app', '22222222-2222-2222-2222-222222220153',
   'aa000153-0000-4000-8000-000000000001', now(), null, null),
  ('c3000153-0000-4000-8000-000000000003', 'ee000153-0000-4000-8000-000000000001',
   'ค', 10, 'ชิ้น', 'delivered', 'app', '22222222-2222-2222-2222-222222220153',
   'aa000153-0000-4000-8000-000000000001', now(), now(), now()),
  ('c4000153-0000-4000-8000-000000000004', 'ee000153-0000-4000-8000-000000000001',
   'ง', 10, 'ชิ้น', 'on_route',  'app', '22222222-2222-2222-2222-222222220153',
   'aa000153-0000-4000-8000-000000000001', now(), now(), null);

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Catalog.
-- ============================================================================
select has_function('public', 'receive_po_lines', 'the receive RPC exists');
select has_column('public', 'purchase_requests', 'delivery_batch_id',
  'spec 134 U7: delivery_batch_id column exists');

-- ============================================================================
-- B. Guards (authenticated role-sim).
-- ============================================================================
set local role authenticated;

set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330153"}';
select throws_ok(
  $$ select public.receive_po_lines(array['c1000153-0000-4000-8000-000000000001']::uuid[]) $$,
  '42501', null, 'a visitor cannot receive');

-- Spec 134 U8: the off-site purchase team (procurement) cannot mark received.
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444440153"}';
select throws_ok(
  $$ select public.receive_po_lines(array['c1000153-0000-4000-8000-000000000001']::uuid[]) $$,
  '42501', null, 'procurement (off-site) cannot mark received');

set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220153"}';
select throws_ok(
  $$ select public.receive_po_lines(array[]::uuid[]) $$,
  'P0001', null, 'an empty line list is rejected');

-- ============================================================================
-- C. Happy path — receive m1 (on_route) + m2 (purchased) together.
-- ============================================================================
select is(
  (select public.receive_po_lines(
     array['c1000153-0000-4000-8000-000000000001',
           'c2000153-0000-4000-8000-000000000002']::uuid[],
     'หัวหน้า')),
  2, 'receives two in-transit lines and returns the count');
select ok((select status = 'delivered' from public.purchase_requests
  where id = 'c1000153-0000-4000-8000-000000000001'),
  'm1 (on_route) is now delivered');
select ok((select status = 'delivered' from public.purchase_requests
  where id = 'c2000153-0000-4000-8000-000000000002'),
  'm2 (purchased) is now delivered');
select ok((select delivered_at is not null from public.purchase_requests
  where id = 'c1000153-0000-4000-8000-000000000001'),
  'm1 delivered_at is set (derive trigger fired)');
select ok((select received_by = 'หัวหน้า' from public.purchase_requests
  where id = 'c1000153-0000-4000-8000-000000000001'),
  'm1 received_by is recorded');
-- Spec 134 U7: the two lines received in one call share ONE non-null batch id.
select ok(
  (select m1.delivery_batch_id is not null and m1.delivery_batch_id = m2.delivery_batch_id
   from public.purchase_requests m1, public.purchase_requests m2
   where m1.id = 'c1000153-0000-4000-8000-000000000001'
     and m2.id = 'c2000153-0000-4000-8000-000000000002'),
  'lines received together share one delivery_batch_id');

-- ============================================================================
-- D. All-or-nothing — m4 (on_route) + m3 (already delivered) → reject, m4 untouched.
-- ============================================================================
select throws_ok(
  $$ select public.receive_po_lines(
       array['c4000153-0000-4000-8000-000000000004',
             'c3000153-0000-4000-8000-000000000003']::uuid[]) $$,
  'P0001', null, 'a non-in-transit line aborts the whole receive');
select ok((select status = 'on_route' from public.purchase_requests
  where id = 'c4000153-0000-4000-8000-000000000004'),
  'm4 stays on_route — the failed receive rolled back');

reset role;

select * from finish();
rollback;
