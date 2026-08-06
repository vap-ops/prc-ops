begin;
select plan(42);

-- ============================================================================
-- Spec 400 U3a — the correction path for procurement.
--
-- Spec 400 U1/U2 gave procurement a grid that SURFACES holes (11 of 41 active
-- workers had zero July rows; 08-04 mustered one person). It gave them nothing
-- to fix any of them with. Live gates before this migration:
--
--   read the report        audit_attendance_summary/_detail   ✅ procurement
--   reopen a closed day    reopen_muster_day                  ✅ procurement
--   undo a wrong scan      muster_undo_scan                   ✅ procurement
--   add a missing person   muster_scan_in                     ❌
--   close the day again    close_muster_day                   ❌
--
-- So their power was DESTRUCTIVE-ONLY — remove a wrong scan, never supply a
-- right one — while the commonest correction is "he was here, add him".
--
-- Operator ruling 2026-08-06 (spec §3): option A, procurement MAY correct, they
-- may ALSO re-close, and the binding is ANY OPEN DAY rather than only a day they
-- reopened. The measurement behind the last part: reopen_muster_day has 0 audit
-- rows all-time, so gating corrections behind a reopen would have put a new
-- capability behind a ritual nobody performs.
--
-- ⇒ The rule is: procurement may write to a project-day with no
--   muster_day_closures row. A closed day still needs reopen_muster_day first,
--   which they already hold.
--
-- Two gates per function, and the SECOND is the one a role-list-only widening
-- misses: can_see_project() falls to `else false` for procurement (verified
-- live), so both functions need the cross-project arm reopen_muster_day already
-- uses — `v_role <> 'procurement' and not can_see_project(...)`.
--
-- ⚠️ muster_scan_in has NO closure guard today (verified live: its body never
-- mentions muster_day_closures), so the SA can scan into a closed day. That is a
-- PRE-EXISTING hole. This unit closes it for the NEW arm only and PINS the SA
-- path as still open (section E) rather than silently changing it — a scope
-- decision, recorded so a later change to it is deliberate.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('70000000-0400-0400-0400-000000000009', 'super@s400.local', '{}'::jsonb),
  ('70000000-0400-0400-0400-00000000000c', 'proc@s400.local',  '{}'::jsonb),
  ('70000000-0400-0400-0400-00000000000d', 'sa@s400.local',    '{}'::jsonb),
  ('70000000-0400-0400-0400-00000000000e', 'pmgr@s400.local',  '{}'::jsonb),
  ('70000000-0400-0400-0400-0000000000fe', 'probe@s400.local', '{}'::jsonb);
update public.users set role = 'super_admin'         where id = '70000000-0400-0400-0400-000000000009';
update public.users set role = 'procurement'         where id = '70000000-0400-0400-0400-00000000000c';
update public.users set role = 'site_admin'          where id = '70000000-0400-0400-0400-00000000000d';
update public.users set role = 'procurement_manager' where id = '70000000-0400-0400-0400-00000000000e';

insert into public.projects (id, code, name) values
  ('a1000000-0400-0400-0400-000000000001', 'TAP-400A', 'โครงการเอ'),
  ('a2000000-0400-0400-0400-000000000002', 'TAP-400B', 'โครงการบี');

-- The site_admin is a member of A only. This is the positive control for the
-- cross-project arm: it must stay FALSE for A-only members on B, so the arm is
-- provably procurement-specific and not a membership widening for everyone.
insert into public.project_members (project_id, user_id, added_by) values
  ('a1000000-0400-0400-0400-000000000001', '70000000-0400-0400-0400-00000000000d',
   '70000000-0400-0400-0400-000000000009');

-- One worker per (team, date) pair that gets scanned: muster_attendance is
-- UNIQUE (worker_id, work_date, session), so reusing one worker across the
-- same-date teams would fail on the constraint rather than on the gate under
-- test — a red for the wrong reason.
insert into public.workers (id, name, pay_type, employment_type, day_rate, active, created_by) values
  ('e1000000-0400-0400-0400-000000000001', 'ช่าง หนึ่ง', 'daily', 'temporary', 400, true,
   '70000000-0400-0400-0400-000000000009'),
  ('e1000000-0400-0400-0400-000000000002', 'ช่าง สอง',  'daily', 'temporary', 400, true,
   '70000000-0400-0400-0400-000000000009'),
  ('e1000000-0400-0400-0400-000000000003', 'ช่าง สาม',  'daily', 'temporary', 400, true,
   '70000000-0400-0400-0400-000000000009'),
  ('e1000000-0400-0400-0400-000000000004', 'ช่าง สี่',   'daily', 'temporary', 400, true,
   '70000000-0400-0400-0400-000000000009');

-- Separate dates per concern so one test's write cannot change another's
-- precondition: 07-20 open (scan-in), 07-21 closed (the guard), 07-22 open
-- (close_muster_day), 07-23 on project B (the cross-project arm).
insert into public.muster_teams (id, project_id, work_date, lead_worker_id, created_by) values
  ('71000000-0400-0400-0400-000000000010', 'a1000000-0400-0400-0400-000000000001', '2026-07-20',
   'e1000000-0400-0400-0400-000000000001', '70000000-0400-0400-0400-000000000009'),
  ('71000000-0400-0400-0400-000000000011', 'a1000000-0400-0400-0400-000000000001', '2026-07-21',
   'e1000000-0400-0400-0400-000000000001', '70000000-0400-0400-0400-000000000009'),
  ('71000000-0400-0400-0400-000000000012', 'a1000000-0400-0400-0400-000000000001', '2026-07-22',
   'e1000000-0400-0400-0400-000000000001', '70000000-0400-0400-0400-000000000009'),
  ('71000000-0400-0400-0400-000000000013', 'a2000000-0400-0400-0400-000000000002', '2026-07-23',
   'e1000000-0400-0400-0400-000000000003', '70000000-0400-0400-0400-000000000009');

-- 07-21 is the CLOSED day.
insert into public.muster_day_closures (project_id, work_date, closed_at, closed_by) values
  ('a1000000-0400-0400-0400-000000000001', '2026-07-21', now(),
   '70000000-0400-0400-0400-000000000009');

-- The runner rewrites each assertion into an insert on the temp collector, and
-- this file asserts WHILE `set local role authenticated` — a fresh temp table
-- grants `authenticated` nothing, so without this the first post-switch assert
-- dies 42501 and the WHOLE file reports `not ok` with zero assertions run.
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Shape — both functions keep their signature, definer-ness and grants.
--    A `create or replace` that changed any of these would break every caller.
-- ============================================================================
select has_function('public', 'close_muster_day', array['uuid', 'date'],
  'close_muster_day(project, date) exists');
select has_function('public', 'muster_scan_in',
  array['uuid', 'uuid', 'muster_method', 'muster_session'],
  'muster_scan_in(team, worker, method, session) exists');
select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'close_muster_day'),
  true, 'close_muster_day is SECURITY DEFINER');
select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'muster_scan_in'),
  true, 'muster_scan_in is SECURITY DEFINER');
select ok(
  has_function_privilege('authenticated', 'public.close_muster_day(uuid,date)', 'EXECUTE'),
  'authenticated may execute close_muster_day');
select ok(
  not has_function_privilege('anon', 'public.close_muster_day(uuid,date)', 'EXECUTE'),
  'anon may NOT execute close_muster_day (default grants revoked)');
select ok(
  not has_function_privilege('anon',
    'public.muster_scan_in(uuid,uuid,muster_method,muster_session)', 'EXECUTE'),
  'anon may NOT execute muster_scan_in');

-- ============================================================================
-- B. close_muster_day — procurement is admitted, and the OTHER roles are not.
--    The enum-length pin forces a new role to be classified here rather than
--    landing silently in whichever arm the author forgot.
-- ============================================================================
select is(array_length(enum_range(null::public.user_role), 1), 17,
  'user_role has 17 values — a new one must be classified into the gates below');

reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-00000000000c"}';
select lives_ok(
  $$select public.close_muster_day('a1000000-0400-0400-0400-000000000001'::uuid, '2026-07-22'::date)$$,
  'procurement MAY close an open day (the ruling: they may re-close)');
select ok(
  exists (select 1 from public.muster_day_closures
           where project_id = 'a1000000-0400-0400-0400-000000000001'
             and work_date = '2026-07-22'),
  'and the closure row really landed — not merely a call that did not raise');
reset role;

-- The cross-project arm: procurement has NO membership anywhere, so a
-- role-list-only widening would pass the door and raise 42501 at can_see_project.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-00000000000c"}';
select lives_ok(
  $$select public.close_muster_day('a2000000-0400-0400-0400-000000000002'::uuid, '2026-07-23'::date)$$,
  'procurement may close on a project they are not a member of (cross-project arm)');
reset role;

-- Positive control for that arm: it must NOT have widened membership generally.
-- The site_admin is a member of A only and must still be refused on B.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-00000000000d"}';
select throws_ok(
  $$select public.close_muster_day('a2000000-0400-0400-0400-000000000002'::uuid, '2026-07-20'::date)$$,
  '42501', null,
  'site_admin still refused on a project they do not belong to (arm is procurement-only)');
reset role;

update public.users set role = 'technician' where id = '70000000-0400-0400-0400-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-0000000000fe"}';
select throws_ok(
  $$select public.close_muster_day('a1000000-0400-0400-0400-000000000001'::uuid, '2026-07-20'::date)$$,
  '42501', null, 'technician may not close');
reset role;
update public.users set role = 'accounting' where id = '70000000-0400-0400-0400-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-0000000000fe"}';
select throws_ok(
  $$select public.close_muster_day('a1000000-0400-0400-0400-000000000001'::uuid, '2026-07-20'::date)$$,
  '42501', null, 'accounting may not close — it READS the report, it does not edit the muster');
reset role;
update public.users set role = 'project_manager' where id = '70000000-0400-0400-0400-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-0000000000fe"}';
select throws_ok(
  $$select public.close_muster_day('a1000000-0400-0400-0400-000000000001'::uuid, '2026-07-20'::date)$$,
  '42501', null, 'project_manager may not close');
reset role;
update public.users set role = 'visitor' where id = '70000000-0400-0400-0400-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-0000000000fe"}';
select throws_ok(
  $$select public.close_muster_day('a1000000-0400-0400-0400-000000000001'::uuid, '2026-07-20'::date)$$,
  '42501', null, 'visitor may not close');
reset role;
-- Unbound caller (no public.users row) must be DENIED, not fall through:
-- `null not in (...)` is NULL, which an IF treats as not-true.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0400-0400-0400-000000000000"}';
select throws_ok(
  $$select public.close_muster_day('a1000000-0400-0400-0400-000000000001'::uuid, '2026-07-20'::date)$$,
  '42501', null, 'unbound caller (null role) denied, not silently allowed');
reset role;

-- ============================================================================
-- C. muster_scan_in — procurement may add a missing person to an OPEN day.
--    This is the correction the whole unit exists for: "he was here, add him".
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-00000000000c"}';
select lives_ok(
  $$select public.muster_scan_in('71000000-0400-0400-0400-000000000010'::uuid,
      'e1000000-0400-0400-0400-000000000002'::uuid, 'manual'::public.muster_method)$$,
  'procurement MAY scan a worker into an open day');
reset role;
select ok(
  exists (select 1 from public.muster_attendance
           where team_id = '71000000-0400-0400-0400-000000000010'
             and worker_id = 'e1000000-0400-0400-0400-000000000002'),
  'and the attendance row really landed');

-- Cross-project again, on the function whose second gate reads the TEAM's project.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-00000000000c"}';
select lives_ok(
  $$select public.muster_scan_in('71000000-0400-0400-0400-000000000013'::uuid,
      'e1000000-0400-0400-0400-000000000004'::uuid, 'manual'::public.muster_method)$$,
  'procurement may scan into a team on a project they do not belong to');
reset role;

-- ============================================================================
-- D. The closure guard — the half that bounds the new power.
--    "May write to a project-day with no muster_day_closures row" is the whole
--    ruling; without this the widening would let procurement edit a CLOSED day,
--    which is what reopen_muster_day exists to gate.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-00000000000c"}';
select throws_ok(
  $$select public.muster_scan_in('71000000-0400-0400-0400-000000000011'::uuid,
      'e1000000-0400-0400-0400-000000000002'::uuid, 'manual'::public.muster_method)$$,
  'P0001', null,
  'procurement refused on a CLOSED day (P0001, not 42501 — the day is the reason, not the role)');
reset role;
select ok(
  not exists (select 1 from public.muster_attendance
               where team_id = '71000000-0400-0400-0400-000000000011'
                 and worker_id = 'e1000000-0400-0400-0400-000000000002'),
  'and nothing was written on the closed day');

-- ============================================================================
-- E. The SA path is DELIBERATELY unchanged — scope pin, not an endorsement.
--    That site_admin can scan into a closed day is a PRE-EXISTING hole. Closing
--    it for everyone is a behaviour change to the cockpit that this unit did not
--    measure and was not asked for, so it is recorded here instead: if a later
--    unit closes it, THIS assertion is what makes that deliberate.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-00000000000d"}';
select lives_ok(
  $$select public.muster_scan_in('71000000-0400-0400-0400-000000000011'::uuid,
      'e1000000-0400-0400-0400-000000000003'::uuid, 'manual'::public.muster_method)$$,
  'site_admin can STILL scan into a closed day — pre-existing hole, guard is new-arm-only');
reset role;

-- ============================================================================
-- F. The pgTAP role-set pin U2 owed.
--
--    U2 reads the worker roster on the SESSION client, authorized by the page's
--    requireRole(WORKER_ROSTER_ROLES) plus the `workers readable by staff`
--    policy. U2's TS test pins the ARRAY, so it catches someone WIDENING the
--    constant — but nothing catches the live POLICY being NARROWED underneath
--    it, which would hand the grid a SILENT EMPTY roster (rows fetched, zero
--    returned, "nobody is missing" rendered over a real hole).
--
--    So this is behavioural over the EXHAUSTIVE role domain: flip one probe
--    user through all 17 roles and read a synthetic worker row. Scoped by that
--    row's id — never a global count over an app-written table (#954's class).
--    The synthetic worker has contractor_id and user_id NULL, so neither of the
--    other two SELECT policies can fire and admission is attributable to the
--    staff policy alone.
--
--    Expected admitted set = the 6 the live policy names. Note it is NOT the
--    same as WORKER_ROSTER_ROLES, which resolves to 5 (PM_ROLES + procurement +
--    procurement_manager): site_admin is admitted by the POLICY without being in
--    the CONSTANT. WORKER_ROSTER_ROLES ⊆ admitted is the invariant the grid
--    needs, and the 5 admits below are what prove it.
-- ============================================================================
select policy_cmd_is('public', 'workers', 'workers readable by staff', 'SELECT',
  'the staff read policy exists and is a SELECT policy');

-- The 6 admitted. The 5 that are also in WORKER_ROSTER_ROLES carry that in the
-- assertion name, so a failure says which invariant broke.
reset role;
update public.users set role = 'project_manager' where id = '70000000-0400-0400-0400-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-0000000000fe"}';
select ok(exists (select 1 from public.workers where id = 'e1000000-0400-0400-0400-000000000001'),
  'project_manager may read the roster (WORKER_ROSTER_ROLES member)');
reset role;
update public.users set role = 'super_admin' where id = '70000000-0400-0400-0400-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-0000000000fe"}';
select ok(exists (select 1 from public.workers where id = 'e1000000-0400-0400-0400-000000000001'),
  'super_admin may read the roster (WORKER_ROSTER_ROLES member)');
reset role;
update public.users set role = 'project_director' where id = '70000000-0400-0400-0400-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-0000000000fe"}';
select ok(exists (select 1 from public.workers where id = 'e1000000-0400-0400-0400-000000000001'),
  'project_director may read the roster (WORKER_ROSTER_ROLES member)');
reset role;
update public.users set role = 'procurement' where id = '70000000-0400-0400-0400-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-0000000000fe"}';
select ok(exists (select 1 from public.workers where id = 'e1000000-0400-0400-0400-000000000001'),
  'procurement may read the roster (WORKER_ROSTER_ROLES member — the grid audience)');
reset role;
update public.users set role = 'procurement_manager' where id = '70000000-0400-0400-0400-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-0000000000fe"}';
select ok(exists (select 1 from public.workers where id = 'e1000000-0400-0400-0400-000000000001'),
  'procurement_manager may read the roster (WORKER_ROSTER_ROLES member)');
reset role;
update public.users set role = 'site_admin' where id = '70000000-0400-0400-0400-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-0000000000fe"}';
select ok(exists (select 1 from public.workers where id = 'e1000000-0400-0400-0400-000000000001'),
  'site_admin may read the roster (policy member, NOT a WORKER_ROSTER_ROLES member)');
reset role;

-- The 11 refused. accounting / hr / project_coordinator matter most: they ARE in
-- ATTENDANCE_AUDIT_ROLES, so they can open the audit report while being unable to
-- read `workers` — which is exactly why U2 gated the roster on WORKER_ROSTER_ROLES
-- and not on the audit set. If any of these flips to admitted, that reasoning is
-- stale and the grid's gate needs re-deriving.
update public.users set role = 'accounting' where id = '70000000-0400-0400-0400-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-0000000000fe"}';
select ok(not exists (select 1 from public.workers where id = 'e1000000-0400-0400-0400-000000000001'),
  'accounting may NOT read the roster (in ATTENDANCE_AUDIT_ROLES, not in the policy)');
reset role;
update public.users set role = 'hr' where id = '70000000-0400-0400-0400-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-0000000000fe"}';
select ok(not exists (select 1 from public.workers where id = 'e1000000-0400-0400-0400-000000000001'),
  'hr may NOT read the roster');
reset role;
update public.users set role = 'project_coordinator' where id = '70000000-0400-0400-0400-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-0000000000fe"}';
select ok(not exists (select 1 from public.workers where id = 'e1000000-0400-0400-0400-000000000001'),
  'project_coordinator may NOT read the roster (it opens /workers via the ADMIN client)');
reset role;
update public.users set role = 'technician' where id = '70000000-0400-0400-0400-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-0000000000fe"}';
select ok(not exists (select 1 from public.workers where id = 'e1000000-0400-0400-0400-000000000001'),
  'technician may NOT read another worker''s row');
reset role;
update public.users set role = 'visitor' where id = '70000000-0400-0400-0400-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-0000000000fe"}';
select ok(not exists (select 1 from public.workers where id = 'e1000000-0400-0400-0400-000000000001'),
  'visitor may NOT read the roster');
reset role;
update public.users set role = 'legal' where id = '70000000-0400-0400-0400-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-0000000000fe"}';
select ok(not exists (select 1 from public.workers where id = 'e1000000-0400-0400-0400-000000000001'),
  'legal may NOT read the roster');
reset role;
update public.users set role = 'subcon_manager' where id = '70000000-0400-0400-0400-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-0000000000fe"}';
select ok(not exists (select 1 from public.workers where id = 'e1000000-0400-0400-0400-000000000001'),
  'subcon_manager may NOT read an unbound worker (its arm is contractor-scoped)');
reset role;

-- Unbound caller: the coalesce/is-null hardening on the read side too.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0400-0400-0400-000000000000"}';
select ok(not exists (select 1 from public.workers where id = 'e1000000-0400-0400-0400-000000000001'),
  'unbound caller (null role) reads nothing — the gate does not fall open');
reset role;
-- anon is walled one layer BELOW RLS: it holds no table-level SELECT grant on
-- workers at all, so an attempted read raises 42501 rather than returning zero
-- rows. Asserting the privilege is both the correct layer and the stronger claim
-- (an RLS-denied read would still pass if someone later granted the table).
select ok(not has_table_privilege('anon', 'public.workers', 'SELECT'),
  'anon holds no SELECT grant on workers — walled below RLS, not merely filtered');

-- ============================================================================
-- G. The audit trail. A correction that leaves no record is the hole this spec
--    was written to find, so the new arm must be attributable. Convention per
--    reopen_muster_day: an EXISTING action plus a payload `kind`, never a new
--    enum value.
-- ============================================================================
select ok(
  exists (select 1 from public.audit_log
           where target_table = 'muster_day_closures'
             and payload->>'kind' = 'muster_day_close'
             and payload->>'work_date' = '2026-07-22'
             and actor_role = 'procurement'),
  'procurement closing a day writes an audit row (action + kind, no new enum value)');
select ok(
  exists (select 1 from public.audit_log
           where target_table = 'muster_attendance'
             and payload->>'kind' = 'muster_correction_scan_in'
             and actor_role = 'procurement'),
  'procurement scanning a worker in writes an audit row naming it a CORRECTION');
select ok(
  not exists (select 1 from public.audit_log
               where target_table = 'muster_attendance'
                 and payload->>'kind' = 'muster_correction_scan_in'
                 and actor_role = 'site_admin'),
  'the SA''s ordinary cockpit scan is NOT relabelled a correction (arm-specific audit)');

select * from finish();
rollback;
