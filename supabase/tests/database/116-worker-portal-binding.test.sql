begin;
select plan(29);

-- ============================================================================
-- Spec 170 / ADR 0062 U4a — worker portal binding primitive.
-- A DC is a worker, so the portal binds on workers.user_id (not a contractor
-- party). Pins: catalog (worker_invites + the user_id unique index +
-- current_user_worker_id helper); create_worker_invite role gate (pm/super/
-- director; DC-worker only); claim_worker_invite flow (visitor-only, single-use,
-- unexpired, no rebind) and effects (workers.user_id set, role→technician (U7),
-- invite claimed, role_change audit, helper resolves); and the worker self-read
-- RLS (own worker row / own DC labor days / own payments via get_my_wage_payments
-- worker-direct) with isolation from another worker.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110170', 'pm@wbind.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220170', 'sa@wbind.local', '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330170', 'v1@wbind.local', '{}'::jsonb),
  ('44444444-4444-4444-4444-444444440170', 'v2@wbind.local', '{}'::jsonb);
update public.users set role = 'project_manager' where id = '11111111-1111-1111-1111-111111110170';
update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-222222220170';
-- v1, v2 stay visitor.

insert into public.projects (id, code, name) values
  ('cc000001-0000-4000-8000-000000000170', 'TAP-WBIND', 'Worker bind fixture');
insert into public.work_packages (id, project_id, code, name, status) values
  ('ee000001-0000-4000-8000-000000000170',
   'cc000001-0000-4000-8000-000000000170', 'WP-WB-1', 'WP', 'in_progress');

-- Two DC workers (the payees) + one own tech (a non-DC, for the gate test).
insert into public.workers (id, name, pay_type, employment_type, day_rate, active, created_by) values
  ('aa000001-0000-4000-8000-000000000170', 'DC A', 'daily', 'permanent', 400.00, true,
   '11111111-1111-1111-1111-111111110170'),
  ('aa000002-0000-4000-8000-000000000170', 'DC B', 'daily', 'permanent', 450.00, true,
   '11111111-1111-1111-1111-111111110170'),
  ('aa000003-0000-4000-8000-000000000170', 'Own Tech', 'monthly', 'permanent', 500.00, true,
   '11111111-1111-1111-1111-111111110170');

-- DC labor days + payments for A and B (for the self-read / isolation section).
insert into public.labor_logs (id, work_package_id, worker_id, work_date, day_fraction,
    day_rate_snapshot, worker_name_snapshot, pay_type_snapshot, entered_by) values
  ('fa000001-0000-4000-8000-000000000170', 'ee000001-0000-4000-8000-000000000170',
   'aa000001-0000-4000-8000-000000000170', date '2026-06-05', 'full', 400.00, 'DC A', 'daily',
   '11111111-1111-1111-1111-111111110170'),
  ('fb000001-0000-4000-8000-000000000170', 'ee000001-0000-4000-8000-000000000170',
   'aa000002-0000-4000-8000-000000000170', date '2026-06-05', 'full', 450.00, 'DC B', 'daily',
   '11111111-1111-1111-1111-111111110170');
insert into public.wage_payments (worker_id, period_from, period_to, computed_amount, computed_days,
    paid_amount, paid_at, method, paid_by) values
  ('aa000001-0000-4000-8000-000000000170', '2026-06-01', '2026-06-30', 400.00, 1.0, 400.00,
   '2026-06-30', 'bank_transfer', '11111111-1111-1111-1111-111111110170'),
  ('aa000002-0000-4000-8000-000000000170', '2026-06-01', '2026-06-30', 450.00, 1.0, 450.00,
   '2026-06-30', 'cash', '11111111-1111-1111-1111-111111110170');

-- Invites seeded directly (owner) so the claim tests have known tokens; the
-- create RPC is exercised separately below.
-- token_hash seeded as the SHA-256 digest of the cleartext (M1, 2026-06-29).
-- The claim calls below still pass the cleartext, which the RPC hashes to match.
insert into public.worker_invites (worker_id, token_hash, created_by, expires_at) values
  ('aa000001-0000-4000-8000-000000000170', encode(extensions.digest('wtokvalidaaaaaaaaaaaa', 'sha256'), 'hex'),
   '11111111-1111-1111-1111-111111110170', now() + interval '14 days'),
  ('aa000001-0000-4000-8000-000000000170', encode(extensions.digest('wtokexpiredbbbbbbbbbb', 'sha256'), 'hex'),
   '11111111-1111-1111-1111-111111110170', now() - interval '1 day'),
  ('aa000002-0000-4000-8000-000000000170', encode(extensions.digest('wtokotherccccccccccc', 'sha256'), 'hex'),
   '11111111-1111-1111-1111-111111110170', now() + interval '14 days');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Catalog + posture.
-- ============================================================================
select has_table('public', 'worker_invites', 'worker_invites exists');
select ok((select relrowsecurity from pg_class where oid = 'public.worker_invites'::regclass),
  'RLS enabled on worker_invites');
select has_index('public', 'workers', 'workers_user_id_key',
  'workers.user_id has a unique portal-binding index');
select has_function('public', 'current_user_worker_id', 'current_user_worker_id helper exists');

-- ============================================================================
-- B. create_worker_invite — pm/super/director only, DC-worker only.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220170"}';
select throws_ok(
  $$ select public.create_worker_invite('aa000001-0000-4000-8000-000000000170') $$,
  '42501', null, 'create_worker_invite refuses site_admin');

set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330170"}';
select throws_ok(
  $$ select public.create_worker_invite('aa000001-0000-4000-8000-000000000170') $$,
  '42501', null, 'create_worker_invite refuses visitor');

set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110170"}';
select isnt(
  (select public.create_worker_invite('aa000001-0000-4000-8000-000000000170')),
  null, 'project_manager issues a worker invite token');
select throws_ok(
  $$ select public.create_worker_invite('aa000099-0000-4000-8000-000000000099') $$,
  'P0001', null, 'create_worker_invite refuses an unknown worker');
select throws_ok(
  $$ select public.create_worker_invite('aa000003-0000-4000-8000-000000000170') $$,
  'P0001', null, 'create_worker_invite refuses a non-DC worker');

-- ============================================================================
-- C. Helper returns NULL for an unbound user.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330170"}';
select is(
  (select public.current_user_worker_id()),
  null, 'current_user_worker_id is NULL before binding');

-- ============================================================================
-- D. claim_worker_invite — guards + effects.
-- ============================================================================
select throws_ok(
  $$ select public.claim_worker_invite('nope-not-a-token') $$,
  'P0001', null, 'claim refuses an invalid token');
select throws_ok(
  $$ select public.claim_worker_invite('wtokexpiredbbbbbbbbbb') $$,
  'P0001', null, 'claim refuses an expired token');
select is(
  (select public.claim_worker_invite('wtokvalidaaaaaaaaaaaa')),
  'aa000001-0000-4000-8000-000000000170'::uuid, 'visitor claims → returns the worker id');

reset role;
select is(
  (select user_id from public.workers where id = 'aa000001-0000-4000-8000-000000000170'),
  '33333333-3333-3333-3333-333333330170'::uuid, 'workers.user_id bound to v1');
select is(
  (select role from public.users where id = '33333333-3333-3333-3333-333333330170'),
  'technician'::public.user_role, 'v1 role flipped visitor → technician (spec 266 U7)');
select is(
  (select claimed_by from public.worker_invites
     where token_hash = encode(extensions.digest('wtokvalidaaaaaaaaaaaa', 'sha256'), 'hex')),
  '33333333-3333-3333-3333-333333330170'::uuid, 'invite marked claimed by v1');
select is(
  (select count(*) from public.audit_log
    where action = 'role_change' and target_id = '33333333-3333-3333-3333-333333330170'
      and payload->>'to' = 'technician'),
  1::bigint, 'claim wrote a role_change audit row (→ technician, spec 266 U7)');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330170"}';
select is(
  (select public.current_user_worker_id()),
  'aa000001-0000-4000-8000-000000000170'::uuid, 'helper resolves the bound worker');
select throws_ok(
  $$ select public.claim_worker_invite('wtokotherccccccccccc') $$,
  '42501', null, 'a bound worker user cannot claim again (visitor-only gate)');

set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444440170"}';
select throws_ok(
  $$ select public.claim_worker_invite('wtokvalidaaaaaaaaaaaa') $$,
  'P0001', null, 'a single-use token cannot be claimed twice');

set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220170"}';
select throws_ok(
  $$ select public.claim_worker_invite('wtokotherccccccccccc') $$,
  '42501', null, 'a staff account cannot be converted by claiming');

-- ============================================================================
-- E. Worker self-read RLS (v1, now bound to DC A) — own rows only.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330170"}';
select is((select count(*) from public.workers),
  1::bigint, 'v1 sees exactly one worker (their own row)');
select is((select id from public.workers),
  'aa000001-0000-4000-8000-000000000170'::uuid, 'the worker v1 sees is DC A');
select throws_ok(
  $$ select day_rate from public.workers limit 1 $$,
  '42501', null, 'v1 cannot read workers.day_rate (money column grant)');
select is((select count(*) from public.labor_logs),
  1::bigint, 'v1 sees only their own DC labor days');
select throws_ok(
  $$ select day_rate_snapshot from public.labor_logs limit 1 $$,
  '42501', null, 'v1 cannot read labor_logs.day_rate_snapshot (money column grant)');
select throws_ok(
  $$ select paid_amount from public.wage_payments limit 1 $$,
  '42501', null, 'wage_payments stays zero-grant — v1 cannot read it directly');
select is((select count(*) from public.get_my_wage_payments()),
  1::bigint, 'v1 reads their own payment via get_my_wage_payments (worker-direct)');
select is((select worker_id from public.get_my_wage_payments() limit 1),
  'aa000001-0000-4000-8000-000000000170'::uuid, 'the payment v1 reads is DC A''s');

reset role;
select * from finish();
rollback;
