begin;
select plan(6);

-- ============================================================================
-- Spec 187 — procurement gains project-director parity on the DC payroll surface
-- (view + PAY). This pins the ONLY DB change: record_dc_payment's role gate now
-- admits 'procurement' (migration 20260811000000). Negative controls (site_admin
-- + visitor still 42501) prove the money gate did not widen further (migration
-- 20260811000000). Director's own ride-along is pinned by file 90; PM happy path
-- by file 35 — not re-proven here.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('44444444-4444-4444-4444-444444440187', 'proc@pay187.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220187', 'sa@pay187.local',   '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330187', 'vi@pay187.local',   '{}'::jsonb);
update public.users set role = 'procurement' where id = '44444444-4444-4444-4444-444444440187';
update public.users set role = 'site_admin'  where id = '22222222-2222-2222-2222-222222220187';
-- third user stays visitor

insert into public.projects (id, code, name) values
  ('cc000001-0000-4000-8000-000000000187', 'TAP-PAY187', 'Payroll procurement fixture');
insert into public.work_packages (id, project_id, code, name, status) values
  ('ee000001-0000-4000-8000-000000000187',
   'cc000001-0000-4000-8000-000000000187', 'WP-PAY187', 'Open WP', 'in_progress');

-- One directly-hired DC worker (ADR 0062) with one full in-window labor day.
insert into public.workers (id, name, worker_type, contractor_id, user_id,
                            day_rate, active, created_by, dc_arrangement) values
  ('aa000001-0000-4000-8000-000000000187', 'DC W1', 'dc', null, null, 380.00,
   true, '44444444-4444-4444-4444-444444440187', 'regular');

insert into public.labor_logs (id, work_package_id, worker_id, work_date,
    day_fraction, day_rate_snapshot, worker_name_snapshot,
    worker_type_snapshot, contractor_id_snapshot, entered_by) values
  ('fa000001-0000-4000-8000-000000000187', 'ee000001-0000-4000-8000-000000000187',
   'aa000001-0000-4000-8000-000000000187', date '2026-06-05', 'full', 380.00,
   'DC W1', 'dc', null, '44444444-4444-4444-4444-444444440187');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Negative controls — the money gate did not widen beyond procurement.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220187"}';
select throws_ok(
  $$ select public.record_dc_payment('aa000001-0000-4000-8000-000000000187',
       '2026-06-01', '2026-06-30', 380, '2026-06-30', 'bank_transfer', null, null) $$,
  '42501', null, 'record_dc_payment still refuses site_admin (money surface)');

set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330187"}';
select throws_ok(
  $$ select public.record_dc_payment('aa000001-0000-4000-8000-000000000187',
       '2026-06-01', '2026-06-30', 380, '2026-06-30', 'bank_transfer', null, null) $$,
  '42501', null, 'record_dc_payment still refuses visitor');

-- ============================================================================
-- B. The spec-187 arm — procurement may now record a DC payment.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "44444444-4444-4444-4444-444444440187"}';
select lives_ok(
  $$ select public.record_dc_payment('aa000001-0000-4000-8000-000000000187',
       '2026-06-01', '2026-06-30', 380, '2026-06-30', 'bank_transfer', null, null) $$,
  'procurement records a DC payment (spec 187 parity)');

reset role;
select is(
  (select paid_by from public.dc_payments
    where worker_id = 'aa000001-0000-4000-8000-000000000187'
      and period_from = '2026-06-01' and period_to = '2026-06-30'),
  '44444444-4444-4444-4444-444444440187'::uuid, 'paid_by = the procurement actor');
select is(
  (select computed_amount from public.dc_payments
    where worker_id = 'aa000001-0000-4000-8000-000000000187'
      and period_from = '2026-06-01' and period_to = '2026-06-30'),
  380.00, 'computed_amount recomputed from the current DC labor log (one full day)');
select is(
  (select actor_role from public.audit_log
    where action = 'dc_payment_recorded'
      and (payload->>'worker_id')::uuid = 'aa000001-0000-4000-8000-000000000187'),
  'procurement'::user_role, 'audit row records the procurement actor_role');

select * from finish();
rollback;
