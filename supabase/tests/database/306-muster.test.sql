begin;
select plan(68);

-- ============================================================================
-- Spec 306 U2 — morning-talk scan muster: schema + DEFINER RPCs.
--   * muster_teams / muster_team_wps / muster_attendance / muster_day_closures:
--     RLS on, read = can_see_project, writes ONLY via DEFINER RPCs (no
--     insert/update/delete grant to authenticated).
--   * open_muster_team: SA/super + can_see_project; idempotent per
--     (project, date, lead).
--   * muster_scan_in: stamps in_at; same-team re-scan = no-op same row;
--     other-team conflict = P0001 carrying the other lead's name.
--   * set_muster_team_wps: replace-set; same-project WPs only; sub-WP row
--     allowed as explicit override.
--   * move_muster_worker: confirmed move + audit_log (crew_change).
--   * muster_scan_out: stamps out_at; OT = hours past 17:00 Asia/Bangkok on
--     the team's work_date, floored to 0.5h, null when none.
--   * close_muster_day: auto-out (day-end, out_auto flag, no phantom OT) +
--     closure row; idempotent re-close.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('70000000-0306-0306-0306-700000000306', 'sa-mem@s306.local',  '{}'::jsonb),
  ('71000000-0306-0306-0306-710000000306', 'sa-none@s306.local', '{}'::jsonb),
  ('75000000-0306-0306-0306-750000000306', 'super@s306.local',   '{}'::jsonb),
  ('72000000-0306-0306-0306-720000000306', 'visitor@s306.local', '{}'::jsonb),
  ('74000000-0306-0306-0306-740000000306', 'tech@s306.local',    '{}'::jsonb),
  ('76000000-0306-0306-0306-760000000306', 'pm@s306.local',      '{}'::jsonb);
update public.users set role = 'site_admin'      where id = '70000000-0306-0306-0306-700000000306';
update public.users set role = 'site_admin'      where id = '71000000-0306-0306-0306-710000000306';
update public.users set role = 'super_admin'     where id = '75000000-0306-0306-0306-750000000306';
update public.users set role = 'technician'      where id = '74000000-0306-0306-0306-740000000306';
update public.users set role = 'project_manager' where id = '76000000-0306-0306-0306-760000000306';

insert into public.projects (id, code, name) values
  ('a1000000-0306-0306-0306-a10000000306', 'TAP-306A', 'โครงการทดสอบมัสเตอร์'),
  ('a2000000-0306-0306-0306-a20000000306', 'TAP-306B', 'โครงการอื่น');
insert into public.project_members (project_id, user_id, added_by) values
  ('a1000000-0306-0306-0306-a10000000306', '70000000-0306-0306-0306-700000000306',
   '75000000-0306-0306-0306-750000000306'),
  ('a1000000-0306-0306-0306-a10000000306', '76000000-0306-0306-0306-760000000306',
   '75000000-0306-0306-0306-750000000306');

insert into public.workers (id, name, pay_type, employment_type, day_rate, active, created_by) values
  ('e1000000-0306-0306-0306-e10000000306', 'สมชาย หัวหน้า', 'daily', 'temporary', 400, true,
   '75000000-0306-0306-0306-750000000306'),
  ('e2000000-0306-0306-0306-e20000000306', 'สมศรี หัวหน้า', 'daily', 'temporary', 400, true,
   '75000000-0306-0306-0306-750000000306'),
  ('e3000000-0306-0306-0306-e30000000306', 'สมหมาย ลูกทีม', 'daily', 'temporary', 400, true,
   '75000000-0306-0306-0306-750000000306'),
  ('e4000000-0306-0306-0306-e40000000306', 'สมปอง ลูกทีม', 'daily', 'temporary', 400, true,
   '75000000-0306-0306-0306-750000000306'),
  ('e5000000-0306-0306-0306-e50000000306', 'สมนึก ข้ามโครงการ', 'daily', 'temporary', 400, true,
   '75000000-0306-0306-0306-750000000306');

-- P1 is a GROUPED project (spec 270 guard: once grouped, every leaf needs a
-- parent) → its main WPs are the two งาน groups; S1 is a leaf under G1.
-- P2 stays flat, so its main WP is a plain leaf.
insert into public.work_packages (id, project_id, code, name, is_group) values
  ('91000000-0306-0306-0306-910000000306', 'a1000000-0306-0306-0306-a10000000306',
   'WP-G1', 'งานกลุ่มหลัก', true);
insert into public.work_packages (id, project_id, code, name, is_group) values
  ('92000000-0306-0306-0306-920000000306', 'a1000000-0306-0306-0306-a10000000306',
   'WP-G2', 'งานกลุ่มที่สอง', true);
insert into public.work_packages (id, project_id, code, name, parent_id) values
  ('93000000-0306-0306-0306-930000000306', 'a1000000-0306-0306-0306-a10000000306',
   'WP-G1-S1', 'งานย่อยในกลุ่ม', '91000000-0306-0306-0306-910000000306');
insert into public.work_packages (id, project_id, code, name) values
  ('94000000-0306-0306-0306-940000000306', 'a2000000-0306-0306-0306-a20000000306',
   'WP-X1', 'งานโครงการอื่น');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ids created by RPCs while role=authenticated get stashed here for later asserts.
create temp table _ids (k text primary key, id uuid);
grant select, insert on _ids to authenticated, anon;

-- ============================================================================
-- A. Structure.
-- ============================================================================
select has_table('public'::name, 'muster_teams'::name, 'muster_teams exists');
select has_table('public'::name, 'muster_team_wps'::name, 'muster_team_wps exists');
select has_table('public'::name, 'muster_attendance'::name, 'muster_attendance exists');
select has_table('public'::name, 'muster_day_closures'::name, 'muster_day_closures exists');

-- ============================================================================
-- B. anon is revoked on every muster RPC.
-- ============================================================================
select ok(not has_function_privilege('anon', 'public.open_muster_team(uuid,date,uuid)', 'execute'),
  'anon cannot execute open_muster_team');
select ok(not has_function_privilege('anon', 'public.muster_scan_in(uuid,uuid,public.muster_method)', 'execute'),
  'anon cannot execute muster_scan_in');
select ok(not has_function_privilege('anon', 'public.muster_scan_out(uuid,uuid,public.muster_method)', 'execute'),
  'anon cannot execute muster_scan_out');
select ok(not has_function_privilege('anon', 'public.set_muster_team_wps(uuid,uuid[])', 'execute'),
  'anon cannot execute set_muster_team_wps');
select ok(not has_function_privilege('anon', 'public.move_muster_worker(uuid,date,uuid)', 'execute'),
  'anon cannot execute move_muster_worker');
select ok(not has_function_privilege('anon', 'public.close_muster_day(uuid,date)', 'execute'),
  'anon cannot execute close_muster_day');

-- ============================================================================
-- C. open_muster_team — gate + idempotency.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0306-0306-0306-700000000306"}';
select ok(
  (select public.open_muster_team('a1000000-0306-0306-0306-a10000000306', current_date,
     'e1000000-0306-0306-0306-e10000000306')) is not null,
  'a member SA opens today''s team for lead 1');
reset role;
insert into _ids select 'team1', id from public.muster_teams
  where project_id = 'a1000000-0306-0306-0306-a10000000306'
    and work_date = current_date
    and lead_worker_id = 'e1000000-0306-0306-0306-e10000000306';

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0306-0306-0306-700000000306"}';
select is(
  (select public.open_muster_team('a1000000-0306-0306-0306-a10000000306', current_date,
     'e1000000-0306-0306-0306-e10000000306')),
  (select id from _ids where k = 'team1'),
  'opening the same (project, date, lead) again returns the SAME team (idempotent)');

set local "request.jwt.claims" = '{"sub": "72000000-0306-0306-0306-720000000306"}';
select throws_ok(
  $$ select public.open_muster_team('a1000000-0306-0306-0306-a10000000306', current_date,
       'e1000000-0306-0306-0306-e10000000306') $$,
  '42501', null, 'a visitor cannot open a muster team (role gate)');
set local "request.jwt.claims" = '{"sub": "74000000-0306-0306-0306-740000000306"}';
select throws_ok(
  $$ select public.open_muster_team('a1000000-0306-0306-0306-a10000000306', current_date,
       'e1000000-0306-0306-0306-e10000000306') $$,
  '42501', null, 'a technician cannot open a muster team (role gate)');
set local "request.jwt.claims" = '{"sub": "71000000-0306-0306-0306-710000000306"}';
select throws_ok(
  $$ select public.open_muster_team('a1000000-0306-0306-0306-a10000000306', current_date,
       'e1000000-0306-0306-0306-e10000000306') $$,
  '42501', null, 'a non-member SA cannot open a team in this project (can_see_project gate)');
set local "request.jwt.claims" = '{"sub": "70000000-0306-0306-0306-700000000306"}';
select throws_ok(
  $$ select public.open_muster_team('a1000000-0306-0306-0306-a10000000306', current_date,
       '99999999-9999-9999-9999-999999999999') $$,
  'P0001', null, 'an unknown lead worker is refused');
reset role;

-- ============================================================================
-- D. Read scoping + write wall on the tables.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0306-0306-0306-700000000306"}';
select is((select count(*)::int from public.muster_teams), 1,
  'a member SA reads the project''s muster teams');
set local "request.jwt.claims" = '{"sub": "71000000-0306-0306-0306-710000000306"}';
select is((select count(*)::int from public.muster_teams), 0,
  'a non-member SA reads NO muster teams (project scoped)');
set local "request.jwt.claims" = '{"sub": "76000000-0306-0306-0306-760000000306"}';
select is((select count(*)::int from public.muster_teams), 1,
  'a member PM reads the project''s muster teams');
set local "request.jwt.claims" = '{"sub": "72000000-0306-0306-0306-720000000306"}';
select is((select count(*)::int from public.muster_teams), 0,
  'a visitor reads NO muster teams');
reset role;
select throws_ok(
  $$ set local role anon; select * from public.muster_teams $$,
  '42501', null, 'anon has no grant on muster_teams');
select throws_ok(
  $$ set local role authenticated; insert into public.muster_teams
       (project_id, work_date, lead_worker_id, created_by)
     values ('a1000000-0306-0306-0306-a10000000306', '2026-01-01',
       'e1000000-0306-0306-0306-e10000000306', '70000000-0306-0306-0306-700000000306') $$,
  '42501', null, 'authenticated cannot INSERT muster_teams directly (RPC-only writes)');
reset role;

-- ============================================================================
-- E. muster_scan_in — stamp, no-op re-scan, other-team conflict.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0306-0306-0306-700000000306"}';
select ok(
  (select public.muster_scan_in((select id from _ids where k = 'team1'),
     'e3000000-0306-0306-0306-e30000000306', 'qr')) is not null,
  'the SA scans member 3 into team 1');
reset role;
insert into _ids select 'att3', id from public.muster_attendance
  where worker_id = 'e3000000-0306-0306-0306-e30000000306' and work_date = current_date;
select ok(
  (select in_method = 'qr' and work_date = current_date and in_at is not null
      and out_at is null and out_auto = false
     from public.muster_attendance where id = (select id from _ids where k = 'att3')),
  'the scan stamped in_at + method, work_date matches the team, not yet out');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0306-0306-0306-700000000306"}';
select is(
  (select public.muster_scan_in((select id from _ids where k = 'team1'),
     'e3000000-0306-0306-0306-e30000000306', 'qr')),
  (select id from _ids where k = 'att3'),
  're-scanning the same worker into the same team is a no-op returning the same row');
reset role;
select is(
  (select count(*)::int from public.muster_attendance
    where worker_id = 'e3000000-0306-0306-0306-e30000000306' and work_date = current_date),
  1, 'one attendance row per worker per day');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0306-0306-0306-700000000306"}';
select ok(
  (select public.open_muster_team('a1000000-0306-0306-0306-a10000000306', current_date,
     'e2000000-0306-0306-0306-e20000000306')) is not null,
  'a second team (lead 2) opens for the same day');
reset role;
insert into _ids select 'team2', id from public.muster_teams
  where project_id = 'a1000000-0306-0306-0306-a10000000306'
    and work_date = current_date
    and lead_worker_id = 'e2000000-0306-0306-0306-e20000000306';

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0306-0306-0306-700000000306"}';
select throws_ok(
  $$ select public.muster_scan_in(
       (select id from _ids where k = 'team2'),
       'e3000000-0306-0306-0306-e30000000306', 'qr') $$,
  'P0001', 'muster_scan_in: worker already in team of สมชาย หัวหน้า today',
  'scanning a worker already in another team errors with the other lead''s name');
set local "request.jwt.claims" = '{"sub": "72000000-0306-0306-0306-720000000306"}';
select throws_ok(
  $$ select public.muster_scan_in(
       (select id from _ids where k = 'team1'),
       'e4000000-0306-0306-0306-e40000000306', 'qr') $$,
  '42501', null, 'a visitor cannot scan in (role gate)');
set local "request.jwt.claims" = '{"sub": "70000000-0306-0306-0306-700000000306"}';
select throws_ok(
  $$ select public.muster_scan_in(
       (select id from _ids where k = 'team1'),
       '99999999-9999-9999-9999-999999999999', 'qr') $$,
  'P0001', null, 'an unknown worker is refused');
select throws_ok(
  $$ select public.muster_scan_in('99999999-9999-9999-9999-999999999999',
       'e4000000-0306-0306-0306-e40000000306', 'qr') $$,
  'P0001', null, 'an unknown team is refused');
reset role;

-- cross-project conflict: super (sees all) musters e5 in project B (SA 70 is NOT a
-- member of B); when SA 70 scans e5 into team 1 the error must NOT leak B's lead name.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "75000000-0306-0306-0306-750000000306"}';
select ok(
  (select public.open_muster_team('a2000000-0306-0306-0306-a20000000306', current_date,
     'e2000000-0306-0306-0306-e20000000306')) is not null,
  'super opens a team in project B (SA 70 cannot see B)');
reset role;
insert into _ids select 'teamB', id from public.muster_teams
  where project_id = 'a2000000-0306-0306-0306-a20000000306'
    and work_date = current_date
    and lead_worker_id = 'e2000000-0306-0306-0306-e20000000306';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "75000000-0306-0306-0306-750000000306"}';
select ok(
  (select public.muster_scan_in((select id from _ids where k = 'teamB'),
     'e5000000-0306-0306-0306-e50000000306', 'qr')) is not null,
  'super scans e5 into project B''s team');
set local "request.jwt.claims" = '{"sub": "70000000-0306-0306-0306-700000000306"}';
select throws_ok(
  $$ select public.muster_scan_in((select id from _ids where k = 'team1'),
       'e5000000-0306-0306-0306-e50000000306', 'qr') $$,
  'P0001', 'muster_scan_in: worker is already mustered elsewhere today',
  'a cross-project conflict gives a GENERIC message (no B-lead-name leak past the visibility gate)');
reset role;

-- ============================================================================
-- F. set_muster_team_wps — replace-set, same-project rule, sub-WP override.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0306-0306-0306-700000000306"}';
select lives_ok(
  $$ select public.set_muster_team_wps((select id from _ids where k = 'team1'),
       array['91000000-0306-0306-0306-910000000306',
             '92000000-0306-0306-0306-920000000306']::uuid[]) $$,
  'the SA sets team 1 onto two main WPs');
reset role;
select is(
  (select count(*)::int from public.muster_team_wps
    where team_id = (select id from _ids where k = 'team1')),
  2, 'both WP rows landed');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0306-0306-0306-700000000306"}';
select lives_ok(
  $$ select public.set_muster_team_wps((select id from _ids where k = 'team1'),
       array['92000000-0306-0306-0306-920000000306']::uuid[]) $$,
  'setting a smaller set replaces (not appends)');
reset role;
select ok(
  (select count(*) = 1
      and bool_and(work_package_id = '92000000-0306-0306-0306-920000000306')
     from public.muster_team_wps
    where team_id = (select id from _ids where k = 'team1')),
  'only the new WP remains after the replace');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0306-0306-0306-700000000306"}';
select throws_ok(
  $$ select public.set_muster_team_wps((select id from _ids where k = 'team1'),
       array['94000000-0306-0306-0306-940000000306']::uuid[]) $$,
  'P0001', null, 'a WP from another project is refused');
reset role;
select is(
  (select count(*)::int from public.muster_team_wps
    where team_id = (select id from _ids where k = 'team1')),
  1, 'the refused cross-project set left the WP set unchanged');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0306-0306-0306-700000000306"}';
select lives_ok(
  $$ select public.set_muster_team_wps((select id from _ids where k = 'team1'),
       array['92000000-0306-0306-0306-920000000306',
             '93000000-0306-0306-0306-930000000306']::uuid[]) $$,
  'a sub WP is allowed as an explicit override row');
set local "request.jwt.claims" = '{"sub": "72000000-0306-0306-0306-720000000306"}';
select throws_ok(
  $$ select public.set_muster_team_wps((select id from _ids where k = 'team1'),
       array['92000000-0306-0306-0306-920000000306']::uuid[]) $$,
  '42501', null, 'a visitor cannot set team WPs (role gate)');
reset role;

-- an empty array clears the set (Site-Owner un-announces the team's WPs).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0306-0306-0306-700000000306"}';
select lives_ok(
  $$ select public.set_muster_team_wps((select id from _ids where k = 'team1'), array[]::uuid[]) $$,
  'an empty WP array is accepted');
reset role;
select is(
  (select count(*)::int from public.muster_team_wps
    where team_id = (select id from _ids where k = 'team1')),
  0, 'an empty array clears the team''s WP set');

-- ============================================================================
-- G. move_muster_worker — confirmed move + audit.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0306-0306-0306-700000000306"}';
select is(
  (select public.move_muster_worker('e3000000-0306-0306-0306-e30000000306', current_date,
     (select id from _ids where k = 'team2'))),
  (select id from _ids where k = 'att3'),
  'moving worker 3 to team 2 returns the attendance row');
reset role;
select is(
  (select team_id from public.muster_attendance
    where id = (select id from _ids where k = 'att3')),
  (select id from _ids where k = 'team2'),
  'the attendance row now belongs to team 2');
select ok(
  exists (select 1 from public.audit_log
    where action = 'crew_change' and target_table = 'muster_attendance'
      and target_id = (select id from _ids where k = 'att3')),
  'the move wrote an audit_log row');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0306-0306-0306-700000000306"}';
select throws_ok(
  $$ select public.move_muster_worker('e4000000-0306-0306-0306-e40000000306', current_date,
       (select id from _ids where k = 'team2')) $$,
  'P0001', null, 'moving a worker with no attendance today is refused');
select ok(
  (select public.open_muster_team('a1000000-0306-0306-0306-a10000000306', '2026-01-05',
     'e1000000-0306-0306-0306-e10000000306')) is not null,
  'a past-day team (2026-01-05) opens for the OT cases');
reset role;
insert into _ids select 'team3', id from public.muster_teams
  where project_id = 'a1000000-0306-0306-0306-a10000000306'
    and work_date = '2026-01-05'
    and lead_worker_id = 'e1000000-0306-0306-0306-e10000000306';

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0306-0306-0306-700000000306"}';
select throws_ok(
  $$ select public.move_muster_worker('e3000000-0306-0306-0306-e30000000306', current_date,
       (select id from _ids where k = 'team3')) $$,
  'P0001', null, 'moving to a team of a different date is refused');
reset role;

-- ============================================================================
-- H. muster_scan_out — stamp + OT (past day => OT > 0; future day => null).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0306-0306-0306-700000000306"}';
select ok(
  (select public.muster_scan_out((select id from _ids where k = 'team2'),
     'e3000000-0306-0306-0306-e30000000306', 'qr')) is not null,
  'the SA scans worker 3 out');
reset role;
select ok(
  (select out_at is not null and out_method = 'qr' and out_auto = false
     from public.muster_attendance where id = (select id from _ids where k = 'att3')),
  'out_at + out_method stamped, not auto-closed');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0306-0306-0306-700000000306"}';
select ok(
  (select public.muster_scan_in((select id from _ids where k = 'team3'),
     'e4000000-0306-0306-0306-e40000000306', 'qr')) is not null,
  'worker 4 scans into the past-day team');
select ok(
  (select public.muster_scan_out((select id from _ids where k = 'team3'),
     'e4000000-0306-0306-0306-e40000000306', 'qr')) is not null,
  'worker 4 scans out of the past-day team');
reset role;
select ok(
  (select ot_hours > 0 and ot_hours = floor(ot_hours * 2) / 2
     from public.muster_attendance
    where worker_id = 'e4000000-0306-0306-0306-e40000000306' and work_date = '2026-01-05'),
  'an out past the 17:00 Bangkok day-end yields OT hours in 0.5h steps');
-- pin the anchor + formula: recompute OT from the STORED out_at against the fixed
-- 17:00 Asia/Bangkok day-end. Fails if the RPC anchored on midnight or flipped sign.
select is(
  (select ot_hours from public.muster_attendance
    where worker_id = 'e4000000-0306-0306-0306-e40000000306' and work_date = '2026-01-05'),
  (select floor(extract(epoch from
        (out_at - (('2026-01-05'::date + time '17:00') at time zone 'Asia/Bangkok'))) / 3600.0 * 2) / 2
     from public.muster_attendance
    where worker_id = 'e4000000-0306-0306-0306-e40000000306' and work_date = '2026-01-05'),
  'OT equals hours past exactly 17:00 Asia/Bangkok, floored to 0.5h (anchor pinned)');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0306-0306-0306-700000000306"}';
select ok(
  (select public.open_muster_team('a1000000-0306-0306-0306-a10000000306',
     current_date + 1, 'e2000000-0306-0306-0306-e20000000306')) is not null,
  'a future-day team (tomorrow) opens');
reset role;
insert into _ids select 'team4', id from public.muster_teams
  where project_id = 'a1000000-0306-0306-0306-a10000000306'
    and work_date = current_date + 1
    and lead_worker_id = 'e2000000-0306-0306-0306-e20000000306';

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0306-0306-0306-700000000306"}';
select ok(
  (select public.muster_scan_in((select id from _ids where k = 'team4'),
     'e1000000-0306-0306-0306-e10000000306', 'manual')) is not null,
  'a manual tap-add records in_method manual (lost badge is not an absence)');
select ok(
  (select public.muster_scan_out((select id from _ids where k = 'team4'),
     'e1000000-0306-0306-0306-e10000000306', 'manual')) is not null,
  'the future-day worker scans out');
reset role;
select ok(
  (select ot_hours is null and in_method = 'manual'
     from public.muster_attendance
    where worker_id = 'e1000000-0306-0306-0306-e10000000306' and work_date = current_date + 1),
  'an out before the day-end yields NO OT (null)');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0306-0306-0306-700000000306"}';
select lives_ok(
  $$ select public.muster_scan_out((select id from _ids where k = 'team2'),
       'e3000000-0306-0306-0306-e30000000306', 'manual') $$,
  're-scanning out is allowed (last scan wins)');
reset role;

-- ============================================================================
-- I. close_muster_day — auto-out + closure + idempotent re-close.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0306-0306-0306-700000000306"}';
select ok(
  (select public.muster_scan_in((select id from _ids where k = 'team1'),
     'e1000000-0306-0306-0306-e10000000306', 'qr')) is not null,
  'lead 1 scans into today''s team 1 (stays un-out for the auto-close case)');
select lives_ok(
  $$ select public.close_muster_day('a1000000-0306-0306-0306-a10000000306', current_date) $$,
  'the SA closes the day');
reset role;
select ok(
  (select out_at is not null and out_auto = true and ot_hours is null
     from public.muster_attendance
    where worker_id = 'e1000000-0306-0306-0306-e10000000306' and work_date = current_date),
  'close-day auto-outs the un-out worker at day-end with the auto flag and NO phantom OT');
select ok(
  (select out_auto = false
     from public.muster_attendance where id = (select id from _ids where k = 'att3')),
  'a worker already scanned out is untouched by close-day');
select is(
  (select count(*)::int from public.muster_day_closures
    where project_id = 'a1000000-0306-0306-0306-a10000000306' and work_date = current_date),
  1, 'the closure row exists');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0306-0306-0306-700000000306"}';
select lives_ok(
  $$ select public.close_muster_day('a1000000-0306-0306-0306-a10000000306', current_date) $$,
  're-closing the day is idempotent (re-derive entry point)');
set local "request.jwt.claims" = '{"sub": "72000000-0306-0306-0306-720000000306"}';
select throws_ok(
  $$ select public.close_muster_day('a1000000-0306-0306-0306-a10000000306', current_date) $$,
  '42501', null, 'a visitor cannot close the day (role gate)');
reset role;

select * from finish();
rollback;
