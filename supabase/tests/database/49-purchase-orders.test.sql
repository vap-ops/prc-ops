begin;
select plan(50);

-- ============================================================================
-- Spec 115 / ADR 0044 — purchase_orders table + create_purchase_order RPC.
-- Pins: catalog/columns/notes-CHECK/RLS (back-office SELECT, NO authenticated
-- INSERT/UPDATE) + the member FK; the RPC signature (SECURITY DEFINER) +
-- behaviour (bundles approved lines → purchased, priced, stamped, snapshotted;
-- sums; PO-create + per-line purchase audit rows; refuses a non-approved line
-- all-or-nothing; role-gated; empty-lines + supplier guards).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110115', 'pm@po.local',     '{}'::jsonb),
  ('44444444-4444-4444-4444-444444440115', 'proc@po.local',   '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220115', 'sa@po.local',     '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330115', 'vi@po.local',     '{}'::jsonb);
update public.users set role = 'project_manager' where id = '11111111-1111-1111-1111-111111110115';
update public.users set role = 'procurement'     where id = '44444444-4444-4444-4444-444444440115';
update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-222222220115';
-- fourth user stays visitor

insert into public.projects (id, code, name) values
  ('cc000115-0000-4000-8000-000000000001', 'TAP-PO', 'PO fixture');
insert into public.work_packages (id, project_id, code, name, status) values
  ('ee000115-0000-4000-8000-000000000001',
   'cc000115-0000-4000-8000-000000000001', 'WP-PO-1', 'PO WP', 'in_progress');

insert into public.suppliers (id, name, created_by) values
  ('bb000115-0000-4000-8000-000000000001', 'ร้านวัสดุ ทดสอบ',
   '11111111-1111-1111-1111-111111110115');

-- Member tickets. pr1/pr2 approved (bundled happy path); pr3 requested
-- (non-approved, refusal); pr4 approved (paired with pr3 to prove atomicity).
insert into public.purchase_requests
    (id, work_package_id, item_description, quantity, unit, status,
     source, requested_by) values
  ('fa000115-0000-4000-8000-000000000001',
   'ee000115-0000-4000-8000-000000000001', 'ปูนซีเมนต์', 10, 'ถุง', 'approved',
   'app', '11111111-1111-1111-1111-111111110115'),
  ('fa000115-0000-4000-8000-000000000002',
   'ee000115-0000-4000-8000-000000000001', 'เหล็กเส้น', 5, 'เส้น', 'approved',
   'app', '11111111-1111-1111-1111-111111110115'),
  ('fa000115-0000-4000-8000-000000000003',
   'ee000115-0000-4000-8000-000000000001', 'ทราย', 3, 'คิว', 'requested',
   'app', '11111111-1111-1111-1111-111111110115'),
  ('fa000115-0000-4000-8000-000000000004',
   'ee000115-0000-4000-8000-000000000001', 'อิฐ', 100, 'ก้อน', 'approved',
   'app', '11111111-1111-1111-1111-111111110115');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Catalog + columns + notes CHECK + RLS posture + member FK.
-- ============================================================================
select has_table('public', 'purchase_orders', 'purchase_orders exists');
select col_is_pk('public', 'purchase_orders', 'id', 'id is the PK');
select col_type_is('public', 'purchase_orders', 'po_number', 'bigint',
  'po_number is bigint');
select col_not_null('public', 'purchase_orders', 'po_number', 'po_number NOT NULL');
select col_not_null('public', 'purchase_orders', 'supplier_id', 'supplier_id NOT NULL');
select col_not_null('public', 'purchase_orders', 'supplier', 'supplier snapshot NOT NULL');
select col_not_null('public', 'purchase_orders', 'created_by', 'created_by NOT NULL');
select has_column('public', 'purchase_orders', 'eta', 'eta column exists');
select has_column('public', 'purchase_orders', 'ordered_at', 'ordered_at column exists');
select has_column('public', 'purchase_orders', 'notes', 'notes column exists');
-- Spec 119: VAT rate lives on the member ticket (amount = gross; rate derives net/VAT).
select has_column('public', 'purchase_requests', 'vat_rate', 'spec 119: purchase_requests.vat_rate exists');
select has_column('public', 'purchase_orders', 'created_at', 'created_at column exists');
select has_column('public', 'purchase_orders', 'updated_at', 'updated_at column exists');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.purchase_orders'::regclass),
  'RLS enabled on purchase_orders');

-- No money column: a direct over-length notes insert is rejected by the CHECK.
select throws_ok(
  $$ insert into public.purchase_orders (supplier_id, supplier, created_by, notes)
     values ('bb000115-0000-4000-8000-000000000001', 'X',
             '11111111-1111-1111-1111-111111110115', repeat('x', 2001)) $$,
  '23514', null, 'notes CHECK rejects > 2000 chars');

select fk_ok('public', 'purchase_requests', 'purchase_order_id',
             'public', 'purchase_orders', 'id',
  'purchase_requests.purchase_order_id → purchase_orders.id');

-- SELECT-only RLS: exactly one policy and it is not a write policy (ADR 0038).
select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'purchase_orders'),
  1::bigint, 'purchase_orders has exactly one policy');
select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'purchase_orders'
      and cmd <> 'SELECT'),
  0::bigint, 'purchase_orders has NO INSERT/UPDATE/DELETE policy');

select ok(has_table_privilege('authenticated', 'public.purchase_orders', 'SELECT'),
  'authenticated may SELECT purchase_orders');
select ok(not has_table_privilege('authenticated', 'public.purchase_orders', 'INSERT'),
  'authenticated may NOT INSERT purchase_orders (RPC-only writer)');
select ok(not has_table_privilege('authenticated', 'public.purchase_orders', 'UPDATE'),
  'authenticated may NOT UPDATE purchase_orders (RPC-only writer)');

-- ============================================================================
-- B. create_purchase_order signature.
-- ============================================================================
select has_function('public', 'create_purchase_order',
  'create_purchase_order RPC exists');
select is(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_purchase_order'
      and p.prosecdef
      and array_to_string(p.proconfig, ',') like '%search_path=public%'),
  1, 'create_purchase_order is SECURITY DEFINER with pinned search_path');
select is(
  (select pg_get_function_result(p.oid) from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'create_purchase_order'),
  'uuid', 'create_purchase_order returns uuid');
select ok(
  not has_function_privilege('anon',
    'public.create_purchase_order(uuid,date,jsonb,numeric)', 'execute'),
  'anon cannot execute create_purchase_order');
select ok(
  has_function_privilege('authenticated',
    'public.create_purchase_order(uuid,date,jsonb,numeric)', 'execute'),
  'authenticated may execute create_purchase_order');

-- ============================================================================
-- C. Role gate: back office only (site_admin + visitor refused, 42501).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220115"}';
select throws_ok(
  $$ select public.create_purchase_order(
       'bb000115-0000-4000-8000-000000000001'::uuid, date '2026-07-15',
       '[{"request_id":"fa000115-0000-4000-8000-000000000001","amount":1}]'::jsonb) $$,
  '42501', null, 'create_purchase_order refuses site_admin');

set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330115"}';
select throws_ok(
  $$ select public.create_purchase_order(
       'bb000115-0000-4000-8000-000000000001'::uuid, date '2026-07-15',
       '[{"request_id":"fa000115-0000-4000-8000-000000000001","amount":1}]'::jsonb) $$,
  '42501', null, 'create_purchase_order refuses visitor');

-- ============================================================================
-- D. Happy path (project_manager): bundle pr1 + pr2 into one PO.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110115"}';
select lives_ok(
  $$ select public.create_purchase_order(
       'bb000115-0000-4000-8000-000000000001'::uuid, date '2026-07-15',
       '[{"request_id":"fa000115-0000-4000-8000-000000000001","amount":100},
         {"request_id":"fa000115-0000-4000-8000-000000000002","amount":200}]'::jsonb, 7) $$,
  'project_manager bundles two approved tickets into a PO (VAT 7%)');

reset role;

select is(
  (select status::text from public.purchase_requests
    where id = 'fa000115-0000-4000-8000-000000000001'),
  'purchased', 'pr1 → purchased');
select is(
  (select amount from public.purchase_requests
    where id = 'fa000115-0000-4000-8000-000000000001'),
  100::numeric, 'pr1 priced at its line amount (100, gross)');
select is(
  (select vat_rate from public.purchase_requests
    where id = 'fa000115-0000-4000-8000-000000000001'),
  7::numeric, 'pr1 carries the PO VAT rate (7)');
select is(
  (select supplier from public.purchase_requests
    where id = 'fa000115-0000-4000-8000-000000000001'),
  'ร้านวัสดุ ทดสอบ', 'pr1 carries the supplier snapshot');
select ok(
  (select purchased_at is not null from public.purchase_requests
    where id = 'fa000115-0000-4000-8000-000000000001'),
  'pr1 stamped purchased_at');
select is(
  (select eta from public.purchase_requests
    where id = 'fa000115-0000-4000-8000-000000000001'),
  date '2026-07-15', 'pr1 stamped the PO eta');
select is(
  (select amount from public.purchase_requests
    where id = 'fa000115-0000-4000-8000-000000000002'),
  200::numeric, 'pr2 priced at its line amount (200)');
select is(
  (select purchase_order_id from public.purchase_requests
    where id = 'fa000115-0000-4000-8000-000000000001'),
  (select purchase_order_id from public.purchase_requests
    where id = 'fa000115-0000-4000-8000-000000000002'),
  'pr1 and pr2 belong to the same PO');

select is(
  (select supplier from public.purchase_orders
    where id = (select purchase_order_id from public.purchase_requests
                  where id = 'fa000115-0000-4000-8000-000000000001')),
  'ร้านวัสดุ ทดสอบ', 'PO carries the supplier snapshot');
select is(
  (select created_by from public.purchase_orders
    where id = (select purchase_order_id from public.purchase_requests
                  where id = 'fa000115-0000-4000-8000-000000000001')),
  '11111111-1111-1111-1111-111111110115'::uuid, 'PO created_by = the PM actor');
select ok(
  (select ordered_at is not null from public.purchase_orders
    where id = (select purchase_order_id from public.purchase_requests
                  where id = 'fa000115-0000-4000-8000-000000000001')),
  'PO ordered_at stamped');
select is(
  (select eta from public.purchase_orders
    where id = (select purchase_order_id from public.purchase_requests
                  where id = 'fa000115-0000-4000-8000-000000000001')),
  date '2026-07-15', 'PO eta = the passed eta');

-- PO total is the SUM of member amounts (computed, not stored).
select is(
  (select sum(amount) from public.purchase_requests
    where purchase_order_id = (select purchase_order_id from public.purchase_requests
                                 where id = 'fa000115-0000-4000-8000-000000000001')),
  300::numeric, 'PO total = sum of member amounts (100 + 200)');

-- Audit: one PO-create row + one purchase_request_purchase row per line.
select is(
  (select count(*) from public.audit_log
    where action = 'purchase_order_create'
      and target_id = (select purchase_order_id from public.purchase_requests
                         where id = 'fa000115-0000-4000-8000-000000000001')),
  1::bigint, 'exactly one purchase_order_create audit row');
select is(
  (select count(*) from public.audit_log
    where action = 'purchase_request_purchase'
      and target_id in ('fa000115-0000-4000-8000-000000000001',
                        'fa000115-0000-4000-8000-000000000002')),
  2::bigint, 'one purchase_request_purchase audit row per bundled line');

-- ============================================================================
-- E. Refuses a non-approved line, all-or-nothing (pr4 approved + pr3 requested).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110115"}';
select throws_ok(
  $$ select public.create_purchase_order(
       'bb000115-0000-4000-8000-000000000001'::uuid, date '2026-07-15',
       '[{"request_id":"fa000115-0000-4000-8000-000000000004","amount":50},
         {"request_id":"fa000115-0000-4000-8000-000000000003","amount":50}]'::jsonb) $$,
  'P0001', null, 'refuses a bundle containing a non-approved line');

-- Empty-lines + supplier guards (still PM session).
select throws_ok(
  $$ select public.create_purchase_order(
       'bb000115-0000-4000-8000-000000000001'::uuid, date '2026-07-15',
       '[]'::jsonb) $$,
  'P0001', null, 'refuses an empty line set');
select throws_ok(
  $$ select public.create_purchase_order(
       'bb000115-0000-4000-8000-000000000999'::uuid, date '2026-07-15',
       '[{"request_id":"fa000115-0000-4000-8000-000000000004","amount":50}]'::jsonb) $$,
  'P0001', null, 'refuses an unknown supplier');

reset role;

-- Atomicity: the failed bundle left pr4 untouched (still approved, no PO).
select is(
  (select status::text from public.purchase_requests
    where id = 'fa000115-0000-4000-8000-000000000004'),
  'approved', 'pr4 still approved after the failed bundle (rolled back)');
select is(
  (select status::text from public.purchase_requests
    where id = 'fa000115-0000-4000-8000-000000000003'),
  'requested', 'pr3 still requested');
select ok(
  (select purchase_order_id is null from public.purchase_requests
    where id = 'fa000115-0000-4000-8000-000000000004'),
  'pr4 has no purchase_order_id (atomic rollback)');

select * from finish();
rollback;
