begin;
select plan(14);

-- ============================================================================
-- Spec 314 U3 / ADR 0082 — technicians default to daily pay; day_rate is
-- derived from the firm level-standard at confirm_worker_cost (stored GROSS);
-- the firm WHT % is FROZEN per labor_logs row at log time so a later config
-- change never restates a worked day.
-- Pins: pay_type column default; wht_pct_snapshot zero-grant money col;
-- confirm derivation (present + unset-standard keep); log snapshot; correction
-- copies the ORIGINAL snapshot.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('31400000-0000-4000-8000-000000000001', 'sa314@t.local', '{}'::jsonb),
  ('31400000-0000-4000-8000-000000000002', 'admin314@t.local', '{}'::jsonb);
update public.users set role = 'super_admin' where id = '31400000-0000-4000-8000-000000000001';
update public.users set role = 'site_admin'  where id = '31400000-0000-4000-8000-000000000002';

insert into public.projects (id, code, name) values
  ('31400000-0000-4000-8000-0000000000c1', 'TAP-314U3', 'U3 fixture project');
insert into public.work_packages (id, project_id, code, name, status) values
  ('31400000-0000-4000-8000-0000000000e1',
   '31400000-0000-4000-8000-0000000000c1', 'WP-314U3', 'Open WP', 'in_progress');
-- Enrol the site_admin so the membership-scoped labor SELECTs see the rows.
insert into public.project_members (project_id, user_id, added_by)
  values ('31400000-0000-4000-8000-0000000000c1',
          '31400000-0000-4000-8000-000000000002',
          '31400000-0000-4000-8000-000000000002')
on conflict (project_id, user_id) do nothing;

-- Level standard: mid = 800 GROSS (before_wht); apprentice stays unset (NULL).
update public.worker_level_rates set entered_rate = 800, wht_basis = 'before_wht' where level = 'mid';
update public.worker_level_rates set entered_rate = null where level = 'apprentice';
-- Firm WHT %: 3.00 (U1 seed; set explicitly so this test is self-contained).
update public.labor_wht_config set wht_pct = 3.00 where id = true;

-- Workers (owner insert — bypasses the zero-grant posture; app uses the RPCs).
insert into public.workers (id, name, pay_type, employment_type, day_rate, active, created_by) values
  ('31400000-0000-4000-8000-0000000000a1', 'W1 derive', 'daily', 'permanent', 500, true,
   '31400000-0000-4000-8000-000000000001'),
  ('31400000-0000-4000-8000-0000000000a2', 'W2 keep', 'daily', 'permanent', 500, true,
   '31400000-0000-4000-8000-000000000001');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- (A) workers.pay_type column default is now 'daily' (omit it on insert).
insert into public.workers (id, name, employment_type, day_rate, active, created_by) values
  ('31400000-0000-4000-8000-0000000000a3', 'W3 default', 'permanent', 400, true,
   '31400000-0000-4000-8000-000000000001');
select is(
  (select pay_type from public.workers where id = '31400000-0000-4000-8000-0000000000a3'),
  'daily'::public.pay_type, 'workers.pay_type defaults to daily (A)');

-- (F-schema) the frozen-WHT snapshot column exists.
select has_column('public', 'labor_logs', 'wht_pct_snapshot',
  'labor_logs.wht_pct_snapshot exists');

-- (F) it is a money-adjacent column: authenticated cannot read it (zero-grant).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "31400000-0000-4000-8000-000000000002"}';
select throws_ok(
  $$ select wht_pct_snapshot from public.labor_logs limit 1 $$,
  '42501', null, 'authenticated cannot read labor_logs.wht_pct_snapshot (zero-grant, F)');
-- Positive control: a non-money column IS readable — proves the denial above is
-- column-scoped, not a whole-table lockout.
select lives_ok(
  $$ select work_package_id from public.labor_logs limit 1 $$,
  'authenticated CAN read labor_logs.work_package_id (column-scoped grant, F)');
reset role;

-- (B) confirm_worker_cost derives day_rate from the mid standard (gross 800).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "31400000-0000-4000-8000-000000000001"}';
select lives_ok(
  $$ select public.confirm_worker_cost('31400000-0000-4000-8000-0000000000a1', 'mid') $$,
  'super_admin confirms W1 cost at mid');
reset role;
select is(
  (select day_rate from public.workers where id = '31400000-0000-4000-8000-0000000000a1'),
  800.00, 'confirm_worker_cost set day_rate to the mid level-standard gross (B)');

-- (C) confirm at a level whose standard is unset keeps the prior day_rate.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "31400000-0000-4000-8000-000000000001"}';
select lives_ok(
  $$ select public.confirm_worker_cost('31400000-0000-4000-8000-0000000000a2', 'apprentice') $$,
  'super_admin confirms W2 at apprentice (rate unset)');
reset role;
select is(
  (select day_rate from public.workers where id = '31400000-0000-4000-8000-0000000000a2'),
  500.00, 'confirm_worker_cost keeps prior day_rate when the level standard is unset (C)');

-- (B2) confirm at an AFTER_WHT level stores the GROSSED-UP value, not the entered
-- net (junior 970 net @ 3% → 970/0.97 = 1000 gross). Proves confirm composes with
-- level_gross_rate's gross-up, not just the trivial before_wht identity. (Firm % is
-- still 3.00 here — the E block below changes it.)
update public.worker_level_rates set entered_rate = 970, wht_basis = 'after_wht' where level = 'junior';
insert into public.workers (id, name, pay_type, employment_type, day_rate, active, created_by) values
  ('31400000-0000-4000-8000-0000000000a4', 'W4 after-wht', 'daily', 'permanent', 500, true,
   '31400000-0000-4000-8000-000000000001');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "31400000-0000-4000-8000-000000000001"}';
select lives_ok(
  $$ select public.confirm_worker_cost('31400000-0000-4000-8000-0000000000a4', 'junior') $$,
  'super_admin confirms W4 at junior (after_wht)');
reset role;
select is(
  (select day_rate from public.workers where id = '31400000-0000-4000-8000-0000000000a4'),
  1000.00, 'confirm_worker_cost stores the GROSSED-UP after_wht value (970/0.97=1000, B2)');

-- (D) log_labor_day freezes the firm WHT % into the row (3.00).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "31400000-0000-4000-8000-000000000002"}';
select ok(
  (select public.log_labor_day('31400000-0000-4000-8000-0000000000e1',
     '31400000-0000-4000-8000-0000000000a1', date '2026-06-10', 'full')) is not null,
  'site_admin logs a day for W1');
reset role;
select is(
  (select wht_pct_snapshot from public.labor_logs
    where worker_id = '31400000-0000-4000-8000-0000000000a1' and work_date = date '2026-06-10'),
  3.00, 'log_labor_day snapshots the firm WHT % at log time (D)');

-- (E) after the firm % changes to 5.00, a correction COPIES the original 3.00.
update public.labor_wht_config set wht_pct = 5.00 where id = true;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "31400000-0000-4000-8000-000000000002"}';
select ok(
  (select public.correct_labor_log(
     (select id from public.labor_logs
       where worker_id = '31400000-0000-4000-8000-0000000000a1'
         and work_date = date '2026-06-10' and superseded_by is null),
     'แก้เป็นครึ่งวัน', p_fraction => 'half')) is not null,
  'correction supersedes the D row');
reset role;
select is(
  (select wht_pct_snapshot from public.labor_logs
    where worker_id = '31400000-0000-4000-8000-0000000000a1'
      and work_date = date '2026-06-10' and correction_reason is not null),
  3.00, 'correct_labor_log copies the ORIGINAL wht snapshot, not the changed firm % (E)');

select * from finish();
rollback;
