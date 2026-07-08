begin;
select plan(29);

-- ============================================================================
-- Spec 146 U1 / ADR 0055 decision 5 — equipment rental money spine.
-- Pins: equipment_items.daily_rate (column + type + negative CHECK + the money
-- anti-grant), equipment_rental_batches (catalog/PK/RLS/zero-policy + CHECKs +
-- zero authenticated grant), and the two money-write RPCs
-- (set_equipment_daily_rate / create_equipment_rental_batch): role gate
-- pm/super/PROCUREMENT (site_admin AND visitor refused 42501; procurement
-- ALLOWED — the deliberate divergence from set_worker_day_rate), P0001
-- existence/shape guards, created_by pin, exactly the right audit rows.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110146', 'pm@equipmoney.local',   '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220146', 'sa@equipmoney.local',   '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330146', 'vi@equipmoney.local',   '{}'::jsonb),
  ('44444444-4444-4444-4444-444444440146', 'proc@equipmoney.local', '{}'::jsonb);
update public.users set role = 'project_manager' where id = '11111111-1111-1111-1111-111111110146';
update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-222222220146';
update public.users set role = 'procurement'     where id = '44444444-4444-4444-4444-444444440146';
-- third user stays visitor

-- FK targets, seeded as the table owner (RLS bypassed).
insert into public.equipment_owners (id, name, created_by) values
  ('b0000001-0000-4000-8000-000000000146', 'Sister Co Equipment',
   '11111111-1111-1111-1111-111111110146');
-- Spec 275 U1: the rental payee is a SUPPLIER (create_equipment_rental_batch supplier-keyed).
insert into public.suppliers (id, name, created_by) values
  ('5a000001-0000-4000-8000-000000000146', 'Rental Vendor',
   '11111111-1111-1111-1111-111111110146');
insert into public.equipment_categories (id, name, created_by) values
  ('c0000001-0000-4000-8000-000000000146', 'Generators',
   '11111111-1111-1111-1111-111111110146');
insert into public.equipment_items (id, category_id, owner_id, name, tracking, created_by) values
  ('d0000001-0000-4000-8000-000000000146',
   'c0000001-0000-4000-8000-000000000146', 'b0000001-0000-4000-8000-000000000146',
   'Generator 5kVA #1', 'unit', '11111111-1111-1111-1111-111111110146');

-- ============================================================================
-- A. Catalog + posture.
-- ============================================================================
select has_table('public', 'equipment_rental_batches', 'equipment_rental_batches exists');
select col_is_pk('public', 'equipment_rental_batches', 'id',
  'equipment_rental_batches.id is the PK');
select has_column('public', 'equipment_items', 'daily_rate', 'equipment_items.daily_rate exists');
select col_type_is('public', 'equipment_items', 'daily_rate', 'numeric(12,2)',
  'daily_rate is numeric(12,2)');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.equipment_rental_batches'::regclass),
  'RLS enabled on equipment_rental_batches');
select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'equipment_rental_batches'),
  0::bigint, 'equipment_rental_batches has no policies (zero grant — RPC/admin only)');

-- ============================================================================
-- B. CHECK invariants (run as table owner — RLS bypassed, the CHECK fires).
-- ============================================================================
select throws_ok(
  $$ insert into public.equipment_rental_batches (owner_id, monthly_rate, starts_on, created_by)
     values ('b0000001-0000-4000-8000-000000000146', -1, date '2026-07-01',
             '11111111-1111-1111-1111-111111110146') $$,
  '23514', null, 'a negative monthly_rate is rejected');
select throws_ok(
  $$ insert into public.equipment_rental_batches (owner_id, monthly_rate, starts_on, ends_on, created_by)
     values ('b0000001-0000-4000-8000-000000000146', 50000, date '2026-07-01', date '2026-06-30',
             '11111111-1111-1111-1111-111111110146') $$,
  '23514', null, 'ends_on before starts_on is rejected');
select throws_ok(
  $$ insert into public.equipment_items (category_id, owner_id, name, tracking, daily_rate, created_by)
     values ('c0000001-0000-4000-8000-000000000146', 'b0000001-0000-4000-8000-000000000146',
             'bad rate', 'unit', -1, '11111111-1111-1111-1111-111111110146') $$,
  '23514', null, 'a negative daily_rate is rejected');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- C. Money anti-grant (authenticated = site_admin): daily_rate unreadable,
--    the batches table entirely unreadable/unwritable.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220146"}';

select throws_ok(
  $$ select daily_rate from public.equipment_items limit 1 $$,
  '42501', null, 'authenticated cannot read daily_rate (money, no column grant)');
select throws_ok(
  $$ select monthly_rate from public.equipment_rental_batches limit 1 $$,
  '42501', null, 'authenticated cannot read equipment_rental_batches (zero grant)');
select throws_ok(
  $$ insert into public.equipment_rental_batches (owner_id, monthly_rate, starts_on, created_by)
     values ('b0000001-0000-4000-8000-000000000146', 1, date '2026-07-01',
             '22222222-2222-2222-2222-222222220146') $$,
  '42501', null, 'authenticated cannot INSERT equipment_rental_batches directly');

-- ============================================================================
-- D. RPC role gates: site_admin AND visitor refused (money).
-- ============================================================================
select throws_ok(
  $$ select public.set_equipment_daily_rate('d0000001-0000-4000-8000-000000000146', 1500) $$,
  '42501', null, 'set_equipment_daily_rate refuses site_admin');
select throws_ok(
  $$ select public.create_equipment_rental_batch('b0000001-0000-4000-8000-000000000146', 50000, date '2026-07-01') $$,
  '42501', null, 'create_equipment_rental_batch refuses site_admin');

set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330146"}';
select throws_ok(
  $$ select public.set_equipment_daily_rate('d0000001-0000-4000-8000-000000000146', 1500) $$,
  '42501', null, 'set_equipment_daily_rate refuses visitor');
select throws_ok(
  $$ select public.create_equipment_rental_batch('b0000001-0000-4000-8000-000000000146', 50000, date '2026-07-01') $$,
  '42501', null, 'create_equipment_rental_batch refuses visitor');

-- ============================================================================
-- E. Happy path + shape guards (project_manager).
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110146"}';
select lives_ok(
  $$ select public.set_equipment_daily_rate('d0000001-0000-4000-8000-000000000146', 1500) $$,
  'project_manager sets the per-item daily rate');
select throws_ok(
  $$ select public.set_equipment_daily_rate('d0000099-0000-4000-8000-000000000099', 1500) $$,
  'P0001', null, 'set_equipment_daily_rate refuses a non-existent item');
select lives_ok(
  $$ select public.create_equipment_rental_batch('5a000001-0000-4000-8000-000000000146', 50000, date '2026-07-01') $$,
  'project_manager creates a rental batch');
select throws_ok(
  $$ select public.create_equipment_rental_batch('b0000099-0000-4000-8000-000000000099', 50000, date '2026-07-01') $$,
  'P0001', null, 'create_equipment_rental_batch refuses a non-existent supplier');
select throws_ok(
  $$ select public.create_equipment_rental_batch('5a000001-0000-4000-8000-000000000146', 50000, date '2026-07-01', date '2026-06-30') $$,
  'P0001', null, 'create_equipment_rental_batch refuses ends_on before starts_on');

-- ============================================================================
-- F. Procurement ALLOWED — the deliberate divergence from labor (pm/super).
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444440146"}';
select lives_ok(
  $$ select public.set_equipment_daily_rate('d0000001-0000-4000-8000-000000000146', 1800) $$,
  'procurement sets the per-item daily rate (equipment back office)');
select lives_ok(
  $$ select public.create_equipment_rental_batch('5a000001-0000-4000-8000-000000000146', 60000, date '2026-08-01') $$,
  'procurement creates a rental batch');

-- ============================================================================
-- G. Effects + audit (reset to owner to read past the zero-grant posture).
-- ============================================================================
reset role;
select is(
  (select daily_rate from public.equipment_items
    where id = 'd0000001-0000-4000-8000-000000000146'),
  1800.00, 'daily_rate reflects the last set (procurement 1800)');
select is(
  (select count(*) from public.audit_log
    where action = 'equipment_rate_change'
      and target_id = 'd0000001-0000-4000-8000-000000000146'),
  2::bigint, 'two equipment_rate_change audit rows (pm + procurement)');
select is(
  (select count(*) from public.audit_log
    where action = 'equipment_batch_create'
      and actor_id in ('11111111-1111-1111-1111-111111110146',
                       '44444444-4444-4444-4444-444444440146')),
  2::bigint, 'two equipment_batch_create audit rows (pm + procurement)');
select is(
  (select count(*) from public.equipment_rental_batches
    where created_by = '11111111-1111-1111-1111-111111110146'),
  1::bigint, 'created_by pinned to the PM caller on the PM batch');
select is(
  (select count(*) from public.equipment_rental_batches
    where created_by = '44444444-4444-4444-4444-444444440146'),
  1::bigint, 'created_by pinned to the procurement caller on its batch');

-- ============================================================================
-- H. Anon denied entirely.
-- ============================================================================
set local role anon;
select throws_ok(
  $$ select id from public.equipment_rental_batches limit 1 $$,
  '42501', null, 'anon cannot read equipment_rental_batches');

reset role;
select * from finish();
rollback;
