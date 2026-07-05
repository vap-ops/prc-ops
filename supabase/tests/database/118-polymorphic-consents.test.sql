begin;
select plan(10);

-- ============================================================================
-- Spec 170 / ADR 0062 U4b-2 — polymorphic consents. A DC is a worker, so
-- contractor_consents now serves both parties: contractor_id XOR worker_id.
-- Pins: the worker_id column + nullable contractor_id + the XOR check; the worker
-- consent path (record_worker_consent self-scoped, unbound refused); the bound-
-- worker read-arm isolation; revoke by the bound worker (and refusal for another).
-- The contractor path is covered by 51-contractor-onboarding (unchanged).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111114172', 'pm@cons.local', '{}'::jsonb),
  ('33333333-3333-3333-3333-333333334172', 'wa@cons.local', '{}'::jsonb),
  ('44444444-4444-4444-4444-444444444172', 'wb@cons.local', '{}'::jsonb),
  ('55555555-5555-5555-5555-555555554172', 'vi@cons.local', '{}'::jsonb);
update public.users set role = 'project_manager' where id = '11111111-1111-1111-1111-111111114172';
update public.users set role = 'contractor' where id in
  ('33333333-3333-3333-3333-333333334172', '44444444-4444-4444-4444-444444444172');
-- 55.. stays visitor (unbound).

-- Two DC workers, each bound to a portal user via workers.user_id.
insert into public.workers (id, name, pay_type, employment_type, day_rate, active, created_by, user_id) values
  ('aa000001-0000-4000-8000-000000004172', 'DC A', 'daily', 'permanent', 400.00, true,
   '11111111-1111-1111-1111-111111114172', '33333333-3333-3333-3333-333333334172'),
  ('aa000002-0000-4000-8000-000000004172', 'DC B', 'daily', 'permanent', 450.00, true,
   '11111111-1111-1111-1111-111111114172', '44444444-4444-4444-4444-444444444172');

-- A worker consent seeded directly (known id) for the read/revoke tests.
insert into public.contractor_consents (id, worker_id, kind, recorded_by) values
  ('cc000001-0000-4000-8000-000000004172', 'aa000001-0000-4000-8000-000000004172',
   'pdpa_data', '11111111-1111-1111-1111-111111114172');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Polymorphic shape.
-- ============================================================================
select has_column('public', 'contractor_consents', 'worker_id', 'contractor_consents gains worker_id');
select col_is_null('public', 'contractor_consents', 'contractor_id',
  'contractor_id is now nullable (XOR with worker_id)');
select throws_ok(
  $$ insert into public.contractor_consents (kind, recorded_by)
     values ('pdpa_data', '11111111-1111-1111-1111-111111114172') $$,
  '23514', null, 'a consent with neither party is rejected (XOR check)');

-- ============================================================================
-- B. record_worker_consent — self-scoped; unbound refused.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333334172"}';
select isnt(
  (select public.record_worker_consent('background_check')),
  null, 'a bound DC worker records their own consent');

set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555554172"}';
select throws_ok(
  $$ select public.record_worker_consent('pdpa_data') $$,
  '42501', null, 'an unbound caller cannot record a worker consent');

-- ============================================================================
-- C. Read isolation — bound worker sees own; not another's.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333334172"}';
select is((select count(*) from public.contractor_consents),
  2::bigint, 'DC A sees their own consents (seeded + recorded)');
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444444172"}';
select is((select count(*) from public.contractor_consents
            where worker_id = 'aa000001-0000-4000-8000-000000004172'),
  0::bigint, 'DC B cannot see DC A''s consents');

-- ============================================================================
-- D. Revoke — bound worker revokes own; another is refused.
-- ============================================================================
select throws_ok(
  $$ select public.revoke_contractor_consent('cc000001-0000-4000-8000-000000004172') $$,
  '42501', null, 'DC B cannot revoke DC A''s consent');

set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333334172"}';
select lives_ok(
  $$ select public.revoke_contractor_consent('cc000001-0000-4000-8000-000000004172') $$,
  'DC A revokes their own consent');
reset role;
select isnt(
  (select revoked_at from public.contractor_consents where id = 'cc000001-0000-4000-8000-000000004172'),
  null, 'the revoked worker consent carries revoked_at');

select * from finish();
rollback;
