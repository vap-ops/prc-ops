begin;
select plan(34);

-- ============================================================================
-- Spec 33 / ADR 0038 — suppliers master + in-app purchase/shipment RPCs.
-- The RPCs write facts only; status flips, audit rows, and notification
-- outbox rows must come from the EXISTING trigger chain (derive + fact
-- audit + spec-32 capture) — asserted end-to-end here.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('22222222-2222-2222-2222-2222222255aa', 'sa@sup-test.local',      '{}'::jsonb),
  ('33333333-3333-3333-3333-3333333355aa', 'pm@sup-test.local',      '{}'::jsonb),
  ('44444444-4444-4444-4444-4444444455aa', 'visitor@sup-test.local', '{}'::jsonb);

update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-2222222255aa';
update public.users set role = 'project_manager' where id = '33333333-3333-3333-3333-3333333355aa';
-- 4444…55aa keeps default 'visitor'.

insert into public.projects (id, code, name) values
  ('cccccccc-cccc-cccc-cccc-cccccccc55aa', 'PRC-TEST-SUP', 'Suppliers fixture project');
insert into public.work_packages (id, project_id, code, name) values
  ('eeeeeeee-eeee-eeee-eeee-eeeeeeee55aa',
   'cccccccc-cccc-cccc-cccc-cccccccc55aa', 'WP-SUP-1', 'Suppliers fixture WP');

-- q1: approved (the happy-path fixture). q2: requested (stage guard).
insert into public.purchase_requests
  (id, work_package_id, item_description, quantity, unit, requested_by, status,
   approved_by, decided_at)
values
  ('a1000000-0000-4000-8000-0000000055aa',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeee55aa',
   'Cement', 10, 'bag', '22222222-2222-2222-2222-2222222255aa', 'approved',
   '33333333-3333-3333-3333-3333333355aa', now()),
  ('a2000000-0000-4000-8000-0000000055aa',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeee55aa',
   'Sand', 2, 'truck', '22222222-2222-2222-2222-2222222255aa', 'requested',
   null, null),
  ('a3000000-0000-4000-8000-0000000055aa',
   'eeeeeeee-eeee-eeee-eeee-eeeeeeee55aa',
   'Steel', 5, 'ton', '22222222-2222-2222-2222-2222222255aa', 'approved',
   '33333333-3333-3333-3333-3333333355aa', now());

-- AppSheet-style pre-set fact on the coalesce fixture: recording the
-- purchase WITHOUT an eta must preserve this value, not wipe it.
update public.purchase_requests
   set eta = '2026-06-25'
 where id = 'a3000000-0000-4000-8000-0000000055aa';

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- ============================================================================
-- B. Catalog.
-- ============================================================================

select has_table('public', 'suppliers', 'suppliers exists');
select has_column('public', 'purchase_requests', 'supplier_id',
  'purchase_requests.supplier_id exists');
select is((select relrowsecurity from pg_class where oid = 'public.suppliers'::regclass),
  true, 'RLS enabled on suppliers');
select policies_are('public', 'suppliers',
  array['suppliers readable by staff',
        'suppliers insert by back office',
        'suppliers update by back office'],
  'exactly the three supplier policies — NO delete policy');
select is(has_table_privilege('authenticated', 'public.suppliers', 'DELETE'),
  false, 'authenticated has NO DELETE on suppliers');
select throws_ok(
  $$ insert into public.suppliers (name, created_by)
     values ('   ', '33333333-3333-3333-3333-3333333355aa') $$,
  '23514', null, 'blank supplier name violates suppliers_name_nonblank');
select has_function('public', 'record_purchase',
  'record_purchase RPC exists');
select has_function('public', 'record_shipment',
  'record_shipment RPC exists');
select ok(
  not has_function_privilege('anon', 'public.record_purchase(uuid,uuid,text,numeric,date)', 'execute'),
  'anon cannot execute record_purchase');
select ok(
  not has_function_privilege('anon', 'public.record_shipment(uuid)', 'execute'),
  'anon cannot execute record_shipment');
select is(
  (select count(*)::int from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('record_purchase', 'record_shipment')
      and p.prosecdef
      and array_to_string(p.proconfig, ',') like '%search_path=public%'),
  2, 'both RPCs are SECURITY DEFINER with pinned search_path');

-- ============================================================================
-- C. Role-sim.
-- ============================================================================

set local role authenticated;

-- C.1 PM creates a supplier.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-3333333355aa"}';
select lives_ok(
  $$ insert into public.suppliers (id, name, phone, created_by)
     values ('51000000-0000-4000-8000-0000000055aa', 'ร้านวัสดุสมใจ', '02-000-0000',
             '33333333-3333-3333-3333-3333333355aa') $$,
  'PM creates a supplier');

-- C.2 SA cannot create suppliers (financial back-office data, ADR 0038).
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-2222222255aa"}';
select throws_ok(
  $$ insert into public.suppliers (name, created_by)
     values ('ร้าน SA', '22222222-2222-2222-2222-2222222255aa') $$,
  '42501', null, 'SA supplier INSERT is denied');

-- C.2b SA cannot read suppliers... is wrong — SA CAN read (staff SELECT).
--      The unprivileged read pin is the VISITOR: zero rows under RLS.
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-4444444455aa"}';
select is(
  (select count(*)::int from public.suppliers),
  0, 'visitor sees zero suppliers (RLS-filtered)');
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-2222222255aa"}';

-- C.2c Column-scope grants (spec-33 amendment): SA INSERT carrying the
--      back-office analytics FK is refused at the privilege layer.
select throws_ok(
  $$ insert into public.purchase_requests
       (work_package_id, item_description, quantity, unit, requested_by, source, supplier_id)
     values
       ('eeeeeeee-eeee-eeee-eeee-eeeeeeee55aa', 'Sneaky', 1, 'ea',
        '22222222-2222-2222-2222-2222222255aa', 'app',
        '51000000-0000-4000-8000-0000000055aa') $$,
  '42501', null, 'INSERT with supplier_id is denied at the column-privilege layer');

-- C.3 SA cannot call record_purchase.
select throws_ok(
  $$ select public.record_purchase(
       'a1000000-0000-4000-8000-0000000055aa',
       '51000000-0000-4000-8000-0000000055aa', null, null, null) $$,
  '42501', null, 'SA cannot call record_purchase');

-- C.3b SA cannot call record_shipment.
select throws_ok(
  $$ select public.record_shipment('a1000000-0000-4000-8000-0000000055aa') $$,
  '42501', null, 'SA cannot call record_shipment');

-- C.4 Visitor cannot call record_purchase or record_shipment.
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-4444444455aa"}';
select throws_ok(
  $$ select public.record_purchase(
       'a1000000-0000-4000-8000-0000000055aa',
       '51000000-0000-4000-8000-0000000055aa', null, null, null) $$,
  '42501', null, 'visitor cannot call record_purchase');
select throws_ok(
  $$ select public.record_shipment('a1000000-0000-4000-8000-0000000055aa') $$,
  '42501', null, 'visitor cannot call record_shipment');

-- C.5 Stage guard: a requested row cannot be purchased.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-3333333355aa"}';
select throws_ok(
  $$ select public.record_purchase(
       'a2000000-0000-4000-8000-0000000055aa',
       '51000000-0000-4000-8000-0000000055aa', null, null, null) $$,
  'P0001', null, 'record_purchase on a requested row raises (stage guard)');

-- C.6 Unknown supplier raises.
select throws_ok(
  $$ select public.record_purchase(
       'a1000000-0000-4000-8000-0000000055aa',
       '59999999-0000-4000-8000-0000000055aa', null, null, null) $$,
  'P0001', null, 'record_purchase with an unknown supplier raises');

-- C.7 Non-positive amount raises.
select throws_ok(
  $$ select public.record_purchase(
       'a1000000-0000-4000-8000-0000000055aa',
       '51000000-0000-4000-8000-0000000055aa', null, 0, null) $$,
  'P0001', null, 'record_purchase with amount <= 0 raises');

-- C.8 PM records the purchase (happy path).
select lives_ok(
  $$ select public.record_purchase(
       'a1000000-0000-4000-8000-0000000055aa',
       '51000000-0000-4000-8000-0000000055aa',
       'PO-2026-042', 12500.50, '2026-06-20') $$,
  'PM records a purchase');

-- C.9 Shipment before re-check: stage guard blocks double purchase.
select throws_ok(
  $$ select public.record_purchase(
       'a1000000-0000-4000-8000-0000000055aa',
       '51000000-0000-4000-8000-0000000055aa', null, null, null) $$,
  'P0001', null, 'record_purchase twice raises (purchased_at already set)');

-- C.10 PM records the shipment.
select lives_ok(
  $$ select public.record_shipment('a1000000-0000-4000-8000-0000000055aa') $$,
  'PM records the shipment');

-- C.11 Shipment twice raises.
select throws_ok(
  $$ select public.record_shipment('a1000000-0000-4000-8000-0000000055aa') $$,
  'P0001', null, 'record_shipment twice raises (stage guard)');

-- C.12 Coalesce semantics (spec-33 amendment): recording WITHOUT the
--      optional facts must preserve the AppSheet-pre-set eta on q3.
select lives_ok(
  $$ select public.record_purchase(
       'a3000000-0000-4000-8000-0000000055aa',
       '51000000-0000-4000-8000-0000000055aa', null, null, null) $$,
  'PM records a purchase with optional facts omitted');

-- C.13 Column-scope grants: PM direct UPDATE of a fact column is refused
--      at the privilege layer (the RPC is the only app-side fact writer).
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-3333333355aa"}';
select throws_ok(
  $$ update public.purchase_requests
       set supplier = 'desync'
     where id = 'a2000000-0000-4000-8000-0000000055aa' $$,
  '42501', null, 'PM direct UPDATE of supplier is denied at the column-privilege layer');

reset role;

select is(
  (select eta::text from public.purchase_requests
     where id = 'a3000000-0000-4000-8000-0000000055aa'),
  '2026-06-25', 'omitted p_eta preserved the pre-set eta (no fact wipe)');

-- ============================================================================
-- D. Outcomes — the existing trigger chain did the rest.
-- ============================================================================

select is(
  (select status::text from public.purchase_requests
     where id = 'a1000000-0000-4000-8000-0000000055aa'),
  'on_route', 'derive trigger walked approved→purchased→on_route');

select is(
  (select supplier || '|' || supplier_id::text || '|' || order_ref || '|'
          || amount::text || '|' || eta::text
     from public.purchase_requests
     where id = 'a1000000-0000-4000-8000-0000000055aa'),
  'ร้านวัสดุสมใจ|51000000-0000-4000-8000-0000000055aa|PO-2026-042|12500.50|2026-06-20',
  'facts landed: name snapshot + FK + order_ref + amount + eta');

select is(
  (select count(*)::int from public.audit_log
     where action = 'purchase_request_purchase'
       and target_id = 'a1000000-0000-4000-8000-0000000055aa'::uuid),
  1, 'existing fact-audit trigger wrote the purchase audit row');

select is(
  (select count(*)::int from public.notification_outbox
     where event_type = 'pr_progress'
       and purchase_request_id = 'a1000000-0000-4000-8000-0000000055aa'::uuid),
  2, 'spec-32 capture wrote pr_progress for BOTH transitions (purchased, on_route)');

select is(
  (select count(*)::int from public.audit_log
     where action = 'update'
       and target_id = 'a1000000-0000-4000-8000-0000000055aa'::uuid
       and payload->'transition' = '["purchased", "on_route"]'::jsonb),
  1, 'existing audit trigger wrote the shipment transition row');

select is(
  (select created_by from public.suppliers
     where id = '51000000-0000-4000-8000-0000000055aa'),
  '33333333-3333-3333-3333-3333333355aa'::uuid,
  'created_by pinned to the creating PM');

select * from finish();
rollback;
