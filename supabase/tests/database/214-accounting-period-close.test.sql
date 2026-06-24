begin;
select plan(9);

-- ============================================================================
-- Spec 196 Tier 4 — the accounting role may run month-end close. The period
-- engine (ADR 0057) already exists; this pins that 'accounting' joins the gate
-- of open_accounting_period + set_accounting_period_status (alongside pm/super/
-- project_director) for open -> closing -> closed, but the super-only arm holds
-- (accounting may NOT reopen or lock a closed period). Also re-pins the
-- project_director arm (guards the CREATE-OR-REPLACE-drops-a-later-arm trap) and
-- that a non-privileged role (site_admin) is still refused.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110214', 'acct@periodclose.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220214', 'pd@periodclose.local',   '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330214', 'sa@periodclose.local',   '{}'::jsonb);
update public.users set role = 'accounting'        where id = '11111111-1111-1111-1111-111111110214';
update public.users set role = 'project_director'  where id = '22222222-2222-2222-2222-222222220214';
update public.users set role = 'site_admin'        where id = '33333333-3333-3333-3333-333333330214';

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

set local role authenticated;

-- ============================================================================
-- A. accounting runs the close: open -> closing -> closed.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110214"}';
select lives_ok(
  $$ select public.open_accounting_period(date '2027-01-01') $$,
  'accounting opens a period');
select lives_ok(
  $$ select public.set_accounting_period_status(date '2027-01-01', 'closing') $$,
  'accounting: open -> closing');
select lives_ok(
  $$ select public.set_accounting_period_status(date '2027-01-01', 'closed') $$,
  'accounting: closing -> closed');

-- The super-only arm holds: accounting may neither lock nor reopen a closed month.
select throws_ok(
  $$ select public.set_accounting_period_status(date '2027-01-01', 'locked') $$,
  '42501', null, 'accounting cannot lock a closed period (super only)');
select throws_ok(
  $$ select public.set_accounting_period_status(date '2027-01-01', 'open') $$,
  '42501', null, 'accounting cannot reopen a closed period (super only)');

-- ============================================================================
-- B. project_director arm preserved (regression pin against the re-source trap).
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220214"}';
select lives_ok(
  $$ select public.open_accounting_period(date '2027-02-01') $$,
  'project_director still opens a period');
select lives_ok(
  $$ select public.set_accounting_period_status(date '2027-02-01', 'closing') $$,
  'project_director: open -> closing');
select lives_ok(
  $$ select public.set_accounting_period_status(date '2027-02-01', 'closed') $$,
  'project_director: closing -> closed');

-- ============================================================================
-- C. A non-privileged role is still refused.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330214"}';
select throws_ok(
  $$ select public.open_accounting_period(date '2027-03-01') $$,
  '42501', null, 'site_admin cannot open a period');

reset role;
select * from finish();
rollback;
