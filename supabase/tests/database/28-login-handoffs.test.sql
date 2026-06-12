begin;
select plan(16);

-- ============================================================================
-- Spec 43 / ADR 0041 — login_handoffs: device-code handoff handshake state.
-- Shape + zero-user-access posture (outbox precedent). The table is
-- service-role-only; both roles must be denied at the privilege layer.
-- ============================================================================

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Catalog.
-- ============================================================================

select has_table('public', 'login_handoffs', 'login_handoffs exists');
select enum_has_labels('public', 'login_handoff_status',
  array['pending', 'approved', 'consumed'],
  'login_handoff_status labels');
select has_column('public', 'login_handoffs', 'state',       'state exists');
select has_column('public', 'login_handoffs', 'device_code', 'device_code exists');
select has_column('public', 'login_handoffs', 'status',      'status exists');
select has_column('public', 'login_handoffs', 'user_email',  'user_email exists');
select has_column('public', 'login_handoffs', 'line_claims', 'line_claims exists');
select has_column('public', 'login_handoffs', 'expires_at',  'expires_at exists');
select col_is_unique('public', 'login_handoffs', 'state', 'state is unique');
select col_is_unique('public', 'login_handoffs', 'device_code', 'device_code is unique');

-- Functional default: a fresh row is pending.
insert into public.login_handoffs (state, device_code, expires_at)
values ('tap-state-1', 'tap-device-1', now() + interval '10 minutes');
select is(
  (select status from public.login_handoffs where state = 'tap-state-1'),
  'pending'::public.login_handoff_status,
  'status defaults to pending');

select ok(
  (select relrowsecurity from pg_class
     where oid = 'public.login_handoffs'::regclass),
  'RLS is enabled on login_handoffs');
select is(
  (select count(*) from pg_policies
     where schemaname = 'public' and tablename = 'login_handoffs'),
  0::bigint,
  'login_handoffs has zero policies (service-role only)');

-- ============================================================================
-- B. Zero user access (privileges revoked).
-- ============================================================================

set local role authenticated;

select throws_ok(
  $$ select count(*) from public.login_handoffs $$,
  '42501', null, 'authenticated SELECT denied (privilege revoked)');
select throws_ok(
  $$ insert into public.login_handoffs (state, device_code, expires_at)
     values ('tap-state-2', 'tap-device-2', now()) $$,
  '42501', null, 'authenticated INSERT denied (privilege revoked)');

set local role anon;

select throws_ok(
  $$ select count(*) from public.login_handoffs $$,
  '42501', null, 'anon SELECT denied (privilege revoked)');

reset role;

select * from finish();
rollback;
