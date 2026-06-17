begin;
select plan(10);

-- ============================================================================
-- Spec 135 U6 / ADR 0054 — dispatch_purchase_order_delivery. A manual "the งวด is on
-- its way" action: set the delivery's purchased lines' shipped_at, and the existing
-- on_route trigger chain flips them purchased → on_route (so the PO + delivery roll up
-- to in_transit / กำลังจัดส่ง). Back-office gate (procurement plans + dispatches;
-- mirrors record_shipment — NOT site). Sections: A catalog, B guards, C dispatch.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('22222222-2222-2222-2222-222222220164', 'pm@disp.local',   '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330164', 'vi@disp.local',   '{}'::jsonb),
  ('55555555-5555-5555-5555-555555550164', 'sa@disp.local',   '{}'::jsonb);
update public.users set role = 'project_manager' where id = '22222222-2222-2222-2222-222222220164';
update public.users set role = 'site_admin'      where id = '55555555-5555-5555-5555-555555550164';
-- second user stays visitor

insert into public.projects (id, code, name) values
  ('cc000164-0000-4000-8000-000000000001', 'TAP-DISP', 'Dispatch fixture');
insert into public.work_packages (id, project_id, code, name, status) values
  ('ee000164-0000-4000-8000-000000000001',
   'cc000164-0000-4000-8000-000000000001', 'WP-DISP-1', 'Dispatch WP', 'in_progress');
insert into public.suppliers (id, name, created_by) values
  ('bb000164-0000-4000-8000-000000000001', 'ร้านจัดส่ง',
   '22222222-2222-2222-2222-222222220164');
insert into public.purchase_orders (id, supplier_id, supplier, created_by) values
  ('aa000164-0000-4000-8000-000000000001', 'bb000164-0000-4000-8000-000000000001',
   'ร้านจัดส่ง', '22222222-2222-2222-2222-222222220164');
insert into public.purchase_order_deliveries (id, purchase_order_id, created_by) values
  ('dd000164-0000-4000-8000-000000000001', 'aa000164-0000-4000-8000-000000000001',
   '22222222-2222-2222-2222-222222220164');

-- dd1 holds two purchased lines (dispatchable) + one already-delivered line (left as
-- is). Direct INSERT as postgres bypasses RLS + the derive trigger (UPDATE-only).
insert into public.purchase_requests
    (id, work_package_id, item_description, quantity, unit, status, source,
     requested_by, purchase_order_id, delivery_id, purchased_at, delivered_at)
values
  ('c1000164-0000-4000-8000-000000000001', 'ee000164-0000-4000-8000-000000000001',
   'ก', 5, 'ชิ้น', 'purchased', 'app', '22222222-2222-2222-2222-222222220164',
   'aa000164-0000-4000-8000-000000000001', 'dd000164-0000-4000-8000-000000000001', now(), null),
  ('c2000164-0000-4000-8000-000000000002', 'ee000164-0000-4000-8000-000000000001',
   'ข', 5, 'ชิ้น', 'purchased', 'app', '22222222-2222-2222-2222-222222220164',
   'aa000164-0000-4000-8000-000000000001', 'dd000164-0000-4000-8000-000000000001', now(), null),
  ('c3000164-0000-4000-8000-000000000003', 'ee000164-0000-4000-8000-000000000001',
   'ค', 5, 'ชิ้น', 'delivered', 'app', '22222222-2222-2222-2222-222222220164',
   'aa000164-0000-4000-8000-000000000001', 'dd000164-0000-4000-8000-000000000001', now(), now());

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Catalog.
-- ============================================================================
select has_function('public', 'dispatch_purchase_order_delivery',
  'the dispatch RPC exists');

-- ============================================================================
-- B. Guards (authenticated role-sim).
-- ============================================================================
set local role authenticated;

-- B.1 visitor refused (role gate).
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330164"}';
select throws_ok(
  $$ select public.dispatch_purchase_order_delivery(
       'dd000164-0000-4000-8000-000000000001') $$,
  '42501', null, 'a visitor cannot dispatch a delivery');

-- B.2 site_admin refused — dispatch is back office (procurement plans), like
--     record_shipment.
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555550164"}';
select throws_ok(
  $$ select public.dispatch_purchase_order_delivery(
       'dd000164-0000-4000-8000-000000000001') $$,
  '42501', null, 'site_admin cannot dispatch (back-office only)');

set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220164"}';

-- B.3 unknown delivery.
select throws_ok(
  $$ select public.dispatch_purchase_order_delivery(
       '00000000-0000-4000-8000-0000000000ff') $$,
  'P0001', null, 'an unknown delivery is rejected');

-- ============================================================================
-- C. Dispatch — pm marks the delivery shipped.
-- ============================================================================
select is(
  public.dispatch_purchase_order_delivery('dd000164-0000-4000-8000-000000000001'),
  2, 'dispatch marks the two purchased lines (the delivered line is skipped)');

select ok(
  (select status = 'on_route' and shipped_at is not null
   from public.purchase_requests where id = 'c1000164-0000-4000-8000-000000000001'),
  'the first purchased line is now on_route with shipped_at set');
select ok(
  (select status = 'on_route'
   from public.purchase_requests where id = 'c2000164-0000-4000-8000-000000000002'),
  'the second purchased line is now on_route');
select ok(
  (select status = 'delivered'
   from public.purchase_requests where id = 'c3000164-0000-4000-8000-000000000003'),
  'the already-delivered line is untouched');

-- The delivery now rolls up to in_transit (one on_route, none-but-one delivered →
-- partially? no: it has a delivered line + on_route → partially_received). Assert the
-- two dispatched lines drive the delivering stage at the line level (status on_route).
select is(
  (select count(*)::int from public.purchase_requests
     where delivery_id = 'dd000164-0000-4000-8000-000000000001' and status = 'on_route'),
  2, 'two of the delivery''s lines are on_route after dispatch');

-- C.2 a second dispatch is a no-op (no purchased lines remain) → returns 0.
select is(
  public.dispatch_purchase_order_delivery('dd000164-0000-4000-8000-000000000001'),
  0, 'a re-dispatch with nothing purchased returns 0 (idempotent)');

reset role;

select * from finish();
rollback;
