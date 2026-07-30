begin;
select plan(18);

-- ============================================================================
-- Spec 379 U1 — muster_undo_scan: retract ONE worker's muster check-in.
--
-- Of the seven muster RPCs none offered a per-worker retraction, so a mis-scan
-- could only be MOVED to another team or CHECKED OUT — neither of which says
-- "this did not happen". The SA had been forcing corrections through
-- move_muster_worker (13x since 2026-07-19).
--
-- The row is DELETED (muster_attendance has no triggers and is not append-only)
-- but only AFTER the whole row is written into the append-only audit_log, so
-- the trace outlives the record. Guards, each with its own SQLSTATE:
--   42501 role gate (parity with muster_scan_in) + can_see_project
--   P0001 no such (worker, date, session)
--   P0001 the day is CLOSED (closing books wages)
--   P0001 a CURRENT labor_logs row points at the attendance — note the
--         anti-join: a SUPERSEDED (tombstoned) derived row must NOT block, or
--         a day that was derived then retracted would be frozen forever
--   P0001 undoing `regular` while an `ot` session exists (OT is defined as
--         continuing the regular session on the same team)
-- ============================================================================

-- Assertions below fire while `set local role authenticated` is in effect, and
-- the runner's collector table is owned by postgres — without these the whole
-- file dies with 42501 on _tap_buf (the documented role-switch trap). Same for
-- the id-carrier: it is read inside authenticated blocks.
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

create temp table _ids (k text primary key, id uuid);
grant select, insert on _ids to authenticated, anon;

insert into auth.users (id, email, raw_user_meta_data) values
  ('70000000-0379-0379-0379-700000000379', 'sa-mem@s379.local',  '{}'::jsonb),
  ('71000000-0379-0379-0379-710000000379', 'sa-none@s379.local', '{}'::jsonb),
  ('75000000-0379-0379-0379-750000000379', 'super@s379.local',   '{}'::jsonb),
  ('72000000-0379-0379-0379-720000000379', 'visitor@s379.local', '{}'::jsonb),
  ('74000000-0379-0379-0379-740000000379', 'tech@s379.local',    '{}'::jsonb);
update public.users set role = 'site_admin'  where id = '70000000-0379-0379-0379-700000000379';
update public.users set role = 'site_admin'  where id = '71000000-0379-0379-0379-710000000379';
update public.users set role = 'super_admin' where id = '75000000-0379-0379-0379-750000000379';
update public.users set role = 'technician'  where id = '74000000-0379-0379-0379-740000000379';

insert into public.projects (id, code, name) values
  ('a1000000-0379-0379-0379-a10000000379', 'TAP-379A', 'โครงการทดสอบยกเลิกเช็คชื่อ');
insert into public.project_members (project_id, user_id, added_by) values
  ('a1000000-0379-0379-0379-a10000000379', '70000000-0379-0379-0379-700000000379',
   '75000000-0379-0379-0379-750000000379');

insert into public.workers (id, name, pay_type, employment_type, day_rate, active, created_by) values
  ('e1000000-0379-0379-0379-e10000000379', 'หัวหน้า สามเจ็ดเก้า', 'daily', 'temporary', 400, true,
   '75000000-0379-0379-0379-750000000379'),
  ('e2000000-0379-0379-0379-e20000000379', 'ลูกทีม หนึ่ง', 'daily', 'temporary', 400, true,
   '75000000-0379-0379-0379-750000000379'),
  ('e3000000-0379-0379-0379-e30000000379', 'ลูกทีม สอง', 'daily', 'temporary', 400, true,
   '75000000-0379-0379-0379-750000000379'),
  ('e4000000-0379-0379-0379-e40000000379', 'ลูกทีม สาม', 'daily', 'temporary', 400, true,
   '75000000-0379-0379-0379-750000000379'),
  ('e9000000-0379-0379-0379-e90000000379', 'ไม่เคยเช็คชื่อ', 'daily', 'temporary', 400, true,
   '75000000-0379-0379-0379-750000000379');

-- A LEAF work package: labor_logs_reject_group_wp refuses a group binding.
insert into public.work_packages (id, project_id, code, name, is_group) values
  ('c1000000-0379-0379-0379-c10000000379', 'a1000000-0379-0379-0379-a10000000379',
   'W379-01', 'งานทดสอบ', false);

-- ---------------------------------------------------------------------------
-- Seed the day through the REAL RPCs, as the member SA.
-- ---------------------------------------------------------------------------
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0379-0379-0379-700000000379"}';
select public.open_muster_team('a1000000-0379-0379-0379-a10000000379', current_date,
  'e1000000-0379-0379-0379-e10000000379');
reset role;
insert into _ids select 'team', id from public.muster_teams
  where project_id = 'a1000000-0379-0379-0379-a10000000379' and work_date = current_date;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0379-0379-0379-700000000379"}';
select public.muster_scan_in((select id from _ids where k = 'team'),
  'e2000000-0379-0379-0379-e20000000379', 'qr');
select public.muster_scan_in((select id from _ids where k = 'team'),
  'e3000000-0379-0379-0379-e30000000379', 'qr');
select public.muster_scan_in((select id from _ids where k = 'team'),
  'e3000000-0379-0379-0379-e30000000379', 'qr', 'ot');
select public.muster_scan_in((select id from _ids where k = 'team'),
  'e4000000-0379-0379-0379-e40000000379', 'qr');
reset role;
insert into _ids select 'att4', id from public.muster_attendance
  where worker_id = 'e4000000-0379-0379-0379-e40000000379' and work_date = current_date
    and session = 'regular';

-- ============================================================================
-- A. Grants — a NEW function carries a default PUBLIC EXECUTE, so the revoke
--    must name `public` as well as `anon` (#833). has_function_privilege on
--    'anon' resolves PUBLIC through role inheritance, which a
--    role_routine_grants count does NOT (it has no PUBLIC arm at all).
-- ============================================================================
select ok(
  not has_function_privilege('anon',
    'public.muster_undo_scan(uuid,date,public.muster_session)', 'execute'),
  'anon cannot execute muster_undo_scan');
select ok(
  has_function_privilege('authenticated',
    'public.muster_undo_scan(uuid,date,public.muster_session)', 'execute'),
  'authenticated CAN execute muster_undo_scan (positive control for the grant)');

-- ============================================================================
-- B. Role gate — parity with muster_scan_in.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "72000000-0379-0379-0379-720000000379"}';
select throws_ok(
  $$ select public.muster_undo_scan('e2000000-0379-0379-0379-e20000000379',
       current_date, 'regular') $$,
  '42501', null, 'a visitor cannot undo a check-in');
set local "request.jwt.claims" = '{"sub": "74000000-0379-0379-0379-740000000379"}';
select throws_ok(
  $$ select public.muster_undo_scan('e2000000-0379-0379-0379-e20000000379',
       current_date, 'regular') $$,
  '42501', null, 'a technician cannot undo a check-in');
set local "request.jwt.claims" = '{"sub": "71000000-0379-0379-0379-710000000379"}';
select throws_ok(
  $$ select public.muster_undo_scan('e2000000-0379-0379-0379-e20000000379',
       current_date, 'regular') $$,
  '42501', null, 'a non-member SA cannot undo in this project (can_see_project)');

-- ============================================================================
-- C. No such row.
-- ============================================================================
set local "request.jwt.claims" = '{"sub": "70000000-0379-0379-0379-700000000379"}';
select throws_ok(
  $$ select public.muster_undo_scan('e9000000-0379-0379-0379-e90000000379',
       current_date, 'regular') $$,
  'P0001', null, 'undoing a worker who was never checked in raises P0001');

-- ============================================================================
-- D. OT depends on the regular session — refuse to strand it.
-- ============================================================================
select throws_ok(
  $$ select public.muster_undo_scan('e3000000-0379-0379-0379-e30000000379',
       current_date, 'regular') $$,
  'P0001', null, 'cannot undo the regular session while an OT session is open');
select lives_ok(
  $$ select public.muster_undo_scan('e3000000-0379-0379-0379-e30000000379',
       current_date, 'ot') $$,
  'the OT session itself can be undone');
select lives_ok(
  $$ select public.muster_undo_scan('e3000000-0379-0379-0379-e30000000379',
       current_date, 'regular') $$,
  'and with the OT gone, the regular session can be undone too');
reset role;
select is(
  (select count(*)::int from public.muster_attendance
    where worker_id = 'e3000000-0379-0379-0379-e30000000379' and work_date = current_date),
  0, 'both of that worker''s sessions are gone');

-- ============================================================================
-- E. Happy path — the row is deleted and the audit trace carries the snapshot.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0379-0379-0379-700000000379"}';
select lives_ok(
  $$ select public.muster_undo_scan('e2000000-0379-0379-0379-e20000000379',
       current_date, 'regular') $$,
  'a member SA undoes a check-in');
reset role;
select is(
  (select count(*)::int from public.muster_attendance
    where worker_id = 'e2000000-0379-0379-0379-e20000000379' and work_date = current_date),
  0, 'the attendance row is gone');
select is(
  (select payload->>'kind' from public.audit_log
    where action = 'crew_change' and target_table = 'muster_attendance'
      and payload->>'worker_id' = 'e2000000-0379-0379-0379-e20000000379'
    order by created_at desc limit 1),
  'muster_undo', 'an audit row records the retraction as muster_undo');
select ok(
  (select payload ? 'in_at' and payload ? 'team_id' and payload ? 'in_method'
     from public.audit_log
    where action = 'crew_change' and target_table = 'muster_attendance'
      and payload->>'worker_id' = 'e2000000-0379-0379-0379-e20000000379'
    order by created_at desc limit 1),
  'the audit payload snapshots the deleted row (in_at, team_id, in_method)');

-- ============================================================================
-- F. A CURRENT derived wage row blocks; a SUPERSEDED one must NOT.
--    labor_logs is append-only (labor_logs_no_update_delete), so the tombstone
--    is an INSERT carrying superseded_by — never an UPDATE (ADR 0015).
-- ============================================================================
insert into public.labor_logs
  (id, work_package_id, worker_id, work_date, day_fraction, day_rate_snapshot,
   worker_name_snapshot, entered_by, self_logged, pay_type_snapshot, source_muster_id)
values
  ('bb000000-0379-0379-0379-bb0000000379', 'c1000000-0379-0379-0379-c10000000379',
   'e4000000-0379-0379-0379-e40000000379', current_date, 'full', 400, 'ลูกทีม สาม',
   '75000000-0379-0379-0379-750000000379', false, 'daily',
   (select id from _ids where k = 'att4'));

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0379-0379-0379-700000000379"}';
select throws_ok(
  $$ select public.muster_undo_scan('e4000000-0379-0379-0379-e40000000379',
       current_date, 'regular') $$,
  'P0001', null, 'a CURRENT derived wage row blocks the undo');
reset role;

-- Tombstone it the append-only way: a null-fraction row pointing at the first.
-- labor_logs_reason_iff_correction: (superseded_by IS NULL) = (correction_reason
-- IS NULL), so a tombstone MUST carry a reason.
insert into public.labor_logs
  (work_package_id, worker_id, work_date, day_fraction, day_rate_snapshot,
   worker_name_snapshot, entered_by, self_logged, pay_type_snapshot,
   source_muster_id, superseded_by, correction_reason)
values
  ('c1000000-0379-0379-0379-c10000000379', 'e4000000-0379-0379-0379-e40000000379',
   current_date, null, 400, 'ลูกทีม สาม', '75000000-0379-0379-0379-750000000379',
   false, 'daily', (select id from _ids where k = 'att4'),
   'bb000000-0379-0379-0379-bb0000000379', 'ทดสอบการยกเลิกรายการค่าแรง');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0379-0379-0379-700000000379"}';
select lives_ok(
  $$ select public.muster_undo_scan('e4000000-0379-0379-0379-e40000000379',
       current_date, 'regular') $$,
  'a SUPERSEDED wage row does NOT block — the guard is an anti-join, not exists()');

-- ============================================================================
-- G. A closed day refuses — closing books wages.
-- ============================================================================
select public.muster_scan_in((select id from _ids where k = 'team'),
  'e2000000-0379-0379-0379-e20000000379', 'qr');
select public.close_muster_day('a1000000-0379-0379-0379-a10000000379', current_date);
select throws_ok(
  $$ select public.muster_undo_scan('e2000000-0379-0379-0379-e20000000379',
       current_date, 'regular') $$,
  'P0001', null, 'once the day is closed the undo refuses');
reset role;
select is(
  (select count(*)::int from public.muster_attendance
    where worker_id = 'e2000000-0379-0379-0379-e20000000379' and work_date = current_date),
  1, 'and the row survives the refusal');

select * from finish();
rollback;
