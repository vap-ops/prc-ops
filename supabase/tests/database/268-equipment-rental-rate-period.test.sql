begin;
select plan(19);

-- ============================================================================
-- Spec 268 U1 — equipment rental rate period.
-- Pins: the equipment_rate_period enum (monthly|daily); the
-- equipment_rental_batches.rate_period column (type, not-null, default
-- 'monthly'); the create_equipment_rental_batch DROP/CREATE (5-arg GONE,
-- 6-arg present, anon revoked / authenticated granted); role-gate regression
-- (site_admin + visitor 42501); a legacy-shape positional call records
-- 'monthly' and the audit payload carries it; an explicit 'daily' call
-- records 'daily'; a null rate period is P0001.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110268', 'pm@rateperiod.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220268', 'sa@rateperiod.local', '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330268', 'vi@rateperiod.local', '{}'::jsonb);
update public.users set role = 'project_manager' where id = '11111111-1111-1111-1111-111111110268';
update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-222222220268';
-- third user stays visitor

insert into public.equipment_owners (id, name, created_by) values
  ('b0000001-0000-4000-8000-000000000268', 'Rate Period Lessor',
   '11111111-1111-1111-1111-111111110268');

-- ============================================================================
-- A. Enum + column catalog.
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
-- col_default_is casts the expected value to the COLUMN's type before
-- comparing (pgTAP _cdi/_def_is) — pass the enum value, not the default's
-- text form (the text form fails 22P02 "invalid input value for enum").
select col_default_is('public', 'equipment_rental_batches', 'rate_period',
  'monthly'::public.equipment_rate_period, 'rate_period defaults to monthly');

-- ============================================================================
-- B. RPC signature swap + execute posture.
-- ============================================================================
select hasnt_function('public', 'create_equipment_rental_batch',
  array['uuid', 'numeric', 'date', 'date', 'text'],
  'the 5-arg create_equipment_rental_batch is GONE (no ambiguous overload)');
select has_function('public', 'create_equipment_rental_batch',
  array['uuid', 'numeric', 'date', 'date', 'text', 'equipment_rate_period'],
  'the 6-arg create_equipment_rental_batch exists');
select is(
  has_function_privilege('anon',
    'public.create_equipment_rental_batch(uuid, numeric, date, date, text, public.equipment_rate_period)',
    'EXECUTE'),
  false, 'anon cannot execute the 6-arg create_equipment_rental_batch');
select is(
  has_function_privilege('authenticated',
    'public.create_equipment_rental_batch(uuid, numeric, date, date, text, public.equipment_rate_period)',
    'EXECUTE'),
  true, 'authenticated can execute the 6-arg create_equipment_rental_batch');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- C. Role-gate regression (the DROP/CREATE must not loosen the gate).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220268"}';
select throws_ok(
  $$ select public.create_equipment_rental_batch('b0000001-0000-4000-8000-000000000268', 70001, date '2026-07-01') $$,
  '42501', null, 'create_equipment_rental_batch still refuses site_admin');

set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330268"}';
select throws_ok(
  $$ select public.create_equipment_rental_batch('b0000001-0000-4000-8000-000000000268', 70001, date '2026-07-01') $$,
  '42501', null, 'create_equipment_rental_batch still refuses visitor');

-- ============================================================================
-- D. Behaviour: legacy shape → monthly; explicit daily; null → P0001.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110268"}';
select lives_ok(
  $$ select public.create_equipment_rental_batch('b0000001-0000-4000-8000-000000000268', 70001, date '2026-07-01') $$,
  'a legacy-shape (no rate period) call still works');
select lives_ok(
  $$ select public.create_equipment_rental_batch('b0000001-0000-4000-8000-000000000268', 70002, date '2026-07-10', date '2026-07-20', null, 'daily') $$,
  'an explicit daily custom-duration call works');
select throws_ok(
  $$ select public.create_equipment_rental_batch('b0000001-0000-4000-8000-000000000268', 70003, date '2026-07-01', null, null, null::public.equipment_rate_period) $$,
  'P0001', null, 'an explicit null rate period is refused');

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

select * from finish();
rollback;
