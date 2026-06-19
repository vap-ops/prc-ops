begin;
select plan(27);

-- ============================================================================
-- Spec 149 U2 / ADR 0057 decision 7 — accounting_periods + lifecycle RPCs.
-- Pins: catalog (table/PK/RLS/zero-policy + the status enum) + first-of-month
-- CHECK; zero authenticated grant; open_accounting_period (pm/super gate +
-- idempotent); set_accounting_period_status (legal transitions, P0001 illegal /
-- not-found, super-only lock); resolve_posting_period (open month -> id,
-- auto-open missing month, P0002 on a closed month); audit rows; anon denied.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110468', 'pm@acctperiod.local',    '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220468', 'sa@acctperiod.local',    '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330468', 'super@acctperiod.local', '{}'::jsonb);
update public.users set role = 'project_manager' where id = '11111111-1111-1111-1111-111111110468';
update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-222222220468';
update public.users set role = 'super_admin'     where id = '33333333-3333-3333-3333-333333330468';

-- ============================================================================
-- A. Catalog + posture.
-- ============================================================================
select has_type('public', 'accounting_period_status', 'accounting_period_status enum exists');
select enum_has_labels(
  'public', 'accounting_period_status',
  array['open', 'closing', 'closed', 'locked'],
  'accounting_period_status has open/closing/closed/locked');
select has_table('public', 'accounting_periods', 'accounting_periods exists');
select col_is_pk('public', 'accounting_periods', 'id', 'accounting_periods.id is the PK');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.accounting_periods'::regclass),
  'RLS enabled on accounting_periods');
select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'accounting_periods'),
  0::bigint, 'accounting_periods has no policies (zero grant — RPC/admin only)');

-- first-of-month CHECK (run as owner — RLS bypassed, the CHECK fires).
select throws_ok(
  $$ insert into public.accounting_periods (period_month) values (date '2026-07-15') $$,
  '23514', null, 'a non-first-of-month period_month is rejected');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- B. Zero grant + RPC gate (authenticated = site_admin).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220468"}';

select throws_ok(
  $$ select status from public.accounting_periods limit 1 $$,
  '42501', null, 'authenticated cannot read accounting_periods (zero grant)');
select throws_ok(
  $$ select public.open_accounting_period(date '2026-07-01') $$,
  '42501', null, 'open_accounting_period refuses site_admin');

-- ============================================================================
-- C. open_accounting_period (project_manager) — create + idempotent.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110468"}';
select lives_ok(
  $$ select public.open_accounting_period(date '2026-07-01') $$,
  'project_manager opens month A');
select lives_ok(
  $$ select public.open_accounting_period(date '2026-07-01') $$,
  'opening the same month again is an idempotent no-op');

-- ============================================================================
-- D. set_accounting_period_status — transitions + guards.
-- ============================================================================
select lives_ok(
  $$ select public.set_accounting_period_status(date '2026-07-01', 'closing') $$,
  'pm: open -> closing');
select lives_ok(
  $$ select public.set_accounting_period_status(date '2026-07-01', 'closed') $$,
  'pm: closing -> closed');
select throws_ok(
  $$ select public.set_accounting_period_status(date '2026-07-01', 'locked') $$,
  '42501', null, 'pm cannot lock a closed period (super only)');

select lives_ok(
  $$ select public.open_accounting_period(date '2026-08-01') $$,
  'pm opens month B');
select throws_ok(
  $$ select public.set_accounting_period_status(date '2026-08-01', 'closed') $$,
  'P0001', null, 'illegal transition open -> closed is rejected');
select throws_ok(
  $$ select public.set_accounting_period_status(date '2026-10-01', 'closing') $$,
  'P0001', null, 'set status on a never-opened month is rejected');

-- ============================================================================
-- E. resolve_posting_period — the U3 poster seam.
-- ============================================================================
select lives_ok(
  $$ select public.resolve_posting_period(date '2026-08-20') $$,
  'resolves an OPEN month (B) to its period id');
select lives_ok(
  $$ select public.resolve_posting_period(date '2026-09-10') $$,
  'auto-opens a missing month (C)');
select throws_ok(
  $$ select public.resolve_posting_period(date '2026-07-10') $$,
  'P0002', null, 'refuses to resolve a CLOSED month (A)');

-- ============================================================================
-- F. super_admin locks the closed period.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330468"}';
select lives_ok(
  $$ select public.set_accounting_period_status(date '2026-07-01', 'locked') $$,
  'super_admin: closed -> locked');

-- ============================================================================
-- G. Effects + audit (reset to owner to read past the zero-grant posture).
-- ============================================================================
reset role;
select is(
  (select count(*) from public.audit_log where action = 'accounting_period_open'),
  2::bigint, 'two accounting_period_open audit rows (A + B; idempotent + auto-open do not audit)');
select is(
  (select count(*) from public.audit_log where action = 'accounting_period_status_change'),
  3::bigint, 'three status-change audit rows (A: closing, closed, locked)');
select is(
  (select count(*) from public.accounting_periods where period_month = date '2026-09-01'),
  1::bigint, 'month C was auto-opened by resolve_posting_period');
select is(
  (select status from public.accounting_periods where period_month = date '2026-07-01'),
  'locked'::public.accounting_period_status, 'month A is locked');
select is(
  (select status from public.accounting_periods where period_month = date '2026-09-01'),
  'open'::public.accounting_period_status, 'the auto-opened month C is open');

-- ============================================================================
-- H. Anon denied entirely.
-- ============================================================================
set local role anon;
select throws_ok(
  $$ select id from public.accounting_periods limit 1 $$,
  '42501', null, 'anon cannot read accounting_periods');

reset role;
select * from finish();
rollback;
