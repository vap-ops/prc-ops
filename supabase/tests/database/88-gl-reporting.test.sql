begin;
select plan(16);

-- ============================================================================
-- Spec 149 U7 / ADR 0057 dec 6+11 — gl_trial_balance + gl_reconciliation.
-- Scenario: one certified billing (gross 100000 → AR 99000, retention 5000,
-- WHT-prepaid 3000, revenue 100000, output VAT 7000) drained to the GL. Then the
-- trial balance must balance, the single-feeder control accounts must tie, and the
-- posting backlog must be 0. pm/super gate; site_admin refused.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110648', 'pm@report.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220648', 'sa@report.local', '{}'::jsonb);
insert into auth.users (id, email, raw_user_meta_data) values
  ('33333333-3333-3333-3333-333333330648', 'acct@report.local', '{}'::jsonb);
update public.users set role = 'project_manager' where id = '11111111-1111-1111-1111-111111110648';
update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-222222220648';
update public.users set role = 'accounting'       where id = '33333333-3333-3333-3333-333333330648';

insert into public.clients (id, name, created_by) values
  ('c1000001-0000-4000-8000-000000000648', 'Report Client', '11111111-1111-1111-1111-111111110648');
insert into public.projects (id, code, name, client_id) values
  ('cc000001-0000-4000-8000-000000000648', 'TAP-GL-RPT', 'Reporting fixture',
   'c1000001-0000-4000-8000-000000000648');

-- Isolate from any pre-existing prod gl_posting_outbox rows: the posting_backlog
-- reconciliation check below asserts a globally-empty pending queue, so a real
-- in-flight job would trip it. Owner context here; rolled back with the test.
delete from public.gl_posting_outbox;

-- Capture the pre-fixture retention-control (1210) GL balance. gl_reconciliation
-- reports a GLOBAL control value over an unpruned ledger, so the fixture's effect
-- is asserted below as a DELTA (after − before = 5000), not an absolute total.
create temp table _tap_1210_pre as
  select coalesce(sum(l.debit) - sum(l.credit), 0)::numeric as bal
    from public.journal_lines l
    join public.gl_accounts a on a.id = l.account_id
   where a.code = '1210';
grant select on _tap_1210_pre to authenticated;

-- ============================================================================
-- A. Catalog.
-- ============================================================================
select has_function('public', 'gl_trial_balance', 'gl_trial_balance exists');
select has_function('public', 'gl_reconciliation', 'gl_reconciliation exists');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- B. Gate (site_admin refused).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220648"}';
select throws_ok($$ select * from public.gl_trial_balance(date '2026-01-01', date '2027-12-31') $$,
  '42501', null, 'gl_trial_balance refuses site_admin');
select throws_ok($$ select * from public.gl_reconciliation() $$,
  '42501', null, 'gl_reconciliation refuses site_admin');

-- Spec 149 U9: the accounting role is admitted to both reporting RPCs.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330648"}';
select lives_ok($$ select * from public.gl_trial_balance(date '2026-01-01', date '2027-12-31') $$,
  'gl_trial_balance admits the accounting role');
select lives_ok($$ select * from public.gl_reconciliation() $$,
  'gl_reconciliation admits the accounting role');

-- ============================================================================
-- Build data: a certified billing, drained.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110648"}';
select public.create_client_billing('cc000001-0000-4000-8000-000000000648', 100000);
reset role;
create temp table _tap_rb as
  select id from public.client_billings where project_id = 'cc000001-0000-4000-8000-000000000648';
grant select on _tap_rb to authenticated;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110648"}';
select public.certify_client_billing((select id from _tap_rb));
reset role;
select public.drain_gl_posting(100);

-- ============================================================================
-- C. Trial balance (pm).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110648"}';
select is(
  (select sum(debit_total) from public.gl_trial_balance(date '2026-01-01', date '2027-12-31')),
  (select sum(credit_total) from public.gl_trial_balance(date '2026-01-01', date '2027-12-31')),
  'trial balance balances (Σdebit = Σcredit)');
-- Project-scoped so prod revenue/retention in OTHER projects can't inflate these
-- (the billing poster stamps project_id on every line). The fixture project holds
-- exactly this one billing.
select is(
  (select credit_total from public.gl_trial_balance(
     date '2026-01-01', date '2027-12-31', 'cc000001-0000-4000-8000-000000000648') where code = '4100'),
  100000::numeric, 'Revenue (4100) credit total = 100000 (project-scoped)');
select is(
  (select debit_total from public.gl_trial_balance(
     date '2026-01-01', date '2027-12-31', 'cc000001-0000-4000-8000-000000000648') where code = '1210'),
  5000::numeric, 'Retention receivable (1210) debit total = 5000 (project-scoped)');

-- ============================================================================
-- D. Reconciliation (pm).
-- ============================================================================
select is((select ok from public.gl_reconciliation() where check_name = 'trial_balance_balanced'),
  true, 'global trial balance reconciles');
select is(
  (select gl_value from public.gl_reconciliation() where check_name = 'retention_receivable_1210')
    - (select bal from _tap_1210_pre),
  5000::numeric, 'the fixture raises the retention 1210 control by exactly 5000 (delta)');
select is((select ok from public.gl_reconciliation() where check_name = 'retention_receivable_1210'),
  true, 'retention 1210 ties to its subledger');
select is((select ok from public.gl_reconciliation() where check_name = 'output_vat_2200'),
  true, 'output VAT 2200 ties to certified billings');
select is((select ok from public.gl_reconciliation() where check_name = 'wht_prepaid_1310'),
  true, 'WHT prepaid 1310 ties to certified billings');
select is((select ok from public.gl_reconciliation() where check_name = 'posting_backlog'),
  true, 'no posting backlog (all drained)');

-- ============================================================================
-- E. Project-scoped trial balance (P&L building block).
-- ============================================================================
select is(
  (select credit_total from public.gl_trial_balance(
     date '2026-01-01', date '2027-12-31', 'cc000001-0000-4000-8000-000000000648') where code = '4100'),
  100000::numeric, 'project-scoped trial balance carries the revenue');

reset role;
select * from finish();
rollback;
