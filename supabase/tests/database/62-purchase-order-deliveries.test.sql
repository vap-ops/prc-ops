begin;
select plan(14);

-- ============================================================================
-- Spec 135 U1 / ADR 0054 — purchase_order_deliveries + purchase_requests.delivery_id.
-- The data layer: a PO ships in deliveries; create_purchase_order auto-creates the
-- default delivery (= whole PO) and assigns its lines; existing POs are backfilled
-- (no PO-member line left without a delivery). Sections: A catalog/RLS,
-- B auto-create, C backfill invariant (real prod data, post-apply).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110135', 'pm@deliv.local', '{}'::jsonb);
update public.users set role = 'project_manager' where id = '11111111-1111-1111-1111-111111110135';

insert into public.projects (id, code, name) values
  ('cc000135-0000-4000-8000-000000000001', 'TAP-DLV', 'Deliveries fixture');
insert into public.work_packages (id, project_id, code, name, status) values
  ('ee000135-0000-4000-8000-000000000001',
   'cc000135-0000-4000-8000-000000000001', 'WP-DLV-1', 'Deliveries WP', 'in_progress');
insert into public.suppliers (id, name, created_by) values
  ('bb000135-0000-4000-8000-000000000001', 'ร้านส่งของ',
   '11111111-1111-1111-1111-111111110135');
insert into public.purchase_requests
    (id, work_package_id, item_description, quantity, unit, status, source, requested_by)
values
  ('fa000135-0000-4000-8000-000000000001', 'ee000135-0000-4000-8000-000000000001',
   'ก', 10, 'ชิ้น', 'approved', 'app', '11111111-1111-1111-1111-111111110135'),
  ('fa000135-0000-4000-8000-000000000002', 'ee000135-0000-4000-8000-000000000001',
   'ข', 5, 'ชิ้น', 'approved', 'app', '11111111-1111-1111-1111-111111110135');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Catalog + RLS.
-- ============================================================================
select has_table('public', 'purchase_order_deliveries', 'deliveries table exists');
select col_not_null('public', 'purchase_order_deliveries', 'purchase_order_id', 'po_id NOT NULL');
select col_not_null('public', 'purchase_order_deliveries', 'created_by', 'created_by NOT NULL');
select has_column('public', 'purchase_order_deliveries', 'eta', 'eta column exists');
select has_column('public', 'purchase_order_deliveries', 'cost', 'cost column exists');
select has_column('public', 'purchase_order_deliveries', 'carrier', 'carrier column exists');
select has_column('public', 'purchase_requests', 'delivery_id', 'delivery_id FK column exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.purchase_order_deliveries'::regclass),
  'RLS enabled on purchase_order_deliveries');
select is(
  (select count(*)::int from pg_policies
     where schemaname = 'public' and tablename = 'purchase_order_deliveries'
       and policyname = 'purchase_order_deliveries readable by back office' and cmd = 'SELECT'),
  1, 'back-office SELECT policy exists');

-- ============================================================================
-- B. create_purchase_order auto-creates the default delivery + assigns lines.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110135"}';

select lives_ok(
  $$ select public.create_purchase_order(
       'bb000135-0000-4000-8000-000000000001'::uuid, '2026-07-01'::date,
       jsonb_build_array(
         jsonb_build_object('request_id', 'fa000135-0000-4000-8000-000000000001'),
         jsonb_build_object('request_id', 'fa000135-0000-4000-8000-000000000002')),
       0, null) $$,
  'create_purchase_order succeeds');

select ok(
  (select pr1.delivery_id is not null and pr1.delivery_id = pr2.delivery_id
   from public.purchase_requests pr1, public.purchase_requests pr2
   where pr1.id = 'fa000135-0000-4000-8000-000000000001'
     and pr2.id = 'fa000135-0000-4000-8000-000000000002'),
  'both lines share the one auto-created default delivery');

select ok(
  (select d.purchase_order_id = pr.purchase_order_id
   from public.purchase_requests pr
   join public.purchase_order_deliveries d on d.id = pr.delivery_id
   where pr.id = 'fa000135-0000-4000-8000-000000000001'),
  'the default delivery belongs to the line PO');

select ok(
  (select status = 'purchased' from public.purchase_requests
   where id = 'fa000135-0000-4000-8000-000000000001'),
  'the line is purchased');

reset role;

-- ============================================================================
-- C. Backfill invariant — every PO-member line has a delivery (real prod data).
-- ============================================================================
select is(
  (select count(*)::int from public.purchase_requests
     where purchase_order_id is not null and delivery_id is null),
  0, 'no PO-member line is left without a delivery (backfill + auto-create)');

select * from finish();
rollback;
