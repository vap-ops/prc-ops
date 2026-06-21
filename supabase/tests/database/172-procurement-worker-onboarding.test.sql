begin;
select plan(19);

-- ============================================================================
-- Spec 172 Phase C / ADR 0062 — procurement onboards DC workers (incl. pay rate).
--
-- Procurement gains full DC onboarding ownership: it may create/update workers,
-- set the day rate, assign to a project, and issue a portal invite — through the
-- SECURITY DEFINER worker RPCs (the zero column-grant on bank/tax/phone/day_rate
-- is bypassed BY the definer on the WRITE path only). The PII isolation on the
-- READ path is unchanged: a raw authenticated SELECT of those columns still 42501
-- for procurement exactly as for any other authenticated user. project_director
-- rides along in every gate (file 91 doctrine).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('70000000-0172-0172-0172-700000000172', 'proc@s172c-test.local', '{}'::jsonb),
  ('71000000-0172-0172-0172-710000000172', 'visitor@s172c-test.local', '{}'::jsonb);

update public.users set role = 'procurement' where id = '70000000-0172-0172-0172-700000000172';
-- '7100…' stays visitor (negative control).

insert into public.projects (id, code, name) values
  ('72000000-0172-0172-0172-720000000172', 'TAP-172C', 'Spec 172C fixture project');

-- DC worker fixture (direct insert as postgres — owner bypasses the zero-grant
-- posture; the app can only reach these columns through the RPCs).
insert into public.workers (id, name, worker_type, contractor_id, user_id,
                            day_rate, active, created_by) values
  ('7d000000-0172-4000-8000-7d0000000172', 'Fixture DC', 'dc', null, null,
   400.00, true, '70000000-0172-0172-0172-700000000172');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Procurement is admitted to every worker-onboarding RPC.
-- ============================================================================

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0172-0172-0172-700000000172"}';

select ok(
  (select public.create_worker('Proc DC', 'dc', 425, p_arrangement => 'regular',
     p_phone => '0812345678', p_tax_id => '1234567890123',
     p_bank_account_number => '9876543210')) is not null,
  'procurement create_worker makes a DC with arrangement + bank + rate');
select lives_ok(
  $$ select public.update_worker('7d000000-0172-4000-8000-7d0000000172',
       p_name => 'Fixture DC (edited)') $$,
  'procurement update_worker edits a DC');
select lives_ok(
  $$ select public.set_worker_day_rate('7d000000-0172-4000-8000-7d0000000172', 480) $$,
  'procurement set_worker_day_rate sets the DC pay rate');
select lives_ok(
  $$ select public.assign_worker_to_project('7d000000-0172-4000-8000-7d0000000172',
       '72000000-0172-0172-0172-720000000172', 'onboarding') $$,
  'procurement assign_worker_to_project assigns a DC to a project');
select ok(
  (select public.create_worker_invite('7d000000-0172-4000-8000-7d0000000172')) is not null,
  'procurement create_worker_invite issues a portal invite token');

-- ============================================================================
-- B. PII isolation preserved — the READ path stays closed for procurement
--    (only the definer WRITE path above opens). Raw authenticated SELECT 42501.
-- ============================================================================

select throws_ok(
  $$ select bank_account_number from public.workers limit 1 $$,
  '42501', null, 'procurement cannot read workers.bank_account_number (isolated)');
select throws_ok(
  $$ select tax_id from public.workers limit 1 $$,
  '42501', null, 'procurement cannot read workers.tax_id (isolated)');
select throws_ok(
  $$ select phone from public.workers limit 1 $$,
  '42501', null, 'procurement cannot read workers.phone (isolated)');
select throws_ok(
  $$ select day_rate from public.workers limit 1 $$,
  '42501', null, 'procurement cannot read workers.day_rate (isolated)');
select lives_ok(
  $$ select dc_arrangement from public.workers limit 1 $$,
  'procurement can read workers.dc_arrangement (granted, non-sensitive)');

-- Negative control — a non-admitted role is still refused (gate did not fall open).
set local "request.jwt.claims" = '{"sub": "71000000-0172-0172-0172-710000000172"}';
select throws_ok(
  $$ select public.create_worker('Rogue', 'own', 400) $$,
  '42501', null, 'visitor is still refused create_worker');

-- ============================================================================
-- C. The definer writes landed (read back as owner after reset role).
-- ============================================================================

reset role;
select is(
  (select bank_account_number from public.workers where name = 'Proc DC'),
  '9876543210', 'procurement create_worker stored the (isolated) bank account number');
select is(
  (select dc_arrangement from public.workers where name = 'Proc DC'),
  'regular'::public.dc_arrangement, 'procurement create_worker stored the dc arrangement');
select is(
  (select phone from public.workers where name = 'Proc DC'),
  '0812345678', 'procurement create_worker stored the (isolated) phone');
select is(
  (select tax_id from public.workers where name = 'Proc DC'),
  '1234567890123', 'procurement create_worker stored the (isolated) tax id');
select is(
  (select day_rate from public.workers where id = '7d000000-0172-4000-8000-7d0000000172'),
  480.00, 'procurement set_worker_day_rate landed the new rate');
select is(
  (select project_id from public.workers where id = '7d000000-0172-4000-8000-7d0000000172'),
  '72000000-0172-0172-0172-720000000172'::uuid,
  'procurement assign_worker_to_project set the project');
select is(
  (select count(*)::int from public.worker_project_moves
    where worker_id = '7d000000-0172-4000-8000-7d0000000172'
      and project_id = '72000000-0172-0172-0172-720000000172'),
  1, 'assign wrote an append-only worker_project_moves row');
select ok(
  (select count(*) from public.audit_log
    where action = 'worker_change' and target_table = 'workers') >= 4,
  'procurement worker RPCs wrote audit rows (create + update + rate + assign)');

select * from finish();
rollback;
