begin;
select plan(16);

-- ============================================================================
-- Spec 135 U3 / ADR 0054 — split_purchase_order_delivery. Procurement plans a PO's
-- deliveries (งวดส่ง): move selected IN-TRANSIT member lines into a NEW
-- purchase_order_deliveries row carrying its own eta/note/cost. Back-office gate
-- (procurement incl; site never creates — a delivery is procurement's plan, not a
-- receive action). Guards: membership, in-transit-only, no source delivery emptied,
-- non-negative cost. Sections: A catalog, B guards, C happy path, D procurement +
-- delivered line keeps a source alive.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('22222222-2222-2222-2222-222222220135', 'pm@spd.local',   '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330135', 'vi@spd.local',   '{}'::jsonb),
  ('44444444-4444-4444-4444-444444440135', 'proc@spd.local', '{}'::jsonb),
  ('55555555-5555-5555-5555-555555550135', 'sa@spd.local',   '{}'::jsonb);
update public.users set role = 'project_manager' where id = '22222222-2222-2222-2222-222222220135';
update public.users set role = 'procurement'     where id = '44444444-4444-4444-4444-444444440135';
update public.users set role = 'site_admin'      where id = '55555555-5555-5555-5555-555555550135';
-- the second user stays visitor

insert into public.projects (id, code, name) values
  ('cc000635-0000-4000-8000-000000000001', 'TAP-SPD', 'Split-delivery fixture');
insert into public.work_packages (id, project_id, code, name, status) values
  ('ee000635-0000-4000-8000-000000000001',
   'cc000635-0000-4000-8000-000000000001', 'WP-SPD-1', 'Split-delivery WP', 'in_progress');
insert into public.suppliers (id, name, created_by) values
  ('bb000635-0000-4000-8000-000000000001', 'ร้านแยกงวด',
   '22222222-2222-2222-2222-222222220135');

-- PO #1 (aa1) with its default delivery dd1; members m1/m2/m3 in-transit + m4
-- delivered (delivered counts as active, so it keeps dd1 alive). PO #2 (aa2) with
-- dd2 and p1/p2 in-transit (used for the "all in-transit selected → empties" guard).
insert into public.purchase_orders (id, supplier_id, supplier, created_by) values
  ('aa000635-0000-4000-8000-000000000001', 'bb000635-0000-4000-8000-000000000001',
   'ร้านแยกงวด', '22222222-2222-2222-2222-222222220135'),
  ('aa000635-0000-4000-8000-000000000002', 'bb000635-0000-4000-8000-000000000001',
   'ร้านแยกงวด', '22222222-2222-2222-2222-222222220135');
insert into public.purchase_order_deliveries (id, purchase_order_id, created_by) values
  ('dd000635-0000-4000-8000-000000000001', 'aa000635-0000-4000-8000-000000000001',
   '22222222-2222-2222-2222-222222220135'),
  ('dd000635-0000-4000-8000-000000000002', 'aa000635-0000-4000-8000-000000000002',
   '22222222-2222-2222-2222-222222220135');

-- Direct INSERT as postgres bypasses RLS + the derive trigger (UPDATE-only).
insert into public.purchase_requests
    (id, work_package_id, item_description, quantity, unit, status, source,
     requested_by, purchase_order_id, delivery_id, purchased_at, shipped_at, delivered_at)
values
  ('c1000635-0000-4000-8000-000000000001', 'ee000635-0000-4000-8000-000000000001',
   'ม1', 10, 'ชิ้น', 'on_route',  'app', '22222222-2222-2222-2222-222222220135',
   'aa000635-0000-4000-8000-000000000001', 'dd000635-0000-4000-8000-000000000001', now(), now(), null),
  ('c2000635-0000-4000-8000-000000000002', 'ee000635-0000-4000-8000-000000000001',
   'ม2', 10, 'ชิ้น', 'purchased', 'app', '22222222-2222-2222-2222-222222220135',
   'aa000635-0000-4000-8000-000000000001', 'dd000635-0000-4000-8000-000000000001', now(), null, null),
  ('c3000635-0000-4000-8000-000000000003', 'ee000635-0000-4000-8000-000000000001',
   'ม3', 10, 'ชิ้น', 'on_route',  'app', '22222222-2222-2222-2222-222222220135',
   'aa000635-0000-4000-8000-000000000001', 'dd000635-0000-4000-8000-000000000001', now(), now(), null),
  ('c4000635-0000-4000-8000-000000000004', 'ee000635-0000-4000-8000-000000000001',
   'ม4', 10, 'ชิ้น', 'delivered', 'app', '22222222-2222-2222-2222-222222220135',
   'aa000635-0000-4000-8000-000000000001', 'dd000635-0000-4000-8000-000000000001', now(), now(), now()),
  ('c5000635-0000-4000-8000-000000000005', 'ee000635-0000-4000-8000-000000000001',
   'ป1', 10, 'ชิ้น', 'purchased', 'app', '22222222-2222-2222-2222-222222220135',
   'aa000635-0000-4000-8000-000000000002', 'dd000635-0000-4000-8000-000000000002', now(), null, null),
  ('c6000635-0000-4000-8000-000000000006', 'ee000635-0000-4000-8000-000000000001',
   'ป2', 10, 'ชิ้น', 'purchased', 'app', '22222222-2222-2222-2222-222222220135',
   'aa000635-0000-4000-8000-000000000002', 'dd000635-0000-4000-8000-000000000002', now(), null, null);

-- An approved one-off (no PO) for the non-member guard.
insert into public.purchase_requests
    (id, work_package_id, item_description, quantity, unit, status, source, requested_by)
values
  ('c0000635-0000-4000-8000-000000000000', 'ee000635-0000-4000-8000-000000000001',
   'นอกออเดอร์', 5, 'ชิ้น', 'approved', 'app', '22222222-2222-2222-2222-222222220135');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Catalog.
-- ============================================================================
select has_function('public', 'split_purchase_order_delivery',
  'the split-delivery RPC exists');

-- ============================================================================
-- B. Guards (authenticated role-sim).
-- ============================================================================
set local role authenticated;

-- B.1 visitor refused (role gate).
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330135"}';
select throws_ok(
  $$ select public.split_purchase_order_delivery(
       'aa000635-0000-4000-8000-000000000001',
       array['c1000635-0000-4000-8000-000000000001']::uuid[]) $$,
  '42501', null, 'a visitor cannot create a delivery');

-- B.2 site_admin refused — a delivery is procurement's plan, not a site action.
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555550135"}';
select throws_ok(
  $$ select public.split_purchase_order_delivery(
       'aa000635-0000-4000-8000-000000000001',
       array['c1000635-0000-4000-8000-000000000001']::uuid[]) $$,
  '42501', null, 'site_admin cannot create a delivery (back-office only)');

set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220135"}';

-- B.3 empty selection.
select throws_ok(
  $$ select public.split_purchase_order_delivery(
       'aa000635-0000-4000-8000-000000000001', array[]::uuid[]) $$,
  'P0001', null, 'an empty line selection is rejected');

-- B.4 a line that is not a member of the PO (an approved one-off).
select throws_ok(
  $$ select public.split_purchase_order_delivery(
       'aa000635-0000-4000-8000-000000000001',
       array['c0000635-0000-4000-8000-000000000000']::uuid[]) $$,
  'P0001', null, 'a non-member line is rejected');

-- B.5 a delivered line cannot be moved (its delivery already received it).
select throws_ok(
  $$ select public.split_purchase_order_delivery(
       'aa000635-0000-4000-8000-000000000001',
       array['c4000635-0000-4000-8000-000000000004']::uuid[]) $$,
  'P0001', null, 'a delivered line cannot be re-assigned');

-- B.6 selecting EVERY in-transit line of a single-delivery PO empties it.
select throws_ok(
  $$ select public.split_purchase_order_delivery(
       'aa000635-0000-4000-8000-000000000002',
       array['c5000635-0000-4000-8000-000000000005',
             'c6000635-0000-4000-8000-000000000006']::uuid[]) $$,
  'P0001', null, 'a split that empties a source delivery is rejected');

-- B.7 negative cost.
select throws_ok(
  $$ select public.split_purchase_order_delivery(
       'aa000635-0000-4000-8000-000000000001',
       array['c1000635-0000-4000-8000-000000000001']::uuid[], null, null, -5) $$,
  'P0001', null, 'a negative cost is rejected');

-- ============================================================================
-- C. Happy path — pm moves m1 + m2 into a new delivery (eta + note + cost).
-- ============================================================================
select lives_ok(
  $$ select public.split_purchase_order_delivery(
       'aa000635-0000-4000-8000-000000000001',
       array['c1000635-0000-4000-8000-000000000001',
             'c2000635-0000-4000-8000-000000000002']::uuid[],
       '2026-08-01'::date, 'งวดสอง', 150) $$,
  'pm creates a new delivery from selected in-transit lines');

select ok(
  (select d.cost = 150 and d.note = 'งวดสอง' and d.eta = '2026-08-01'::date
            and d.created_by = '22222222-2222-2222-2222-222222220135'
   from public.purchase_order_deliveries d
   where d.purchase_order_id = 'aa000635-0000-4000-8000-000000000001'
     and d.note = 'งวดสอง'),
  'the new delivery carries its eta/note/cost/created_by');

select ok(
  (select pr1.delivery_id = pr2.delivery_id
            and pr1.delivery_id <> 'dd000635-0000-4000-8000-000000000001'
   from public.purchase_requests pr1, public.purchase_requests pr2
   where pr1.id = 'c1000635-0000-4000-8000-000000000001'
     and pr2.id = 'c2000635-0000-4000-8000-000000000002'),
  'm1 and m2 share the new delivery (off the default)');

select ok(
  (select delivery_id = 'dd000635-0000-4000-8000-000000000001'
   from public.purchase_requests where id = 'c3000635-0000-4000-8000-000000000003'),
  'm3 stays in the original (default) delivery');

select ok(
  (select d.purchase_order_id = 'aa000635-0000-4000-8000-000000000001'
   from public.purchase_order_deliveries d
   where d.id = (select delivery_id from public.purchase_requests
                  where id = 'c1000635-0000-4000-8000-000000000001')),
  'the new delivery belongs to the PO');

select ok(
  (select count(*) >= 1 from public.audit_log
     where action = 'update' and target_table = 'purchase_order_deliveries'
       and payload -> 'transition' ? 'delivery_split'),
  'a delivery-split audit row was written');

-- ============================================================================
-- D. procurement allowed + a delivered line keeps the source delivery alive.
--    dd1 now holds m3 (in-transit) + m4 (delivered). Moving m3 leaves m4 → ok.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444440135"}';
select lives_ok(
  $$ select public.split_purchase_order_delivery(
       'aa000635-0000-4000-8000-000000000001',
       array['c3000635-0000-4000-8000-000000000003']::uuid[]) $$,
  'procurement can split, and a delivered line keeps the source delivery alive');

select ok(
  (select delivery_id = 'dd000635-0000-4000-8000-000000000001'
   from public.purchase_requests where id = 'c4000635-0000-4000-8000-000000000004'),
  'the delivered line (m4) is untouched in the original delivery');

reset role;

select * from finish();
rollback;
