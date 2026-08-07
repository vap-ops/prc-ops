begin;
select plan(33);

-- ============================================================================
-- Spec 400 U5 — the correction TRAIL: who edited this project-day after the fact.
--
-- U3a/U3b/U4/U3c shipped the WRITE side, and every one of those writes already
-- lands an `audit_log` row. Nothing in `src/` reads them, and the read is not a
-- matter of writing a query: `audit_log`'s RLS gives `procurement` and
-- `procurement_manager` SELECT on exactly two payload kinds —
-- `wp_reopened_for_defect` and `wp_evidence_resubmitted` — so the people making
-- the corrections cannot see their own trail on the session client.
--
-- ⭐ THE MEASUREMENT THAT SHAPED THE QUERY, taken from the LIVE rows and not from
-- the migration files: `muster_move` and `muster_undo` payloads carry NO
-- `project_id`. `muster_move` carries from_team/to_team, `muster_undo` carries
-- team_id, and both must be resolved through `muster_teams`. 13 of the 16 live
-- rows are `muster_move`, so a payload-only filter would have rendered an EMPTY
-- trail on every real day while every assertion about the other four kinds passed.
-- Section C is that pin, and it is the one this file exists for.
--
-- Gate and scope are TWO role lists, the shape spec 397 established and 400 U3c
-- copied:
--   gate  = ATTENDANCE_AUDIT_ROLES — the 8 roles that already open the report
--   scope = the cross-project tier passes any project; `project_manager` alone
--           must pass can_see_project
-- An unseeable project is a REFUSAL, not an empty list: an empty trail reads as
-- "nobody edited this day", which is a different fact and the one a reader acts on.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('70000000-0405-0405-0405-000000000009', 'super@s405.local', '{}'::jsonb),
  ('70000000-0405-0405-0405-00000000000c', 'proc@s405.local',  '{}'::jsonb),
  ('70000000-0405-0405-0405-00000000000d', 'sa@s405.local',    '{}'::jsonb),
  ('70000000-0405-0405-0405-00000000000e', 'pmgr@s405.local',  '{}'::jsonb),
  ('70000000-0405-0405-0405-00000000000f', 'pm@s405.local',    '{}'::jsonb),
  ('70000000-0405-0405-0405-0000000000fe', 'probe@s405.local', '{}'::jsonb);
update public.users set role = 'super_admin'         where id = '70000000-0405-0405-0405-000000000009';
update public.users set role = 'procurement'         where id = '70000000-0405-0405-0405-00000000000c';
update public.users set role = 'site_admin'          where id = '70000000-0405-0405-0405-00000000000d';
update public.users set role = 'procurement_manager' where id = '70000000-0405-0405-0405-00000000000e';
update public.users set role = 'project_manager'     where id = '70000000-0405-0405-0405-00000000000f';

-- The actor whose name the trail must print. `full_name` is the display name the
-- rest of the app uses; a NULL one is the real case for 4 of the 5 live site
-- admins, which is why the null arm has its own assertion in section D.
update public.users set full_name = 'คุณเอ ผู้แก้ไข' where id = '70000000-0405-0405-0405-00000000000c';

insert into public.projects (id, code, name) values
  ('a1000000-0405-0405-0405-000000000001', 'TAP-405A', 'โครงการเอ'),
  ('a2000000-0405-0405-0405-000000000002', 'TAP-405B', 'โครงการบี');

insert into public.workers (id, name, pay_type, employment_type, day_rate, active, created_by)
select id, name, 'daily', 'temporary', 400, true, '70000000-0405-0405-0405-000000000009'
  from (values
    ('e1000000-0405-0405-0405-000000000001'::uuid, 'หัวหน้า หนึ่ง'),
    ('e1000000-0405-0405-0405-000000000002'::uuid, 'หัวหน้า สอง'),
    ('e1000000-0405-0405-0405-000000000003'::uuid, 'ลูกทีม สาม')
  ) as w(id, name);

insert into public.muster_teams (id, project_id, work_date, lead_worker_id, created_by) values
  ('71000000-0405-0405-0405-000000000010', 'a1000000-0405-0405-0405-000000000001', '2026-07-20',
   'e1000000-0405-0405-0405-000000000001', '70000000-0405-0405-0405-000000000009'),
  ('71000000-0405-0405-0405-000000000011', 'a1000000-0405-0405-0405-000000000001', '2026-07-20',
   'e1000000-0405-0405-0405-000000000002', '70000000-0405-0405-0405-000000000009'),
  ('71000000-0405-0405-0405-000000000012', 'a2000000-0405-0405-0405-000000000002', '2026-07-20',
   'e1000000-0405-0405-0405-000000000001', '70000000-0405-0405-0405-000000000009');

-- ============================================================================
-- The six audit shapes, written EXACTLY as their producing functions write them.
-- Four carry `project_id`; `muster_undo` and `muster_move` do not, and that
-- asymmetry is the whole reason section C exists.
-- ============================================================================
insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload, created_at) values
  -- 1. add-person (muster_scan_in's correction arm). Carries project_id.
  ('crew_change', '70000000-0405-0405-0405-00000000000c', 'procurement', 'muster_attendance',
   '71000000-0405-0405-0405-000000000010',
   jsonb_build_object(
     'kind', 'muster_correction_scan_in',
     'project_id', 'a1000000-0405-0405-0405-000000000001',
     'work_date', '2026-07-20',
     'team_id', '71000000-0405-0405-0405-000000000010',
     'worker_id', 'e1000000-0405-0405-0405-000000000003',
     'session', 'regular',
     'method', 'manual'),
   '2026-07-21 09:00+07'),
  -- 2. retime (muster_correct_session). Carries project_id AND the whole prior row.
  ('crew_change', '70000000-0405-0405-0405-00000000000c', 'procurement', 'muster_attendance',
   '71000000-0405-0405-0405-000000000010',
   jsonb_build_object(
     'kind', 'muster_correction_time',
     'project_id', 'a1000000-0405-0405-0405-000000000001',
     'work_date', '2026-07-20',
     'team_id', '71000000-0405-0405-0405-000000000010',
     'worker_id', 'e1000000-0405-0405-0405-000000000003',
     'session', 'regular',
     -- ⚠️ ISO-8601 UTC strings, because that is what a timestamptz becomes when
     -- jsonb_build_object / to_jsonb writes it — read off the one real live row
     -- (`"2026-08-05T00:45:00+00:00"`). A hand-written '…+07' literal would pin an
     -- encoding the app never meets and hide the timezone work from the caller.
     'in_at', '2026-07-20T00:45:00+00:00',
     'out_at', '2026-07-20T10:30:00+00:00',
     'before', jsonb_build_object(
       'in_at', '2026-07-20T02:12:00+00:00',
       'out_at', null)),
   '2026-07-21 09:05+07'),
  -- 3. undo (muster_undo_scan). NO project_id — team_id only.
  ('crew_change', '70000000-0405-0405-0405-000000000009', 'super_admin', 'muster_attendance',
   '71000000-0405-0405-0405-000000000010',
   jsonb_build_object(
     'kind', 'muster_undo',
     'work_date', '2026-07-20',
     'team_id', '71000000-0405-0405-0405-000000000010',
     'worker_id', 'e1000000-0405-0405-0405-000000000003',
     'session', 'regular',
     'row', jsonb_build_object(
       'in_at', '2026-07-20T01:00:00+00:00',
       'out_at', '2026-07-20T10:00:00+00:00')),
   '2026-07-21 09:10+07'),
  -- 4. move (move_muster_worker). NO project_id — from_team/to_team only.
  ('crew_change', '70000000-0405-0405-0405-000000000009', 'super_admin', 'muster_attendance',
   '71000000-0405-0405-0405-000000000010',
   jsonb_build_object(
     'kind', 'muster_move',
     'work_date', '2026-07-20',
     'worker_id', 'e1000000-0405-0405-0405-000000000003',
     'from_team', '71000000-0405-0405-0405-000000000010',
     'to_team', '71000000-0405-0405-0405-000000000011'),
   '2026-07-21 09:15+07'),
  -- 5. close (close_muster_day). Carries project_id, no worker.
  ('crew_change', '70000000-0405-0405-0405-00000000000e', 'procurement_manager', 'muster_day_closures',
   'a1000000-0405-0405-0405-000000000001',
   jsonb_build_object(
     'kind', 'muster_day_close',
     'project_id', 'a1000000-0405-0405-0405-000000000001',
     'work_date', '2026-07-20'),
   '2026-07-21 09:20+07'),
  -- 6. reopen (reopen_muster_day). Carries project_id and the operator's reason.
  ('crew_change', '70000000-0405-0405-0405-00000000000e', 'procurement_manager', 'muster_day_closures',
   'a1000000-0405-0405-0405-000000000001',
   jsonb_build_object(
     'kind', 'muster_day_reopen',
     'project_id', 'a1000000-0405-0405-0405-000000000001',
     'work_date', '2026-07-20',
     'reason', 'ลืมบันทึกคนงาน 1 คน',
     'closure', jsonb_build_object('closed_at', '2026-07-20 18:00+07')),
   '2026-07-21 09:25+07');

-- Three rows that must NOT appear, each closing a different way of being wrong.
insert into public.audit_log (action, actor_id, actor_role, target_table, target_id, payload, created_at) values
  -- another DATE, same project
  ('crew_change', '70000000-0405-0405-0405-000000000009', 'super_admin', 'muster_day_closures',
   'a1000000-0405-0405-0405-000000000001',
   jsonb_build_object('kind', 'muster_day_close',
     'project_id', 'a1000000-0405-0405-0405-000000000001', 'work_date', '2026-07-19'),
   '2026-07-21 09:30+07'),
  -- another PROJECT, same date, and via the team-resolved path so a broken join
  -- leaks it rather than merely dropping rows
  ('crew_change', '70000000-0405-0405-0405-000000000009', 'super_admin', 'muster_attendance',
   '71000000-0405-0405-0405-000000000012',
   jsonb_build_object('kind', 'muster_undo', 'work_date', '2026-07-20',
     'team_id', '71000000-0405-0405-0405-000000000012',
     'worker_id', 'e1000000-0405-0405-0405-000000000003', 'session', 'regular',
     'row', jsonb_build_object('in_at', '2026-07-20 08:00+07')),
   '2026-07-21 09:35+07'),
  -- a crew_change that is not a muster event at all: same action, same day, and
  -- the kind filter is the only thing keeping it out
  ('crew_change', '70000000-0405-0405-0405-000000000009', 'super_admin', 'daily_work_plan_crew',
   'a1000000-0405-0405-0405-000000000001',
   jsonb_build_object('kind', 'plan_crew_change',
     'project_id', 'a1000000-0405-0405-0405-000000000001', 'work_date', '2026-07-20'),
   '2026-07-21 09:40+07');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Shape and grants. A function is born PUBLIC here — the revoke is the
--    posture, not the absence of a grant.
-- ============================================================================
select has_function('public', 'list_muster_day_audit', array['uuid', 'date'],
  'list_muster_day_audit(project, date) exists');
select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_muster_day_audit'),
  true, 'list_muster_day_audit is SECURITY DEFINER');
select ok(
  has_function_privilege('authenticated', 'public.list_muster_day_audit(uuid,date)', 'EXECUTE'),
  'authenticated may execute list_muster_day_audit');
select ok(
  not has_function_privilege('anon', 'public.list_muster_day_audit(uuid,date)', 'EXECUTE'),
  'anon may NOT execute list_muster_day_audit (default grants revoked)');

-- ============================================================================
-- B. THE POINT OF THE UNIT — the corrector can read her own trail. The CONTROL
--    is what makes it evidence: the same caller reading audit_log directly must
--    still see nothing, or the RPC is not what fixed it.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0405-0405-0405-00000000000c"}';
select is(
  (select count(*)::int from public.audit_log
    where payload->>'work_date' = '2026-07-20'
      and payload->>'kind' like 'muster%'),
  0,
  'CONTROL: procurement reading audit_log directly still sees NOTHING (RLS allows two WP kinds only)');
select is(
  (select count(*)::int from public.list_muster_day_audit(
     'a1000000-0405-0405-0405-000000000001'::uuid, '2026-07-20'::date)),
  6,
  'procurement gets all six of the day''s edits through the RPC');
reset role;

-- ============================================================================
-- C. THE MEASURED ASYMMETRY. Two of the six kinds carry no project_id, and they
--    are 13 of the 16 rows live. Each is asserted BY KIND, so narrowing the
--    resolution to the payload alone kills a named assertion instead of quietly
--    shrinking a total.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0405-0405-0405-00000000000c"}';
select is(
  (select count(*)::int from public.list_muster_day_audit(
     'a1000000-0405-0405-0405-000000000001'::uuid, '2026-07-20'::date)
    where kind = 'muster_move'),
  1,
  'a muster_move row is found — its project comes from to_team, never from the payload');
select is(
  (select count(*)::int from public.list_muster_day_audit(
     'a1000000-0405-0405-0405-000000000001'::uuid, '2026-07-20'::date)
    where kind = 'muster_undo'),
  1,
  'a muster_undo row is found — its project comes from team_id, never from the payload');
select is(
  (select count(*)::int from public.list_muster_day_audit(
     'a1000000-0405-0405-0405-000000000001'::uuid, '2026-07-20'::date)
    where kind in ('muster_correction_scan_in', 'muster_correction_time',
                   'muster_day_close', 'muster_day_reopen')),
  4,
  'and the four payload-carrying kinds are all present too');

-- The three exclusions, each its own assertion: a total would let one leak while
-- another is over-filtered and still read 6.
select is(
  (select count(*)::int from public.list_muster_day_audit(
     'a1000000-0405-0405-0405-000000000001'::uuid, '2026-07-19'::date)),
  1,
  'the OTHER date returns its own single row — the filter is the date, not a slice');
select is(
  (select count(*)::int from public.list_muster_day_audit(
     'a2000000-0405-0405-0405-000000000002'::uuid, '2026-07-20'::date)),
  1,
  'the other PROJECT''s team-resolved row belongs to that project, not to this one');
select is(
  (select count(*)::int from public.list_muster_day_audit(
     'a1000000-0405-0405-0405-000000000001'::uuid, '2026-07-20'::date)
    where kind = 'plan_crew_change'),
  0,
  'a crew_change that is not a muster event is excluded — action alone is too wide');
reset role;

-- ============================================================================
-- D. What a row must carry to be readable by a human. A trail of uuids and
--    timestamps answers nobody's question.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0405-0405-0405-00000000000c"}';
select is(
  (select actor_name from public.list_muster_day_audit(
     'a1000000-0405-0405-0405-000000000001'::uuid, '2026-07-20'::date)
    where kind = 'muster_correction_scan_in'),
  'คุณเอ ผู้แก้ไข',
  'the row names WHO edited, from users.full_name');
select is(
  (select actor_name from public.list_muster_day_audit(
     'a1000000-0405-0405-0405-000000000001'::uuid, '2026-07-20'::date)
    where kind = 'muster_undo'),
  null,
  'an actor with no full_name reports NULL — the caller renders it unattributed, never a raw uuid');
select is(
  (select actor_role::text from public.list_muster_day_audit(
     'a1000000-0405-0405-0405-000000000001'::uuid, '2026-07-20'::date)
    where kind = 'muster_day_close'),
  'procurement_manager',
  'the row carries the role the actor held AT THE TIME, from the audit row itself');
select is(
  (select worker_name from public.list_muster_day_audit(
     'a1000000-0405-0405-0405-000000000001'::uuid, '2026-07-20'::date)
    where kind = 'muster_correction_time'),
  'ลูกทีม สาม',
  'a row about one person names that person');
select is(
  (select worker_name from public.list_muster_day_audit(
     'a1000000-0405-0405-0405-000000000001'::uuid, '2026-07-20'::date)
    where kind = 'muster_day_close'),
  null,
  'a whole-day event names no worker rather than borrowing one');
select is(
  (select detail->>'before_in_at' from public.list_muster_day_audit(
     'a1000000-0405-0405-0405-000000000001'::uuid, '2026-07-20'::date)
    where kind = 'muster_correction_time'),
  '2026-07-20T02:12:00+00:00',
  'a retime carries the PRIOR check-in — without the before, "แก้เวลา" states nothing');
select is(
  (select detail->>'in_at' from public.list_muster_day_audit(
     'a1000000-0405-0405-0405-000000000001'::uuid, '2026-07-20'::date)
    where kind = 'muster_correction_time'),
  '2026-07-20T00:45:00+00:00',
  'and the value it was changed TO');
select is(
  (select detail->>'reason' from public.list_muster_day_audit(
     'a1000000-0405-0405-0405-000000000001'::uuid, '2026-07-20'::date)
    where kind = 'muster_day_reopen'),
  'ลืมบันทึกคนงาน 1 คน',
  'a reopen carries the reason its own RPC made mandatory');
select is(
  (select detail->>'to_team_name' from public.list_muster_day_audit(
     'a1000000-0405-0405-0405-000000000001'::uuid, '2026-07-20'::date)
    where kind = 'muster_move'),
  'หัวหน้า สอง',
  'a move names the team it moved TO by its lead — a uuid is not a destination');
select is(
  (select detail->>'from_team_name' from public.list_muster_day_audit(
     'a1000000-0405-0405-0405-000000000001'::uuid, '2026-07-20'::date)
    where kind = 'muster_move'),
  'หัวหน้า หนึ่ง',
  'and the team it moved FROM');
select is(
  (select session::text from public.list_muster_day_audit(
     'a1000000-0405-0405-0405-000000000001'::uuid, '2026-07-20'::date)
    where kind = 'muster_correction_time'),
  'regular',
  'the session is carried: an ot correction is ×1.5 money and must not read like a regular one');

-- Newest first. A trail read top-down must be the order things happened, and the
-- reopen is the last of the six.
select is(
  (select kind from public.list_muster_day_audit(
     'a1000000-0405-0405-0405-000000000001'::uuid, '2026-07-20'::date) limit 1),
  'muster_day_reopen',
  'newest first — the most recent edit is the one a reader is looking for');
reset role;

-- ============================================================================
-- E. The gate, driven behaviourally. ATTENDANCE_AUDIT_ROLES is the audience:
--    everyone who can already open the report sees the same day's trail.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0405-0405-0405-000000000009"}';
select lives_ok(
  $$select * from public.list_muster_day_audit(
      'a1000000-0405-0405-0405-000000000001'::uuid, '2026-07-20'::date)$$,
  'super_admin may read the trail');
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0405-0405-0405-00000000000e"}';
select lives_ok(
  $$select * from public.list_muster_day_audit(
      'a1000000-0405-0405-0405-000000000001'::uuid, '2026-07-20'::date)$$,
  'procurement_manager may read the trail');
reset role;

-- accounting owns the wage consequence of a correction and is in the audience —
-- this is the assertion that distinguishes U5's audience from the CORRECTION
-- audience, which refuses her.
update public.users set role = 'accounting' where id = '70000000-0405-0405-0405-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0405-0405-0405-0000000000fe"}';
select lives_ok(
  $$select * from public.list_muster_day_audit(
      'a1000000-0405-0405-0405-000000000001'::uuid, '2026-07-20'::date)$$,
  'accounting may READ the trail even though list_muster_teams_for_day refuses her');
reset role;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0405-0405-0405-00000000000d"}';
select throws_ok(
  $$select * from public.list_muster_day_audit(
      'a1000000-0405-0405-0405-000000000001'::uuid, '2026-07-20'::date)$$,
  '42501', 'list_muster_day_audit: role not permitted',
  'site_admin may NOT — every past-day surface is gated on ATTENDANCE_AUDIT_ROLES, which excludes her');
reset role;

update public.users set role = 'technician' where id = '70000000-0405-0405-0405-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0405-0405-0405-0000000000fe"}';
select throws_ok(
  $$select * from public.list_muster_day_audit(
      'a1000000-0405-0405-0405-000000000001'::uuid, '2026-07-20'::date)$$,
  '42501', 'list_muster_day_audit: role not permitted',
  'technician may NOT read the trail');
reset role;

-- The rls-self-check-coalesce trap: `null not in (...)` is NULL, which an IF
-- treats as not-true, so an unbound caller falls THROUGH a naive gate.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0405-0405-0405-000000000000"}';
select throws_ok(
  $$select * from public.list_muster_day_audit(
      'a1000000-0405-0405-0405-000000000001'::uuid, '2026-07-20'::date)$$,
  '42501', 'list_muster_day_audit: role not permitted',
  'an unbound caller (null role) is DENIED — the gate does not fall open');
reset role;

-- ============================================================================
-- F. SCOPE is a SECOND list. project_manager is the one audit role that is NOT
--    cross-project, and spec 400 U2 paid for that distinction: a surface that
--    ignores it asserts a FINDING about rows the reader may not see.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0405-0405-0405-00000000000f"}';
select throws_ok(
  $$select * from public.list_muster_day_audit(
      'a1000000-0405-0405-0405-000000000001'::uuid, '2026-07-20'::date)$$,
  '42501', 'list_muster_day_audit: not a member of this project',
  'a project_manager with no membership is REFUSED — not handed an empty trail that reads as "no edits"');
reset role;

insert into public.project_members (project_id, user_id, added_by) values
  ('a1000000-0405-0405-0405-000000000001', '70000000-0405-0405-0405-00000000000f',
   '70000000-0405-0405-0405-000000000009');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0405-0405-0405-00000000000f"}';
select is(
  (select count(*)::int from public.list_muster_day_audit(
     'a1000000-0405-0405-0405-000000000001'::uuid, '2026-07-20'::date)),
  6,
  'POSITIVE CONTROL: the same PM, now a member, reads the whole trail — the refusal above was the membership, not the role');
reset role;

-- The cross-project arm must be a LIST, not "the gate already decided it": if it
-- degrades to a blanket bypass, the PM assertions above are the only thing left
-- pinning it, and both of them would still pass.
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'list_muster_day_audit'
      and pg_get_functiondef(p.oid) like '%can_see_project%'),
  1,
  'the body still consults can_see_project — the gate is not the whole story');

select * from finish();
rollback;
