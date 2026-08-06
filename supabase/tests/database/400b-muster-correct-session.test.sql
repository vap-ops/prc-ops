begin;
select plan(43);

-- ============================================================================
-- Spec 400 U4 — the back-dated timestamps. ONE unit, BOTH directions.
--
-- THE TWO HOLES, re-measured live 2026-08-06 (not inherited from the handoff):
--
--   ① muster_scan_in names no `in_at` and the column default is now(), so a
--      correction that adds a missing person to 08-04 stamps the CORRECTION
--      moment. close_muster_day's auto-out is greatest(17:00, in_at) = in_at,
--      i.e. a ZERO-LENGTH session. The surface built to find anomalies would
--      manufacture one.
--   ② No RPC records a check-out at a past time. 33 sessions are open, and they
--      are two different populations: 24 regular rows on days nobody has closed
--      yet (close_muster_day would auto-out those at 17:00 — U3b shipped the
--      affordance), and 9 OT rows ALL on 2026-07-24 on a day that IS CLOSED.
--      close_muster_day skips session='ot' by design, so those nine are the
--      genuinely unbookable ones and their ot_hours is NULL forever.
--
-- ⚠️ AND THE HOLE IS WORSE THAN "REFUSED": muster_scan_out carried NO date check
--    and NO closure check, so a site_admin could close those nine today — with
--    out_at = now() and ot_hours priced at ~13 days. Permitted-and-wrong, which
--    no test can see because ot_hours has no consumer that would notice.
--    Section H closes it.
--
-- OPERATOR RULINGS 2026-08-06 (spec §2, all four forks):
--   1. Shape        → ONE new RPC, muster_correct_session. Both cockpit RPCs keep
--                     their bodies. The alternative (optional params) forces
--                     widening muster_scan_out to procurement — handing the live
--                     cockpit write path to a role with no cockpit.
--   2. Audience     → the CORRECTION audience only, {super_admin,
--                     procurement_manager, procurement}. site_admin has no
--                     surface that reaches a past day, so granting it there is
--                     privilege with no door. PLUS close the scan_out hole.
--   3. Bounds       → in_at on the row's own Bangkok work_date; out_at >= in_at,
--                     <= now(), and no later than work_date+1 06:00 so a night OT
--                     crossing midnight stays recordable. (Live precedent for the
--                     spill: ZERO rows in 228 — headroom, not an observed case.)
--   4. Overwrite    → close_muster_day keeps auto-outing, so U3b's shipped
--                     disclosure stays true; a correction may replace a
--                     FABRICATED auto-out (out_auto = true, 17 live rows) and is
--                     refused on a human-recorded one.
--
-- MONEY, verified from the live body rather than assumed:
-- derive_muster_labor_internal reads only `session='regular' and in_at is not
-- null` and takes day_fraction from the muster_team_wps COUNT. It never reads
-- in_at/out_at values or ot_hours ⇒ neither timestamp moves a derived wage today.
-- That is exactly why this defect is invisible to every money test, and why the
-- window is open while labor_logs is still 0 rows. But ot_hours is NOT inert:
-- muster_scan_out prices it, and attendance-month.ts / attendance-sessions.ts /
-- attendance-audit.ts all read it — so section D pins that a back-dated out_at
-- re-prices from (out_at − in_at) and never from now().
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('70000000-0401-0401-0401-000000000009', 'super@s401.local', '{}'::jsonb),
  ('70000000-0401-0401-0401-00000000000c', 'proc@s401.local',  '{}'::jsonb),
  ('70000000-0401-0401-0401-00000000000d', 'sa@s401.local',    '{}'::jsonb),
  ('70000000-0401-0401-0401-00000000000e', 'pmgr@s401.local',  '{}'::jsonb),
  ('70000000-0401-0401-0401-0000000000fe', 'probe@s401.local', '{}'::jsonb);
update public.users set role = 'super_admin'         where id = '70000000-0401-0401-0401-000000000009';
update public.users set role = 'procurement'         where id = '70000000-0401-0401-0401-00000000000c';
update public.users set role = 'site_admin'          where id = '70000000-0401-0401-0401-00000000000d';
update public.users set role = 'procurement_manager' where id = '70000000-0401-0401-0401-00000000000e';

insert into public.projects (id, code, name) values
  ('a1000000-0401-0401-0401-000000000001', 'TAP-401A', 'โครงการเอ'),
  ('a2000000-0401-0401-0401-000000000002', 'TAP-401B', 'โครงการบี');

-- The site_admin is a member of A only, and the procurement_manager of neither:
-- can_see_project's arm 1 is unconditional for procurement_manager, so it is the
-- positive control that the cross-project arm is procurement-SPECIFIC and not a
-- membership widening.
insert into public.project_members (project_id, user_id, added_by) values
  ('a1000000-0401-0401-0401-000000000001', '70000000-0401-0401-0401-00000000000d',
   '70000000-0401-0401-0401-000000000009');

-- One worker per (team, date) pair that carries a row: muster_attendance is
-- UNIQUE (worker_id, work_date, session), so reusing a worker across same-date
-- teams reds on the constraint instead of on the thing under test.
insert into public.workers (id, name, pay_type, employment_type, day_rate, active, created_by)
select id, name, 'daily', 'temporary', 400, true, '70000000-0401-0401-0401-000000000009'
  from (values
    ('e1000000-0401-0401-0401-000000000001'::uuid, 'ช่าง หนึ่ง'),
    ('e1000000-0401-0401-0401-000000000002'::uuid, 'ช่าง สอง'),
    ('e1000000-0401-0401-0401-000000000003'::uuid, 'ช่าง สาม'),
    ('e1000000-0401-0401-0401-000000000004'::uuid, 'ช่าง สี่'),
    ('e1000000-0401-0401-0401-000000000005'::uuid, 'ช่าง ห้า'),
    ('e1000000-0401-0401-0401-000000000006'::uuid, 'ช่าง หก'),
    ('e1000000-0401-0401-0401-000000000007'::uuid, 'ช่าง เจ็ด'),
    ('e1000000-0401-0401-0401-000000000008'::uuid, 'ช่าง แปด'),
    ('e1000000-0401-0401-0401-000000000009'::uuid, 'ช่าง เก้า')
  ) as w(id, name);

-- Separate dates per concern so one assertion's write cannot move another's
-- precondition. 07-20 OPEN (the insert path + the gate drives) · 07-21 CLOSED
-- (the OT retime — the 2026-07-24 population in miniature) · 07-22 OPEN (the
-- overwrite fork) · 07-23 on project B (the cross-project arm) · today (the
-- scan_out positive control, which must keep working after the narrowing).
insert into public.muster_teams (id, project_id, work_date, lead_worker_id, created_by) values
  ('71000000-0401-0401-0401-000000000020', 'a1000000-0401-0401-0401-000000000001', '2026-07-20',
   'e1000000-0401-0401-0401-000000000001', '70000000-0401-0401-0401-000000000009'),
  ('71000000-0401-0401-0401-000000000021', 'a1000000-0401-0401-0401-000000000001', '2026-07-21',
   'e1000000-0401-0401-0401-000000000001', '70000000-0401-0401-0401-000000000009'),
  ('71000000-0401-0401-0401-000000000022', 'a1000000-0401-0401-0401-000000000001', '2026-07-22',
   'e1000000-0401-0401-0401-000000000001', '70000000-0401-0401-0401-000000000009'),
  ('71000000-0401-0401-0401-000000000023', 'a2000000-0401-0401-0401-000000000002', '2026-07-23',
   'e1000000-0401-0401-0401-000000000003', '70000000-0401-0401-0401-000000000009'),
  ('71000000-0401-0401-0401-000000000024', 'a1000000-0401-0401-0401-000000000001',
   (now() at time zone 'Asia/Bangkok')::date,
   'e1000000-0401-0401-0401-000000000001', '70000000-0401-0401-0401-000000000009');

-- 07-21 is the CLOSED day. Its OT row is the whole reason U4 exists: closing a
-- day does not touch session='ot', so this row can never be given an out_at by
-- any surface that exists before this migration.
insert into public.muster_day_closures (project_id, work_date, closed_at, closed_by) values
  ('a1000000-0401-0401-0401-000000000001', '2026-07-21', now(),
   '70000000-0401-0401-0401-000000000009');

insert into public.muster_attendance
  (id, team_id, worker_id, work_date, session, in_at, in_method, out_at, out_method, out_auto, scanned_by)
values
  -- W1: the open OT row on the CLOSED day — section D's subject.
  ('c1000000-0401-0401-0401-000000000001', '71000000-0401-0401-0401-000000000021',
   'e1000000-0401-0401-0401-000000000001', '2026-07-21', 'ot',
   '2026-07-21 17:30+07', 'qr', null, null, false, '70000000-0401-0401-0401-000000000009'),
  -- W2: a FABRICATED auto-out (what close_muster_day stamps) — replaceable.
  ('c1000000-0401-0401-0401-000000000002', '71000000-0401-0401-0401-000000000022',
   'e1000000-0401-0401-0401-000000000002', '2026-07-22', 'regular',
   '2026-07-22 08:00+07', 'qr', '2026-07-22 17:00+07', 'manual', true,
   '70000000-0401-0401-0401-000000000009'),
  -- W3: a HUMAN-recorded out — refused, per fork 4.
  ('c1000000-0401-0401-0401-000000000003', '71000000-0401-0401-0401-000000000022',
   'e1000000-0401-0401-0401-000000000003', '2026-07-22', 'regular',
   '2026-07-22 08:00+07', 'qr', '2026-07-22 16:30+07', 'qr', false,
   '70000000-0401-0401-0401-000000000009'),
  -- W4: the wrong in_at — section C retimes it. Stamped as a correction would
  -- have stamped it before this unit: at the correction moment, not on the day.
  ('c1000000-0401-0401-0401-000000000004', '71000000-0401-0401-0401-000000000020',
   'e1000000-0401-0401-0401-000000000004', '2026-07-20', 'regular',
   now(), 'manual', null, null, false, '70000000-0401-0401-0401-000000000009'),
  -- W7: project B, for the cross-project arm.
  ('c1000000-0401-0401-0401-000000000007', '71000000-0401-0401-0401-000000000023',
   'e1000000-0401-0401-0401-000000000007', '2026-07-23', 'regular',
   '2026-07-23 08:00+07', 'qr', null, null, false, '70000000-0401-0401-0401-000000000009'),
  -- W8: the wages-booked subject (section F).
  ('c1000000-0401-0401-0401-000000000008', '71000000-0401-0401-0401-000000000020',
   'e1000000-0401-0401-0401-000000000008', '2026-07-20', 'regular',
   '2026-07-20 08:00+07', 'qr', null, null, false, '70000000-0401-0401-0401-000000000009'),
  -- W9: today's open session — the scan_out positive control.
  ('c1000000-0401-0401-0401-000000000009', '71000000-0401-0401-0401-000000000024',
   'e1000000-0401-0401-0401-000000000009', (now() at time zone 'Asia/Bangkok')::date, 'regular',
   now() - interval '3 hours', 'qr', null, null, false, '70000000-0401-0401-0401-000000000009');

-- Section F needs a CURRENT wage row for W8 and a SUPERSEDED one for W4. The
-- distinction is the point: labor_logs is append-only and a retraction is a
-- null-fraction supersede row (ADR 0009/0015), so a bare exists() would freeze a
-- row forever for a wage that is no longer current — the same anti-join
-- muster_undo_scan carries.
insert into public.work_packages (id, project_id, code, name) values
  ('d1000000-0401-0401-0401-000000000001', 'a1000000-0401-0401-0401-000000000001',
   'W401-01', 'งานทดสอบ');

-- ⚠️ The tombstone needs `correction_reason` — labor_logs_reason_iff_correction
-- ties a reason to any supersede row. Written with derive's own value so the
-- fixture is the shape production actually produces.
insert into public.labor_logs
  (id, work_package_id, worker_id, work_date, day_fraction, day_rate_snapshot,
   worker_name_snapshot, pay_type_snapshot, wht_pct_snapshot, source_muster_id,
   entered_by, self_logged, superseded_by, correction_reason)
values
  -- CURRENT wage for W8 → blocks.
  ('f1000000-0401-0401-0401-000000000008', 'd1000000-0401-0401-0401-000000000001',
   'e1000000-0401-0401-0401-000000000008', '2026-07-20', 'full', 400, 'ช่าง แปด',
   'daily', 0, 'c1000000-0401-0401-0401-000000000008',
   '70000000-0401-0401-0401-000000000009', false, null, null),
  -- W4's wage, then its tombstone → must NOT block.
  ('f1000000-0401-0401-0401-000000000004', 'd1000000-0401-0401-0401-000000000001',
   'e1000000-0401-0401-0401-000000000004', '2026-07-20', 'full', 400, 'ช่าง สี่',
   'daily', 0, 'c1000000-0401-0401-0401-000000000004',
   '70000000-0401-0401-0401-000000000009', false, null, null),
  ('f1000000-0401-0401-0401-00000000000f', 'd1000000-0401-0401-0401-000000000001',
   'e1000000-0401-0401-0401-000000000004', '2026-07-20', null, 400, 'ช่าง สี่',
   'daily', 0, 'c1000000-0401-0401-0401-000000000004',
   '70000000-0401-0401-0401-000000000009', false, 'f1000000-0401-0401-0401-000000000004',
   'muster_rederive');

-- The runner rewrites each assertion into an insert on the temp collector, and
-- this file asserts WHILE `set local role authenticated` — a fresh temp table
-- grants `authenticated` nothing, so without this the first post-switch assert
-- dies 42501 and the WHOLE file reports `not ok` with zero assertions run.
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Shape and grants. A new table is born public in this project and so is a
--    new FUNCTION: the default grants hand EXECUTE to anon and authenticated, so
--    the revoke is the posture, not the absence of a grant.
-- ============================================================================
select has_function('public', 'muster_correct_session',
  array['uuid', 'uuid', 'muster_session', 'timestamptz', 'timestamptz'],
  'muster_correct_session(team, worker, session, in_at, out_at) exists');
select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'muster_correct_session'),
  true, 'muster_correct_session is SECURITY DEFINER');
select ok(
  has_function_privilege('authenticated',
    'public.muster_correct_session(uuid,uuid,muster_session,timestamptz,timestamptz)', 'EXECUTE'),
  'authenticated may execute muster_correct_session');
select ok(
  not has_function_privilege('anon',
    'public.muster_correct_session(uuid,uuid,muster_session,timestamptz,timestamptz)', 'EXECUTE'),
  'anon may NOT execute muster_correct_session (default grants revoked)');
-- Fork 1 in one assertion: the cockpit RPCs keep their signatures, so no caller
-- of muster_scan_in / muster_scan_out had to change for this unit.
select has_function('public', 'muster_scan_in',
  array['uuid', 'uuid', 'muster_method', 'muster_session'],
  'muster_scan_in keeps its signature (fork 1: the correction is a NEW function)');
select has_function('public', 'muster_scan_out',
  array['uuid', 'uuid', 'muster_method', 'muster_session'],
  'muster_scan_out keeps its signature');

-- ============================================================================
-- B. The gate, driven BEHAVIOURALLY. U3a's lesson: a role-set read from the body
--    cannot see a gate one layer down, and only a real call reports the SQLSTATE
--    of the layer that actually refused.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0401-0401-0401-00000000000c"}';
select lives_ok(
  $$select public.muster_correct_session(
      '71000000-0401-0401-0401-000000000020'::uuid,
      'e1000000-0401-0401-0401-000000000004'::uuid, 'regular'::public.muster_session,
      '2026-07-20 08:15+07'::timestamptz, null)$$,
  'procurement may correct a session');
reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0401-0401-0401-00000000000e"}';
select lives_ok(
  $$select public.muster_correct_session(
      '71000000-0401-0401-0401-000000000020'::uuid,
      'e1000000-0401-0401-0401-000000000004'::uuid, 'regular'::public.muster_session,
      '2026-07-20 08:20+07'::timestamptz, null)$$,
  'procurement_manager may correct a session');
reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0401-0401-0401-000000000009"}';
select lives_ok(
  $$select public.muster_correct_session(
      '71000000-0401-0401-0401-000000000020'::uuid,
      'e1000000-0401-0401-0401-000000000004'::uuid, 'regular'::public.muster_session,
      '2026-07-20 08:25+07'::timestamptz, null)$$,
  'super_admin may correct a session');
reset role;

-- THE NARROWING, and it is the fork-2 decision made testable: site_admin holds
-- muster_scan_in, muster_scan_out and the whole cockpit, and is deliberately NOT
-- here. Every surface that reaches a past day is gated on ATTENDANCE_AUDIT_ROLES,
-- which has no site_admin, so granting it would be privilege with no door.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0401-0401-0401-00000000000d"}';
select throws_ok(
  $$select public.muster_correct_session(
      '71000000-0401-0401-0401-000000000020'::uuid,
      'e1000000-0401-0401-0401-000000000004'::uuid, 'regular'::public.muster_session,
      '2026-07-20 08:30+07'::timestamptz, null)$$,
  '42501', 'muster_correct_session: role not permitted',
  'site_admin may NOT back-date — the correction audience is narrower than the cockpit');
reset role;

update public.users set role = 'project_manager' where id = '70000000-0401-0401-0401-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0401-0401-0401-0000000000fe"}';
select throws_ok(
  $$select public.muster_correct_session(
      '71000000-0401-0401-0401-000000000020'::uuid,
      'e1000000-0401-0401-0401-000000000004'::uuid, 'regular'::public.muster_session,
      '2026-07-20 08:30+07'::timestamptz, null)$$,
  '42501', 'muster_correct_session: role not permitted',
  'project_manager may NOT back-date');
reset role;

update public.users set role = 'technician' where id = '70000000-0401-0401-0401-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0401-0401-0401-0000000000fe"}';
select throws_ok(
  $$select public.muster_correct_session(
      '71000000-0401-0401-0401-000000000020'::uuid,
      'e1000000-0401-0401-0401-000000000004'::uuid, 'regular'::public.muster_session,
      '2026-07-20 08:30+07'::timestamptz, null)$$,
  '42501', 'muster_correct_session: role not permitted',
  'technician may NOT back-date');
reset role;

-- The rls-self-check-coalesce trap: `null not in (...)` is NULL, which an IF
-- treats as not-true, so an unbound caller falls THROUGH a naive gate.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0401-0401-0401-000000000000"}';
select throws_ok(
  $$select public.muster_correct_session(
      '71000000-0401-0401-0401-000000000020'::uuid,
      'e1000000-0401-0401-0401-000000000004'::uuid, 'regular'::public.muster_session,
      '2026-07-20 08:30+07'::timestamptz, null)$$,
  '42501', 'muster_correct_session: role not permitted',
  'an unbound caller (null role) is DENIED — the gate does not fall open');
reset role;

-- The cross-project arm, both directions. procurement reads and corrects every
-- project (spec 397); a member-scoped role does not.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0401-0401-0401-00000000000c"}';
select lives_ok(
  $$select public.muster_correct_session(
      '71000000-0401-0401-0401-000000000023'::uuid,
      'e1000000-0401-0401-0401-000000000007'::uuid, 'regular'::public.muster_session,
      '2026-07-23 08:10+07'::timestamptz, null)$$,
  'procurement corrects a project it is not a member of (cross-project arm)');
reset role;

-- ============================================================================
-- C. The back-dated CHECK-IN — U3b's finding 1, and the bounds from fork 3.
-- ============================================================================
select is(
  (select in_at from public.muster_attendance
    where id = 'c1000000-0401-0401-0401-000000000004'),
  '2026-07-20 08:25+07'::timestamptz,
  'the corrected in_at is the supplied time, not the correction moment');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0401-0401-0401-00000000000c"}';
-- The grain the grid renders is (worker × work_date). A stamp on another date
-- would make the cell and its own timestamp disagree.
select throws_ok(
  $$select public.muster_correct_session(
      '71000000-0401-0401-0401-000000000020'::uuid,
      'e1000000-0401-0401-0401-000000000004'::uuid, 'regular'::public.muster_session,
      '2026-07-19 08:00+07'::timestamptz, null)$$,
  'P0001', 'muster_correct_session: check-in time must fall on the work date',
  'an in_at on a DIFFERENT date is refused');
select throws_ok(
  $$select public.muster_correct_session(
      '71000000-0401-0401-0401-000000000020'::uuid,
      'e1000000-0401-0401-0401-000000000004'::uuid, 'regular'::public.muster_session,
      (now() + interval '2 days')::timestamptz, null)$$,
  'P0001', 'muster_correct_session: check-in time must fall on the work date',
  'a FUTURE in_at is refused');
-- Neither timestamp supplied is a no-op that would still write an audit row
-- claiming a correction happened.
select throws_ok(
  $$select public.muster_correct_session(
      '71000000-0401-0401-0401-000000000020'::uuid,
      'e1000000-0401-0401-0401-000000000004'::uuid, 'regular'::public.muster_session,
      null, null)$$,
  'P0001', 'muster_correct_session: nothing to correct',
  'a call with neither timestamp is refused rather than audited as a correction');
reset role;

-- ============================================================================
-- D. The back-dated CHECK-OUT — the nine 2026-07-24 OT rows in miniature.
--    The day is CLOSED here on purpose: that is the population, and refusing a
--    closed day would leave U4 unable to fix the very rows it exists for. What
--    guards a closed day is the WAGE check in section F, not the closure itself.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0401-0401-0401-00000000000c"}';
select lives_ok(
  $$select public.muster_correct_session(
      '71000000-0401-0401-0401-000000000021'::uuid,
      'e1000000-0401-0401-0401-000000000001'::uuid, 'ot'::public.muster_session,
      null, '2026-07-21 21:10+07'::timestamptz)$$,
  'an OT session on a CLOSED day can finally be given its real check-out');
reset role;

select is(
  (select out_at from public.muster_attendance
    where id = 'c1000000-0401-0401-0401-000000000001'),
  '2026-07-21 21:10+07'::timestamptz,
  'the OT check-out is the supplied time');
-- 17:30 → 21:10 is 3h40m, floored to the half hour = 3.5. Priced from the SPAN,
-- never from now(): the old path would have written ~16 days of OT here.
select is(
  (select ot_hours from public.muster_attendance
    where id = 'c1000000-0401-0401-0401-000000000001'),
  3.5::numeric,
  'ot_hours is re-priced from (out_at − in_at), not from now()');
select is(
  (select out_auto from public.muster_attendance
    where id = 'c1000000-0401-0401-0401-000000000001'),
  false,
  'a corrected check-out is not marked auto — it is a recorded fact now');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0401-0401-0401-00000000000c"}';
select throws_ok(
  $$select public.muster_correct_session(
      '71000000-0401-0401-0401-000000000020'::uuid,
      'e1000000-0401-0401-0401-000000000004'::uuid, 'regular'::public.muster_session,
      null, '2026-07-20 07:00+07'::timestamptz)$$,
  'P0001', 'muster_correct_session: check-out cannot precede check-in',
  'an out_at BEFORE the in_at is refused');
-- Fork 3's spill bound. 06:00 the next morning is the edge: a night OT crossing
-- midnight stays recordable, a stamp two days later does not.
select throws_ok(
  $$select public.muster_correct_session(
      '71000000-0401-0401-0401-000000000020'::uuid,
      'e1000000-0401-0401-0401-000000000004'::uuid, 'regular'::public.muster_session,
      null, '2026-07-21 06:30+07'::timestamptz)$$,
  'P0001', 'muster_correct_session: check-out is too late for this work date',
  'an out_at past the next morning''s 06:00 is refused');
select lives_ok(
  $$select public.muster_correct_session(
      '71000000-0401-0401-0401-000000000020'::uuid,
      'e1000000-0401-0401-0401-000000000004'::uuid, 'regular'::public.muster_session,
      null, '2026-07-21 05:30+07'::timestamptz)$$,
  'a night session crossing midnight IS recordable (the spill bound, positive control)');
select throws_ok(
  $$select public.muster_correct_session(
      '71000000-0401-0401-0401-000000000024'::uuid,
      'e1000000-0401-0401-0401-000000000009'::uuid, 'regular'::public.muster_session,
      null, (now() + interval '2 hours')::timestamptz)$$,
  'P0001', 'muster_correct_session: a time cannot be in the future',
  'a FUTURE out_at is refused');
reset role;

-- ============================================================================
-- E. Fork 4 — a fabricated auto-out may be replaced, a recorded one may not.
--    The PAIR is the assertion: a refusal on its own cannot distinguish "the
--    rule works" from "everything is refused".
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0401-0401-0401-00000000000c"}';
select lives_ok(
  $$select public.muster_correct_session(
      '71000000-0401-0401-0401-000000000022'::uuid,
      'e1000000-0401-0401-0401-000000000002'::uuid, 'regular'::public.muster_session,
      null, '2026-07-22 19:45+07'::timestamptz)$$,
  'the fabricated 17:00 auto-out MAY be replaced with the real time');
select throws_ok(
  $$select public.muster_correct_session(
      '71000000-0401-0401-0401-000000000022'::uuid,
      'e1000000-0401-0401-0401-000000000003'::uuid, 'regular'::public.muster_session,
      null, '2026-07-22 19:45+07'::timestamptz)$$,
  'P0001', 'muster_correct_session: a recorded check-out cannot be replaced',
  'a HUMAN-recorded check-out may NOT be overwritten');
reset role;
select is(
  (select out_at from public.muster_attendance
    where id = 'c1000000-0401-0401-0401-000000000002'),
  '2026-07-22 19:45+07'::timestamptz,
  'the replaced auto-out really changed');
select is(
  (select out_at from public.muster_attendance
    where id = 'c1000000-0401-0401-0401-000000000003'),
  '2026-07-22 16:30+07'::timestamptz,
  'the recorded check-out was left exactly as the person on site left it');

-- ============================================================================
-- F. The money guard. Mirrors muster_undo_scan's, including its ANTI-JOIN: a
--    retracted wage is a null-fraction supersede row, so a bare exists() would
--    freeze the attendance row forever for a wage that is no longer current.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0401-0401-0401-00000000000c"}';
select throws_ok(
  $$select public.muster_correct_session(
      '71000000-0401-0401-0401-000000000020'::uuid,
      'e1000000-0401-0401-0401-000000000008'::uuid, 'regular'::public.muster_session,
      '2026-07-20 07:30+07'::timestamptz, null)$$,
  'P0001', 'muster_correct_session: wages are already booked for this check-in',
  'a check-in with a CURRENT wage row may not be retimed');
-- W4 carries a wage row too — a RETRACTED one. Every correction above already
-- succeeded on it, which is this assertion made continuously; stated once
-- explicitly so the anti-join has a named pin.
select lives_ok(
  $$select public.muster_correct_session(
      '71000000-0401-0401-0401-000000000020'::uuid,
      'e1000000-0401-0401-0401-000000000004'::uuid, 'regular'::public.muster_session,
      '2026-07-20 08:05+07'::timestamptz, null)$$,
  'a RETRACTED (superseded) wage row does not block — anti-join, not exists()');
reset role;

-- ============================================================================
-- G. The insert path — adding a missing person, with the bounds U3a set for the
--    correction arm applied to EVERY caller of this function rather than only to
--    procurement. It delegates to muster_scan_in so the invariants (already
--    mustered elsewhere, OT only after a regular session, unknown worker) live
--    in one place instead of being restated here.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0401-0401-0401-00000000000c"}';
select lives_ok(
  $$select public.muster_correct_session(
      '71000000-0401-0401-0401-000000000020'::uuid,
      'e1000000-0401-0401-0401-000000000005'::uuid, 'regular'::public.muster_session,
      '2026-07-20 08:00+07'::timestamptz, '2026-07-20 17:15+07'::timestamptz)$$,
  'a missing person can be added to an open past day WITH both real times');
select throws_ok(
  $$select public.muster_correct_session(
      '71000000-0401-0401-0401-000000000021'::uuid,
      'e1000000-0401-0401-0401-000000000006'::uuid, 'regular'::public.muster_session,
      '2026-07-21 08:00+07'::timestamptz, null)$$,
  'P0001', 'muster_correct_session: a missing person may only be added to an open day',
  'adding a person to a CLOSED day is refused (reopen first — they hold that)');
select throws_ok(
  $$select public.muster_correct_session(
      '71000000-0401-0401-0401-000000000020'::uuid,
      'e1000000-0401-0401-0401-000000000006'::uuid, 'ot'::public.muster_session,
      '2026-07-20 18:00+07'::timestamptz, null)$$,
  'P0001', 'muster_correct_session: a correction may only add a regular session',
  'a correction may not CREATE an OT session — ot is ×1.5 money (spec 351)');
select throws_ok(
  $$select public.muster_correct_session(
      '71000000-0401-0401-0401-000000000020'::uuid,
      'e1000000-0401-0401-0401-000000000006'::uuid, 'regular'::public.muster_session,
      null, '2026-07-20 17:00+07'::timestamptz)$$,
  'P0001', 'muster_correct_session: a check-in time is required to add a missing person',
  'adding a person with only a check-out is refused');
reset role;
select is(
  (select in_at from public.muster_attendance
    where worker_id = 'e1000000-0401-0401-0401-000000000005' and work_date = '2026-07-20'),
  '2026-07-20 08:00+07'::timestamptz,
  'the added person carries the SUPPLIED in_at, not now() — U3b finding 1 closed');
select is(
  (select out_at from public.muster_attendance
    where worker_id = 'e1000000-0401-0401-0401-000000000005' and work_date = '2026-07-20'),
  '2026-07-20 17:15+07'::timestamptz,
  'and the supplied out_at — so close_muster_day cannot fabricate a zero-length session');

-- ============================================================================
-- H. muster_scan_out's new window — the "permitted and wrong" hole.
--    Before this, an SA could close 07-24's nine OT rows TODAY at out_at = now(),
--    pricing ot_hours at ~13 days. The narrowing removes a capability from
--    site_admin and procurement_manager; it is a BAD capability, and the fork-2
--    ruling took it deliberately.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0401-0401-0401-00000000000d"}';
select throws_ok(
  $$select public.muster_scan_out(
      '71000000-0401-0401-0401-000000000021'::uuid,
      'e1000000-0401-0401-0401-000000000001'::uuid, 'manual'::public.muster_method,
      'ot'::public.muster_session)$$,
  'P0001', 'muster_scan_out: this session belongs to an earlier day',
  'the SA may no longer stamp now() onto an old session');
-- POSITIVE CONTROL, and without it the assertion above proves nothing: the same
-- role, the same call shape, on TODAY's session, still works. The cockpit is the
-- surface this RPC exists for and it must be untouched.
select lives_ok(
  $$select public.muster_scan_out(
      '71000000-0401-0401-0401-000000000024'::uuid,
      'e1000000-0401-0401-0401-000000000009'::uuid, 'qr'::public.muster_method,
      'regular'::public.muster_session)$$,
  'the SA''s ordinary same-day check-out is UNCHANGED (positive control)');
reset role;

-- ============================================================================
-- I. The audit trail. A correction that leaves no record is the hole the whole
--    spec was written to find. Convention per reopen_muster_day / U3a: an
--    EXISTING action plus a payload `kind`, never a new enum value.
-- ============================================================================
select ok(
  exists (select 1 from public.audit_log
           where target_table = 'muster_attendance'
             and payload->>'kind' = 'muster_correction_time'
             and actor_role = 'procurement'),
  'a retime writes an audit row naming it a time correction');
-- The previous values are the only surviving copy of what the row said before.
-- Pinned against the ONE row whose old value is known (W2's fabricated 17:00),
-- not with an `is not null` over the whole table — that would pass on any row.
select ok(
  exists (select 1 from public.audit_log
           where payload->>'kind' = 'muster_correction_time'
             and target_id = 'c1000000-0401-0401-0401-000000000002'
             and (payload->'before'->>'out_at')::timestamptz = '2026-07-22 17:00+07'::timestamptz),
  'the audit payload carries the exact value the correction replaced');
select ok(
  exists (select 1 from public.audit_log
           where payload->>'kind' = 'muster_correction_time'
             and actor_role = 'super_admin'),
  'the audit row is written for EVERY corrector, not only procurement');

select * from finish();
rollback;
