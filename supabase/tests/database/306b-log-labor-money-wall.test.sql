begin;
select plan(8);

-- ============================================================================
-- Spec 306 — log_labor_day money-wall parity with derive_muster_labor.
--
-- The muster's automatic writer refuses a worker unless active AND untied AND
-- cost-confirmed AND day_rate > 0. The MANUAL writer checked only `active`, so
-- every one of those three money gates had an open door.
--
-- Each refusal below is paired with a NEGATIVE CONTROL: the same worker, with
-- only the offending attribute repaired, must then log successfully. Without
-- the pair a refusal assert proves nothing — it stays green if the row is
-- rejected for some unrelated reason (a bad fixture, a missing membership, a
-- guard that fires earlier). The pair is what makes it non-vacuous.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('b306b000-0000-4000-8000-000000000004', 'sa@306b-wall.local', '{}'::jsonb);
update public.users set role = 'site_admin'
 where id = 'b306b000-0000-4000-8000-000000000004';

insert into public.projects (id, code, name) values
  ('b306b000-0000-4000-8000-000000000001', 'TAP-306B', '306b money wall fixture');
insert into public.work_packages (id, project_id, code, name, status) values
  ('b306b000-0000-4000-8000-000000000002',
   'b306b000-0000-4000-8000-000000000001', 'WP-306B-1', 'Open WP', 'in_progress');

insert into public.project_members (project_id, user_id, added_by) values
  ('b306b000-0000-4000-8000-000000000001',
   'b306b000-0000-4000-8000-000000000004',
   'b306b000-0000-4000-8000-000000000004');

insert into public.contractors (id, name, contractor_category, status, created_by) values
  ('b306b000-0000-4000-8000-000000000003', 'ห้างหุ้นส่วน ทดสอบกำแพงเงิน', 'contractor',
   'active', 'b306b000-0000-4000-8000-000000000004');

-- Four workers differing in EXACTLY ONE attribute from the control.
insert into public.workers
  (id, name, pay_type, employment_type, day_rate, active,
   cost_confirmed_at, cost_confirmed_by, contractor_id, created_by) values
  ('b306b000-0000-4000-8000-000000000011', 'คุมได้ (control)', 'daily', 'permanent',
   500.00, true, now(), 'b306b000-0000-4000-8000-000000000004', null,
   'b306b000-0000-4000-8000-000000000004'),
  ('b306b000-0000-4000-8000-000000000012', 'ลูกน้องผู้รับเหมา', 'daily', 'permanent',
   500.00, true, now(), 'b306b000-0000-4000-8000-000000000004',
   'b306b000-0000-4000-8000-000000000003', 'b306b000-0000-4000-8000-000000000004'),
  ('b306b000-0000-4000-8000-000000000013', 'ยังไม่ยืนยันค่าแรง', 'daily', 'permanent',
   500.00, true, null, null, null, 'b306b000-0000-4000-8000-000000000004'),
  ('b306b000-0000-4000-8000-000000000014', 'ค่าแรงเป็นศูนย์', 'daily', 'permanent',
   0, true, now(), 'b306b000-0000-4000-8000-000000000004', null,
   'b306b000-0000-4000-8000-000000000004');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b306b000-0000-4000-8000-000000000004"}';

-- ============================================================================
-- A. The control logs. Everything below differs from it by one attribute.
-- ============================================================================

select ok(
  (select public.log_labor_day('b306b000-0000-4000-8000-000000000002',
     'b306b000-0000-4000-8000-000000000011', date '2026-06-10', 'full')) is not null,
  'an untied, cost-confirmed, rated worker still logs a day');

-- ============================================================================
-- B. The three refusals. Messages are pinned EXACTLY so a different arm firing
--    (or an earlier guard swallowing the case) fails instead of passing.
-- ============================================================================

select throws_ok(
  $$ select public.log_labor_day('b306b000-0000-4000-8000-000000000002',
       'b306b000-0000-4000-8000-000000000012', date '2026-06-10', 'full') $$,
  'P0001', 'log_labor_day: worker is paid by a subcontractor firm',
  'spec 328 §2.4: a contractor-tied worker cannot be logged a daily wage');

select throws_ok(
  $$ select public.log_labor_day('b306b000-0000-4000-8000-000000000002',
       'b306b000-0000-4000-8000-000000000013', date '2026-06-10', 'full') $$,
  'P0001', 'log_labor_day: worker cost is not confirmed',
  'a worker with no cost_confirmed_at cannot be logged');

select throws_ok(
  $$ select public.log_labor_day('b306b000-0000-4000-8000-000000000002',
       'b306b000-0000-4000-8000-000000000014', date '2026-06-10', 'full') $$,
  'P0001', 'log_labor_day: worker day rate is not set',
  'a worker at day_rate 0 cannot be logged (the snapshot would be a permanent ฿0)');

reset role;
select is(
  (select count(*)::int from public.labor_logs
    where worker_id in ('b306b000-0000-4000-8000-000000000012',
                        'b306b000-0000-4000-8000-000000000013',
                        'b306b000-0000-4000-8000-000000000014')),
  0, 'no refused worker left a row behind');

-- ============================================================================
-- C. Negative controls — repair the single offending attribute, and the same
--    call must now succeed. This is what proves each refusal was caused by the
--    guard under test and not by the fixture.
--
--    The date moves to the 11th: labor_logs is append-only with a
--    one-current-entry-per-(wp, worker, date) rule, so re-using the 10th would
--    collide with the row a repaired worker is now allowed to write. Keeping the
--    10th also makes the pre-guard run die on that collision instead of
--    reporting which asserts failed — a file-level ERROR is a worse RED than
--    four named failures.
-- ============================================================================

update public.workers set contractor_id = null
 where id = 'b306b000-0000-4000-8000-000000000012';
update public.workers
   set cost_confirmed_at = now(), cost_confirmed_by = 'b306b000-0000-4000-8000-000000000004'
 where id = 'b306b000-0000-4000-8000-000000000013';
update public.workers set day_rate = 450.00
 where id = 'b306b000-0000-4000-8000-000000000014';

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "b306b000-0000-4000-8000-000000000004"}';

select ok(
  (select public.log_labor_day('b306b000-0000-4000-8000-000000000002',
     'b306b000-0000-4000-8000-000000000012', date '2026-06-10', 'full')) is not null,
  'untying that same worker lets the identical call through (the tie was the blocker)');

select ok(
  (select public.log_labor_day('b306b000-0000-4000-8000-000000000002',
     'b306b000-0000-4000-8000-000000000013', date '2026-06-10', 'full')) is not null,
  'confirming that same worker lets the identical call through');

select ok(
  (select public.log_labor_day('b306b000-0000-4000-8000-000000000002',
     'b306b000-0000-4000-8000-000000000014', date '2026-06-10', 'full')) is not null,
  'setting a rate on that same worker lets the identical call through');

reset role;

select * from finish();
rollback;
