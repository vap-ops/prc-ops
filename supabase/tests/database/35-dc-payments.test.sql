begin;
select plan(21);

-- ============================================================================
-- Spec 127 U1 — dc_payments ledger + record_dc_payment RPC.
-- Pins: catalog/RLS, the zero-grant money posture (no authenticated
-- read/write), the append-only trigger (UPDATE/DELETE → P0001), and the RPC
-- (pm/super only; site_admin AND visitor refused 42501; computed_amount/days
-- recomputed from CURRENT DC labor logs in-window — superseded, tombstone,
-- own-type and out-of-window rows all excluded; exactly one dc_payment_recorded
-- audit row; contractor-existence guard; one-payment-per-(contractor,period)).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110127', 'pm@dcpay.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220127', 'sa@dcpay.local', '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330127', 'vi@dcpay.local', '{}'::jsonb);
update public.users set role = 'project_manager' where id = '11111111-1111-1111-1111-111111110127';
update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-222222220127';
-- third user stays visitor

insert into public.projects (id, code, name) values
  ('cc000001-0000-4000-8000-000000000127', 'TAP-DCPAY', 'DC payment fixture');
insert into public.work_packages (id, project_id, code, name, status) values
  ('ee000001-0000-4000-8000-000000000127',
   'cc000001-0000-4000-8000-000000000127', 'WP-DCP-1', 'Open WP', 'in_progress');

insert into public.contractors (id, name, created_by) values
  ('dd000001-0000-4000-8000-000000000127', 'DC Crew',
   '11111111-1111-1111-1111-111111110127');

insert into public.workers (id, name, worker_type, contractor_id, user_id,
                            day_rate, active, created_by) values
  ('aa000001-0000-4000-8000-000000000127', 'DC W1', 'dc',
   'dd000001-0000-4000-8000-000000000127', null, 380.00, true,
   '11111111-1111-1111-1111-111111110127'),
  ('aa000002-0000-4000-8000-000000000127', 'Own W2', 'own', null, null,
   500.00, true, '11111111-1111-1111-1111-111111110127');

-- Labor logs for contractor DC-1 across June (window 06-01..06-30). The RPC
-- recompute must keep ONLY the current, non-tombstone, DC, in-window rows:
--   L1 06-05 full          -> 1.0 day, 380   (current, kept)
--   L2 06-06 full          -> superseded by L3 (dropped)
--   L3 06-06 half          -> 0.5 day, 190   (current, kept)
--   L5 06-08 full          -> superseded by L6 tombstone (dropped)
--   L6 06-08 tombstone      -> day_fraction NULL (dropped)
--   L7 06-09 full OWN       -> excluded (worker_type own)
--   L8 07-05 full DC        -> excluded (out of window)
-- Expected: computed_days = 1.5, computed_amount = 570.00.
insert into public.labor_logs (id, work_package_id, worker_id, work_date,
    day_fraction, day_rate_snapshot, worker_name_snapshot,
    worker_type_snapshot, contractor_id_snapshot, entered_by) values
  ('fa000001-0000-4000-8000-000000000127', 'ee000001-0000-4000-8000-000000000127',
   'aa000001-0000-4000-8000-000000000127', date '2026-06-05', 'full', 380.00,
   'DC W1', 'dc', 'dd000001-0000-4000-8000-000000000127',
   '11111111-1111-1111-1111-111111110127'),
  ('fa000002-0000-4000-8000-000000000127', 'ee000001-0000-4000-8000-000000000127',
   'aa000001-0000-4000-8000-000000000127', date '2026-06-06', 'full', 380.00,
   'DC W1', 'dc', 'dd000001-0000-4000-8000-000000000127',
   '11111111-1111-1111-1111-111111110127'),
  ('fa000005-0000-4000-8000-000000000127', 'ee000001-0000-4000-8000-000000000127',
   'aa000001-0000-4000-8000-000000000127', date '2026-06-08', 'full', 380.00,
   'DC W1', 'dc', 'dd000001-0000-4000-8000-000000000127',
   '11111111-1111-1111-1111-111111110127'),
  ('fa000007-0000-4000-8000-000000000127', 'ee000001-0000-4000-8000-000000000127',
   'aa000002-0000-4000-8000-000000000127', date '2026-06-09', 'full', 500.00,
   'Own W2', 'own', null, '11111111-1111-1111-1111-111111110127'),
  ('fa000008-0000-4000-8000-000000000127', 'ee000001-0000-4000-8000-000000000127',
   'aa000001-0000-4000-8000-000000000127', date '2026-07-05', 'full', 380.00,
   'DC W1', 'dc', 'dd000001-0000-4000-8000-000000000127',
   '11111111-1111-1111-1111-111111110127');
-- L3 corrects L2 (full -> half); L6 tombstones L5 (remove).
insert into public.labor_logs (id, work_package_id, worker_id, work_date,
    day_fraction, day_rate_snapshot, worker_name_snapshot,
    worker_type_snapshot, contractor_id_snapshot, entered_by,
    superseded_by, correction_reason) values
  ('fa000003-0000-4000-8000-000000000127', 'ee000001-0000-4000-8000-000000000127',
   'aa000001-0000-4000-8000-000000000127', date '2026-06-06', 'half', 380.00,
   'DC W1', 'dc', 'dd000001-0000-4000-8000-000000000127',
   '11111111-1111-1111-1111-111111110127',
   'fa000002-0000-4000-8000-000000000127', 'แก้เป็นครึ่งวัน'),
  ('fa000006-0000-4000-8000-000000000127', 'ee000001-0000-4000-8000-000000000127',
   'aa000001-0000-4000-8000-000000000127', date '2026-06-08', null, 380.00,
   'DC W1', 'dc', 'dd000001-0000-4000-8000-000000000127',
   '11111111-1111-1111-1111-111111110127',
   'fa000005-0000-4000-8000-000000000127', 'ลบรายการ');

-- A directly-seeded payment (distinct May period) for the append-only trigger
-- probe — the RPC tests use the June period and never collide with this row.
insert into public.dc_payments (id, contractor_id, period_from, period_to,
    computed_amount, computed_days, paid_amount, paid_at, method, paid_by) values
  ('bb000001-0000-4000-8000-000000000127',
   'dd000001-0000-4000-8000-000000000127', date '2026-05-01', date '2026-05-31',
   100.00, 1.0, 100.00, date '2026-06-01', 'cash',
   '11111111-1111-1111-1111-111111110127');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Catalog + posture.
-- ============================================================================
select has_table('public', 'dc_payments', 'dc_payments exists');
select col_is_pk('public', 'dc_payments', 'id', 'id is the PK');
select ok(
  (select relrowsecurity from pg_class where oid = 'public.dc_payments'::regclass),
  'RLS enabled on dc_payments');
select is(
  (select count(*) from pg_policies
    where schemaname = 'public' and tablename = 'dc_payments'),
  0::bigint, 'dc_payments has no policies (zero grant — RPC/admin only)');
select enum_has_labels(
  'public', 'dc_payment_method',
  array['bank_transfer', 'cash', 'cheque'],
  'dc_payment_method enum labels');

-- ============================================================================
-- B. Money posture: authenticated cannot read or write the ledger.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220127"}';

select throws_ok(
  $$ select paid_amount from public.dc_payments limit 1 $$,
  '42501', null, 'authenticated cannot read dc_payments (zero grant)');
select throws_ok(
  $$ insert into public.dc_payments (contractor_id, period_from, period_to,
       computed_amount, computed_days, paid_amount, paid_at, method, paid_by)
     values ('dd000001-0000-4000-8000-000000000127', '2026-06-01', '2026-06-30',
             1, 1, 1, '2026-06-30', 'cash', '22222222-2222-2222-2222-222222220127') $$,
  '42501', null, 'authenticated cannot INSERT dc_payments directly');

-- ============================================================================
-- C. Append-only: UPDATE and DELETE are blocked even for a privileged owner.
-- ============================================================================
reset role;
select throws_ok(
  $$ update public.dc_payments set paid_amount = 1
       where id = 'bb000001-0000-4000-8000-000000000127' $$,
  'P0001', null, 'dc_payments UPDATE is blocked (append-only trigger)');
select throws_ok(
  $$ delete from public.dc_payments
       where id = 'bb000001-0000-4000-8000-000000000127' $$,
  'P0001', null, 'dc_payments DELETE is blocked (append-only trigger)');

-- ============================================================================
-- D. RPC role gate: site_admin refused (money), visitor refused.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220127"}';
select throws_ok(
  $$ select public.record_dc_payment('dd000001-0000-4000-8000-000000000127',
       '2026-06-01', '2026-06-30', 570, '2026-06-30', 'bank_transfer', null, null) $$,
  '42501', null, 'record_dc_payment refuses site_admin');

set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330127"}';
select throws_ok(
  $$ select public.record_dc_payment('dd000001-0000-4000-8000-000000000127',
       '2026-06-01', '2026-06-30', 570, '2026-06-30', 'bank_transfer', null, null) $$,
  '42501', null, 'record_dc_payment refuses visitor');

-- ============================================================================
-- E. RPC happy path (project_manager). paid_amount (5000) deliberately differs
--    from the recomputed owed (570) — a partial/adjusted pay is allowed.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110127"}';
select lives_ok(
  $$ select public.record_dc_payment('dd000001-0000-4000-8000-000000000127',
       '2026-06-01', '2026-06-30', 5000, '2026-06-30', 'bank_transfer', '  TXN-1  ', null) $$,
  'project_manager records a DC payment');

reset role;
select is(
  (select computed_amount from public.dc_payments
    where contractor_id = 'dd000001-0000-4000-8000-000000000127'
      and period_from = '2026-06-01' and period_to = '2026-06-30'),
  570.00, 'computed_amount = current DC in-window (380 + half 190)');
select is(
  (select computed_days from public.dc_payments
    where contractor_id = 'dd000001-0000-4000-8000-000000000127'
      and period_from = '2026-06-01' and period_to = '2026-06-30'),
  1.5, 'computed_days = 1.5 (superseded/tombstone/own/out-of-window excluded)');
select is(
  (select paid_amount from public.dc_payments
    where contractor_id = 'dd000001-0000-4000-8000-000000000127'
      and period_from = '2026-06-01' and period_to = '2026-06-30'),
  5000.00, 'paid_amount = what the PM actually paid (may differ from computed)');
select is(
  (select paid_by from public.dc_payments
    where contractor_id = 'dd000001-0000-4000-8000-000000000127'
      and period_from = '2026-06-01' and period_to = '2026-06-30'),
  '11111111-1111-1111-1111-111111110127'::uuid, 'paid_by = the PM actor');
select is(
  (select reference from public.dc_payments
    where contractor_id = 'dd000001-0000-4000-8000-000000000127'
      and period_from = '2026-06-01' and period_to = '2026-06-30'),
  'TXN-1', 'reference is trimmed (nullif(btrim(...)))');
select is(
  (select count(*) from public.audit_log
    where action = 'dc_payment_recorded'
      and (payload->>'contractor_id')::uuid = 'dd000001-0000-4000-8000-000000000127'),
  1::bigint, 'exactly one dc_payment_recorded audit row');
select is(
  (select (payload->>'computed_amount')::numeric from public.audit_log
    where action = 'dc_payment_recorded'
      and (payload->>'contractor_id')::uuid = 'dd000001-0000-4000-8000-000000000127'),
  570.00, 'audit payload carries the recomputed owed');

-- ============================================================================
-- F. RPC guards: duplicate exact period, and unknown contractor.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110127"}';
select throws_ok(
  $$ select public.record_dc_payment('dd000001-0000-4000-8000-000000000127',
       '2026-06-01', '2026-06-30', 570, '2026-06-30', 'bank_transfer', null, null) $$,
  'P0001', null, 'duplicate payment for the same contractor+period is refused');
select throws_ok(
  $$ select public.record_dc_payment('dd000099-0000-4000-8000-000000000099',
       '2026-06-01', '2026-06-30', 570, '2026-06-30', 'bank_transfer', null, null) $$,
  'P0001', null, 'record_dc_payment refuses an unknown contractor');

select * from finish();
rollback;
