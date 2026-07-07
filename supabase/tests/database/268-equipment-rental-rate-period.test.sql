begin;
select plan(35);

-- ============================================================================
-- Spec 268 U1 (rate period) + Spec 275 U1 (vendor switch + agreement fields).
-- 268 added equipment_rate_period + rate_period + the 6-arg create RPC.
-- 275 U1 REPOINTS that RPC owner_id->supplier_id (closing U0's null-party GL
-- bug), adds deposit/deposit_paid_date/min_rental_days/status, relaxes owner_id
-- to nullable, and adds equipment_items.rental_agreement_id. This file pins the
-- combined current shape: the RPC is now 9-arg + supplier-keyed; owner ids are
-- rejected (they are not suppliers); the new columns exist with their defaults.
-- UUIDs HEX-ONLY.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110268', 'pm@rateperiod.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220268', 'sa@rateperiod.local', '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330268', 'vi@rateperiod.local', '{}'::jsonb);
update public.users set role = 'project_manager' where id = '11111111-1111-1111-1111-111111110268';
update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-222222220268';
-- third user stays visitor

-- The payee is now a SUPPLIER (spec 275 U0/U1). Keep an equipment_owner too, to prove an
-- owner id is rejected where a supplier is expected.
insert into public.suppliers (id, name, created_by) values
  ('5a000001-0000-4000-8000-000000000268', 'Rate Period Vendor',
   '11111111-1111-1111-1111-111111110268');
insert into public.equipment_owners (id, name, created_by) values
  ('b0000001-0000-4000-8000-000000000268', 'Legacy Owner (not a supplier)',
   '11111111-1111-1111-1111-111111110268');

-- ============================================================================
-- A. rate_period enum + column (spec 268 — unchanged).
-- ============================================================================
select has_type('public', 'equipment_rate_period', 'equipment_rate_period enum exists');
select enum_has_labels('public', 'equipment_rate_period', array['monthly', 'daily'],
  'equipment_rate_period labels are exactly monthly|daily');
select has_column('public', 'equipment_rental_batches', 'rate_period',
  'equipment_rental_batches.rate_period exists');
select col_type_is('public', 'equipment_rental_batches', 'rate_period', 'equipment_rate_period',
  'rate_period is equipment_rate_period');
select col_not_null('public', 'equipment_rental_batches', 'rate_period',
  'rate_period is not null');
select col_default_is('public', 'equipment_rental_batches', 'rate_period',
  'monthly'::public.equipment_rate_period, 'rate_period defaults to monthly');

-- ============================================================================
-- B. Spec 275 U1 — agreement columns + status enum + owner_id relax + item link.
-- ============================================================================
select has_type('public', 'rental_agreement_status', 'rental_agreement_status enum exists');
select enum_has_labels('public', 'rental_agreement_status',
  array['active', 'returned', 'settled', 'cancelled'],
  'rental_agreement_status labels are active|returned|settled|cancelled');
select has_column('public', 'equipment_rental_batches', 'deposit_amount',
  'equipment_rental_batches.deposit_amount exists');
select has_column('public', 'equipment_rental_batches', 'deposit_paid_date',
  'equipment_rental_batches.deposit_paid_date exists');
select has_column('public', 'equipment_rental_batches', 'min_rental_days',
  'equipment_rental_batches.min_rental_days exists');
select has_column('public', 'equipment_rental_batches', 'status',
  'equipment_rental_batches.status exists');
select col_default_is('public', 'equipment_rental_batches', 'status',
  'active'::public.rental_agreement_status, 'status defaults to active');
select is(
  (select is_nullable from information_schema.columns
    where table_schema = 'public' and table_name = 'equipment_rental_batches'
      and column_name = 'owner_id'),
  'YES', 'owner_id is now nullable (deprecated; supplier_id is the payee)');
select has_column('public', 'equipment_items', 'rental_agreement_id',
  'equipment_items.rental_agreement_id exists');

-- ============================================================================
-- C. RPC signature swap (6-arg owner GONE, 9-arg supplier present) + execute posture.
-- ============================================================================
select hasnt_function('public', 'create_equipment_rental_batch',
  array['uuid', 'numeric', 'date', 'date', 'text', 'equipment_rate_period'],
  'the 6-arg (owner) create_equipment_rental_batch is GONE');
select has_function('public', 'create_equipment_rental_batch',
  array['uuid', 'numeric', 'date', 'date', 'text', 'equipment_rate_period', 'numeric', 'date', 'integer'],
  'the 9-arg (supplier + deposit/min-days) create_equipment_rental_batch exists');
select is(
  has_function_privilege('anon',
    'public.create_equipment_rental_batch(uuid, numeric, date, date, text, public.equipment_rate_period, numeric, date, integer)',
    'EXECUTE'),
  false, 'anon cannot execute the 9-arg create_equipment_rental_batch');
select is(
  has_function_privilege('authenticated',
    'public.create_equipment_rental_batch(uuid, numeric, date, date, text, public.equipment_rate_period, numeric, date, integer)',
    'EXECUTE'),
  true, 'authenticated can execute the 9-arg create_equipment_rental_batch');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- D. Role-gate regression (the DROP/CREATE must not loosen the gate).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220268"}';
select throws_ok(
  $$ select public.create_equipment_rental_batch('5a000001-0000-4000-8000-000000000268', 70001, date '2026-07-01') $$,
  '42501', null, 'create_equipment_rental_batch still refuses site_admin');

set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330268"}';
select throws_ok(
  $$ select public.create_equipment_rental_batch('5a000001-0000-4000-8000-000000000268', 70001, date '2026-07-01') $$,
  '42501', null, 'create_equipment_rental_batch still refuses visitor');

-- ============================================================================
-- E. Behaviour: supplier-keyed; owner id rejected; legacy->monthly; daily; deposit/min-days.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110268"}';
select lives_ok(
  $$ select public.create_equipment_rental_batch('5a000001-0000-4000-8000-000000000268', 70001, date '2026-07-01') $$,
  'a legacy-shape (no rate period) supplier call still works');
select lives_ok(
  $$ select public.create_equipment_rental_batch('5a000001-0000-4000-8000-000000000268', 70002, date '2026-07-10', date '2026-07-20', null, 'daily') $$,
  'an explicit daily custom-duration call works');
select throws_ok(
  $$ select public.create_equipment_rental_batch('5a000001-0000-4000-8000-000000000268', 70003, date '2026-07-01', null, null, null::public.equipment_rate_period) $$,
  'P0001', null, 'an explicit null rate period is refused');
select throws_ok(
  $$ select public.create_equipment_rental_batch('b0000001-0000-4000-8000-000000000268', 70009, date '2026-07-01') $$,
  'P0001', null, 'an equipment_owner id is rejected — the payee must be a supplier');
select lives_ok(
  $$ select public.create_equipment_rental_batch('5a000001-0000-4000-8000-000000000268', 70004, date '2026-07-01', null, null, 'monthly', 5000, date '2026-07-01', 30) $$,
  'a call with deposit + minimum-rental-days works');

reset role;
select is(
  (select rate_period::text from public.equipment_rental_batches where monthly_rate = 70001),
  'monthly', 'the legacy-shape batch defaulted to monthly');
select is(
  (select rate_period::text from public.equipment_rental_batches where monthly_rate = 70002),
  'daily', 'the daily batch recorded daily');
select is(
  (select payload->>'rate_period' from public.audit_log
    where action = 'equipment_batch_create' and (payload->>'monthly_rate')::numeric = 70001),
  'monthly', 'the audit payload carries rate_period=monthly for the legacy-shape batch');
select is(
  (select payload->>'rate_period' from public.audit_log
    where action = 'equipment_batch_create' and (payload->>'monthly_rate')::numeric = 70002),
  'daily', 'the audit payload carries rate_period=daily for the daily batch');

-- Spec 275 U1: the create path now sets supplier_id (owner_id null) — the U0 null-party bug closed.
select is(
  (select count(*) from public.equipment_rental_batches
    where monthly_rate = 70001
      and supplier_id = '5a000001-0000-4000-8000-000000000268'
      and owner_id is null),
  1::bigint, 'a created batch carries supplier_id and a NULL owner_id (vendor switch)');
select is(
  (select deposit_amount from public.equipment_rental_batches where monthly_rate = 70004),
  5000::numeric, 'the deposit batch recorded deposit_amount = 5000');
select is(
  (select min_rental_days from public.equipment_rental_batches where monthly_rate = 70004),
  30, 'the deposit batch recorded min_rental_days = 30');
select is(
  (select status::text from public.equipment_rental_batches where monthly_rate = 70004),
  'active', 'a created batch defaults to status active');
select is(
  (select payload->>'supplier_id' from public.audit_log
    where action = 'equipment_batch_create' and (payload->>'monthly_rate')::numeric = 70001),
  '5a000001-0000-4000-8000-000000000268',
  'the audit payload carries supplier_id (not owner_id)');

select * from finish();
rollback;
