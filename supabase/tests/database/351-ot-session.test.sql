begin;
select plan(33);

-- ============================================================================
-- Spec 351 U1 — separate OT muster session.
--   * muster_attendance gains a `session public.muster_session` ('regular'|'ot')
--     column; the per-worker/day uniqueness becomes composite
--     unique (worker_id, work_date, session) — one regular + one ot row/day.
--   * muster_scan_in / muster_scan_out gain a trailing
--     `p_session muster_session default 'regular'`.
--       - ot scan-in is guarded: the worker must ALREADY have a `regular`
--         session that day ON THE SAME TEAM (else P0001).
--       - `ot_hours` is null on regular rows; on an ot row it is the OT
--         session's real span (out_at − in_at), floored to 0.5h at ot scan-out.
--   * close_muster_day auto-outs `regular` sessions only (open `ot` left open —
--         "till whenever").
--   * move_muster_worker moves ALL of the worker's sessions that day.
-- Money (306 U5 derive → labor_logs) stays out of scope.
-- Mirrors the JWT-as-site_admin harness of 306-muster.test.sql.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('70000000-0351-0351-0351-700000000351', 'sa@s351.local',    '{}'::jsonb),
  ('75000000-0351-0351-0351-750000000351', 'super@s351.local', '{}'::jsonb);
update public.users set role = 'site_admin'  where id = '70000000-0351-0351-0351-700000000351';
update public.users set role = 'super_admin' where id = '75000000-0351-0351-0351-750000000351';

insert into public.projects (id, code, name) values
  ('a1000000-0351-0351-0351-a10000000351', 'TAP-351', 'โครงการทดสอบ OT');
insert into public.project_members (project_id, user_id, added_by) values
  ('a1000000-0351-0351-0351-a10000000351', '70000000-0351-0351-0351-700000000351',
   '75000000-0351-0351-0351-750000000351');

insert into public.workers (id, name, pay_type, employment_type, day_rate, active, created_by) values
  ('e0000000-0351-0351-0351-e00000000351', 'หัวหน้าทีมหนึ่ง', 'daily', 'temporary', 400, true,
   '75000000-0351-0351-0351-750000000351'),
  ('ea000000-0351-0351-0351-ea0000000351', 'หัวหน้าทีมสอง', 'daily', 'temporary', 400, true,
   '75000000-0351-0351-0351-750000000351'),
  ('e1000000-0351-0351-0351-e10000000351', 'ช่างเอ', 'daily', 'temporary', 400, true,
   '75000000-0351-0351-0351-750000000351'),
  ('e2000000-0351-0351-0351-e20000000351', 'ช่างบี', 'daily', 'temporary', 400, true,
   '75000000-0351-0351-0351-750000000351'),
  ('e3000000-0351-0351-0351-e30000000351', 'ช่างซี', 'daily', 'temporary', 400, true,
   '75000000-0351-0351-0351-750000000351'),
  ('e4000000-0351-0351-0351-e40000000351', 'ช่างดี', 'daily', 'temporary', 400, true,
   '75000000-0351-0351-0351-750000000351'),
  ('e5000000-0351-0351-0351-e50000000351', 'ช่างอี', 'daily', 'temporary', 400, true,
   '75000000-0351-0351-0351-750000000351');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

create temp table _ids (k text primary key, id uuid);
grant select, insert on _ids to authenticated, anon;

-- Open the teams (current_date T1 + T2, past-date T3 for the close-day case).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0351-0351-0351-700000000351"}';
select ok((select public.open_muster_team('a1000000-0351-0351-0351-a10000000351', current_date,
     'e0000000-0351-0351-0351-e00000000351')) is not null, 'team 1 opens (today)');
select ok((select public.open_muster_team('a1000000-0351-0351-0351-a10000000351', current_date,
     'ea000000-0351-0351-0351-ea0000000351')) is not null, 'team 2 opens (today)');
select ok((select public.open_muster_team('a1000000-0351-0351-0351-a10000000351', '2026-01-05',
     'e0000000-0351-0351-0351-e00000000351')) is not null, 'team 3 opens (past day, for close-day)');
reset role;
insert into _ids select 'team1', id from public.muster_teams
  where project_id = 'a1000000-0351-0351-0351-a10000000351' and work_date = current_date
    and lead_worker_id = 'e0000000-0351-0351-0351-e00000000351';
insert into _ids select 'team2', id from public.muster_teams
  where project_id = 'a1000000-0351-0351-0351-a10000000351' and work_date = current_date
    and lead_worker_id = 'ea000000-0351-0351-0351-ea0000000351';
insert into _ids select 'team3', id from public.muster_teams
  where project_id = 'a1000000-0351-0351-0351-a10000000351' and work_date = '2026-01-05'
    and lead_worker_id = 'e0000000-0351-0351-0351-e00000000351';

-- ============================================================================
-- A. Structure.
-- ============================================================================
select has_column('public'::name, 'muster_attendance'::name, 'session'::name,
  'muster_attendance has a session column');

-- ============================================================================
-- B. Grants — the NEW 4-arg signatures: anon revoked, authenticated granted.
-- ============================================================================
select ok(not has_function_privilege('anon',
  'public.muster_scan_in(uuid,uuid,public.muster_method,public.muster_session)', 'execute'),
  'anon cannot execute the 4-arg muster_scan_in');
select ok(has_function_privilege('authenticated',
  'public.muster_scan_in(uuid,uuid,public.muster_method,public.muster_session)', 'execute'),
  'authenticated can execute the 4-arg muster_scan_in');
select ok(not has_function_privilege('anon',
  'public.muster_scan_out(uuid,uuid,public.muster_method,public.muster_session)', 'execute'),
  'anon cannot execute the 4-arg muster_scan_out');
select ok(has_function_privilege('authenticated',
  'public.muster_scan_out(uuid,uuid,public.muster_method,public.muster_session)', 'execute'),
  'authenticated can execute the 4-arg muster_scan_out');

-- ============================================================================
-- C. Regular session — scan in/out leaves ot_hours NULL.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0351-0351-0351-700000000351"}';
select ok((select public.muster_scan_in((select id from _ids where k = 'team1'),
     'e1000000-0351-0351-0351-e10000000351', 'manual', 'regular')) is not null,
  'ช่างเอ scans into the regular session');
reset role;
insert into _ids select 'wa_reg', id from public.muster_attendance
  where worker_id = 'e1000000-0351-0351-0351-e10000000351' and work_date = current_date and session = 'regular';
select is((select session::text from public.muster_attendance where id = (select id from _ids where k = 'wa_reg')),
  'regular', 'the row is a regular session');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0351-0351-0351-700000000351"}';
select ok((select public.muster_scan_out((select id from _ids where k = 'team1'),
     'e1000000-0351-0351-0351-e10000000351', 'manual', 'regular')) is not null,
  'ช่างเอ scans out of the regular session');
reset role;
select ok((select out_at is not null and ot_hours is null
     from public.muster_attendance where id = (select id from _ids where k = 'wa_reg')),
  'a regular scan-out stamps out_at but carries NO ot_hours (OT moved to the ot session)');

-- ============================================================================
-- D. OT guard — ot scan-in requires a regular session on this team first.
-- ============================================================================
-- ช่างบี has no regular session at all.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0351-0351-0351-700000000351"}';
select throws_ok(
  $$ select public.muster_scan_in((select id from _ids where k = 'team1'),
       'e2000000-0351-0351-0351-e20000000351', 'manual', 'ot') $$,
  'P0001', 'muster_scan_in: no regular session on this team today',
  'ot scan-in without a regular session is refused');
reset role;

-- ช่างซี has a regular session on team 1, then tries ot on team 2 (different team).
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0351-0351-0351-700000000351"}';
select ok((select public.muster_scan_in((select id from _ids where k = 'team1'),
     'e3000000-0351-0351-0351-e30000000351', 'manual', 'regular')) is not null,
  'ช่างซี scans into the regular session on team 1');
select throws_ok(
  $$ select public.muster_scan_in((select id from _ids where k = 'team2'),
       'e3000000-0351-0351-0351-e30000000351', 'manual', 'ot') $$,
  'P0001', 'muster_scan_in: no regular session on this team today',
  'ot scan-in on a DIFFERENT team than the regular session is refused (OT must be same team)');
reset role;

-- ============================================================================
-- E. OT session — scan in creates the 2nd row; scan out sets the span ot_hours.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0351-0351-0351-700000000351"}';
select ok((select public.muster_scan_in((select id from _ids where k = 'team1'),
     'e1000000-0351-0351-0351-e10000000351', 'manual', 'ot')) is not null,
  'ช่างเอ (already regular) scans into the ot session — a 2nd row');
reset role;
insert into _ids select 'wa_ot', id from public.muster_attendance
  where worker_id = 'e1000000-0351-0351-0351-e10000000351' and work_date = current_date and session = 'ot';
-- seed the ot in_at back 100 min so the span floors to 1.5h (now() is constant in-txn).
update public.muster_attendance set in_at = now() - interval '100 minutes'
  where id = (select id from _ids where k = 'wa_ot');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0351-0351-0351-700000000351"}';
select ok((select public.muster_scan_out((select id from _ids where k = 'team1'),
     'e1000000-0351-0351-0351-e10000000351', 'manual', 'ot')) is not null,
  'ช่างเอ scans out of the ot session');
reset role;
select is((select ot_hours from public.muster_attendance where id = (select id from _ids where k = 'wa_ot')),
  1.5::numeric, 'ot scan-out sets ot_hours = the 0.5h-floored span (100 min → 1.5)');
select is((select count(*)::int from public.muster_attendance
    where worker_id = 'e1000000-0351-0351-0351-e10000000351' and work_date = current_date),
  2, 'ช่างเอ now has exactly two sessions (regular + ot)');

-- ============================================================================
-- F. Composite unique — a 2nd regular / 2nd ot scan-in is the idempotent no-op.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0351-0351-0351-700000000351"}';
select is((select public.muster_scan_in((select id from _ids where k = 'team1'),
     'e1000000-0351-0351-0351-e10000000351', 'manual', 'regular')),
  (select id from _ids where k = 'wa_reg'),
  're-scanning the regular session returns the SAME row (idempotent)');
select is((select public.muster_scan_in((select id from _ids where k = 'team1'),
     'e1000000-0351-0351-0351-e10000000351', 'manual', 'ot')),
  (select id from _ids where k = 'wa_ot'),
  're-scanning the ot session returns the SAME row (idempotent)');
reset role;
select is((select count(*)::int from public.muster_attendance
    where worker_id = 'e1000000-0351-0351-0351-e10000000351' and work_date = current_date and session = 'regular'),
  1, 'still exactly one regular row after the re-scan');
select is((select count(*)::int from public.muster_attendance
    where worker_id = 'e1000000-0351-0351-0351-e10000000351' and work_date = current_date and session = 'ot'),
  1, 'still exactly one ot row after the re-scan');

-- ============================================================================
-- G. close_muster_day — auto-out open regular only; leave open ot untouched.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0351-0351-0351-700000000351"}';
select ok((select public.muster_scan_in((select id from _ids where k = 'team3'),
     'e4000000-0351-0351-0351-e40000000351', 'manual', 'regular')) is not null,
  'ช่างดี regular in on the past-day team (left open)');
select ok((select public.muster_scan_in((select id from _ids where k = 'team3'),
     'e4000000-0351-0351-0351-e40000000351', 'manual', 'ot')) is not null,
  'ช่างดี ot in on the past-day team (left open)');
select lives_ok(
  $$ select public.close_muster_day('a1000000-0351-0351-0351-a10000000351', '2026-01-05') $$,
  'the SA closes the past day');
reset role;
select ok((select out_at is not null and out_auto = true
     from public.muster_attendance
    where worker_id = 'e4000000-0351-0351-0351-e40000000351' and work_date = '2026-01-05' and session = 'regular'),
  'close-day auto-outs the open REGULAR session (out_auto flag set)');
select ok((select out_at is null
     from public.muster_attendance
    where worker_id = 'e4000000-0351-0351-0351-e40000000351' and work_date = '2026-01-05' and session = 'ot'),
  'close-day leaves the open OT session OPEN (till whenever)');

-- ============================================================================
-- H. move_muster_worker — moves ALL of the worker's sessions that day.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0351-0351-0351-700000000351"}';
select ok((select public.muster_scan_in((select id from _ids where k = 'team1'),
     'e5000000-0351-0351-0351-e50000000351', 'manual', 'regular')) is not null,
  'ช่างอี regular in on team 1');
select ok((select public.muster_scan_in((select id from _ids where k = 'team1'),
     'e5000000-0351-0351-0351-e50000000351', 'manual', 'ot')) is not null,
  'ช่างอี ot in on team 1');
select ok((select public.move_muster_worker('e5000000-0351-0351-0351-e50000000351', current_date,
     (select id from _ids where k = 'team2'))) is not null,
  'the SA moves ช่างอี to team 2');
reset role;
select is((select count(*)::int from public.muster_attendance
    where worker_id = 'e5000000-0351-0351-0351-e50000000351' and work_date = current_date
      and team_id = (select id from _ids where k = 'team2')),
  2, 'BOTH of ช่างอี''s sessions moved to team 2');
select is((select count(*)::int from public.muster_attendance
    where worker_id = 'e5000000-0351-0351-0351-e50000000351' and work_date = current_date
      and team_id = (select id from _ids where k = 'team1')),
  0, 'no session left on the old team');

select * from finish();
rollback;
