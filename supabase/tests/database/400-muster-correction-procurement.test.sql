begin;
select plan(52);

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
reset role;
-- Read back AS OWNER, not as the caller: procurement has no RLS read on
-- muster_day_closures, so this `exists` returns FALSE under their JWT and the
-- assertion would fail while the write had actually succeeded. A verification
-- read must run as a principal that can SEE the thing — otherwise it measures the
-- reader's privileges, not the writer's effect.
select ok(
  exists (select 1 from public.muster_day_closures
           where project_id = 'a1000000-0400-0400-0400-000000000001'
             and work_date = '2026-07-22'),
  'and the closure row really landed — not merely a call that did not raise');

-- The cross-project arm: procurement has NO membership anywhere, so a
-- role-list-only widening would pass the door and raise 42501 at can_see_project.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-00000000000c"}';
-- 07-25, NOT the 07-23 that project B's team sits on: closing 07-23 here would
-- leave the cross-project SCAN assertion below trying to write to a day this
-- assertion had just closed, and the new closure guard would refuse it — a red
-- caused by the test's own earlier write rather than by the gate under test.
-- close_muster_day needs no team; it inserts the closure and finds no attendance.
select lives_ok(
  $$select public.close_muster_day('a2000000-0400-0400-0400-000000000002'::uuid, '2026-07-25'::date)$$,
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
-- ⚠️ RE-POINTED by spec 400 U6c, and MOVED TO THE END OF THIS FILE rather than
-- flipped in place. `accounting may not close` was the headline denial here; the
-- operator reversed it on 2026-08-07 ("let's enable them first, we trust the
-- current team"), so accounting is admitted now. It cannot simply become a
-- `lives_ok` on this spot: closing 2026-07-20 writes a closure row AND derives
-- wages for it, and sections C/D below depend on that day being OPEN and its wages
-- UNBOOKED — flipping it here silently cascaded into four unrelated assertions
-- (procurement's add, its read-back, and the SA's OT control). The positive
-- control lives after them.
-- ⚠️ `project_manager may not close` USED TO LIVE HERE and was removed 2026-08-08:
-- post-u6c it is FALSE — project_manager IS in close_muster_day's live allowlist. It
-- passed only because this probe user has no `project_members` row, i.e. it was
-- asserting the MEMBERSHIP gate while claiming to assert the ROLE gate. The exhaustive
-- sweep in section B2 replaces it and cannot drift that way.
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
-- B2. THE EFFECTIVE DERIVE ALLOWLIST — exhaustive over all 17 roles.
--
-- Why this exists, and it is the most load-bearing block in the file. U3a moved
-- derive_muster_labor's mechanism into derive_muster_labor_internal so procurement's
-- re-close could derive without procurement gaining the labour engine's authority.
-- A consequence nobody re-derives on their own: **close_muster_day now calls the
-- INTERNAL, so ITS role list — not derive_muster_labor's — is the effective gate on
-- the wage write.** u6c then widened close to accounting/hr/project_coordinator, none
-- of which derive_muster_labor itself admits. That was operator-sanctioned; the defect
-- is that nothing MAKES the next widener notice, while derive_muster_labor's own body
-- still carries a ⚠️ pointing at the list that no longer governs.
--
-- So: assert the admitted set EXACTLY, over the whole enum. Adding a role to
-- close_muster_day now REDS here, forcing whoever does it to re-answer "should this
-- role be able to trigger a wage derive?" — which is the question the split made
-- invisible. ⏳ Live today: labor_logs = 0 rows and no worker has cost_confirmed_at,
-- so a derive books nothing; this becomes a money question the moment spec 368 U2
-- confirms the first rate.
--
-- Isolation of the ROLE gate from the MEMBERSHIP gate is the whole trick, and it is
-- what the retired `project_manager may not close` assertion got wrong: project C is a
-- dedicated project the probe user IS a member of, with NO teams and NO attendance, so
--   * can_see_project is TRUE for every role ⇒ only the role gate can refuse, and
--   * an admitted role's close writes a closure row and derives NOTHING,
-- so each of the 17 calls is side-effect-free with respect to every other assertion in
-- this file. One distinct date per role keeps even the closure rows from colliding.
-- ============================================================================
insert into public.projects (id, code, name) values
  ('a3000000-0400-0400-0400-000000000003', 'TAP-400C', 'โครงการซี');
insert into public.project_members (project_id, user_id, added_by) values
  ('a3000000-0400-0400-0400-000000000003', '70000000-0400-0400-0400-0000000000fe',
   '70000000-0400-0400-0400-000000000009');

-- ADMITTED (9) — live close_muster_day allowlist, verified with pg_get_functiondef
-- 2026-08-08. Each one is also asserting "may trigger a wage derive".
reset role;
update public.users set role = 'site_admin' where id = '70000000-0400-0400-0400-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-0000000000fe"}';
select lives_ok(
  $$select public.close_muster_day('a3000000-0400-0400-0400-000000000003'::uuid, '2026-06-01'::date)$$,
  'site_admin may close ⇒ may trigger a wage derive');
reset role;
update public.users set role = 'super_admin' where id = '70000000-0400-0400-0400-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-0000000000fe"}';
select lives_ok(
  $$select public.close_muster_day('a3000000-0400-0400-0400-000000000003'::uuid, '2026-06-02'::date)$$,
  'super_admin may close ⇒ may trigger a wage derive');
reset role;
update public.users set role = 'procurement_manager' where id = '70000000-0400-0400-0400-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-0000000000fe"}';
select lives_ok(
  $$select public.close_muster_day('a3000000-0400-0400-0400-000000000003'::uuid, '2026-06-03'::date)$$,
  'procurement_manager may close ⇒ may trigger a wage derive');
reset role;
update public.users set role = 'procurement' where id = '70000000-0400-0400-0400-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-0000000000fe"}';
select lives_ok(
  $$select public.close_muster_day('a3000000-0400-0400-0400-000000000003'::uuid, '2026-06-04'::date)$$,
  'procurement may close ⇒ may trigger a wage derive (spec 400 U3a, the ruling)');
reset role;
update public.users set role = 'project_manager' where id = '70000000-0400-0400-0400-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-0000000000fe"}';
select lives_ok(
  $$select public.close_muster_day('a3000000-0400-0400-0400-000000000003'::uuid, '2026-06-05'::date)$$,
  'project_manager may close ⇒ may trigger a wage derive');
reset role;
update public.users set role = 'project_director' where id = '70000000-0400-0400-0400-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-0000000000fe"}';
select lives_ok(
  $$select public.close_muster_day('a3000000-0400-0400-0400-000000000003'::uuid, '2026-06-06'::date)$$,
  'project_director may close ⇒ may trigger a wage derive');
reset role;
-- ⚠️ These three arrived with u6c and are NOT in derive_muster_labor's own list. They
-- reach the wage derive only through close_muster_day's bypass. Operator-sanctioned
-- 2026-08-07 ("let's enable them first, we trust the current team") — pinned so the
-- grant stays visible rather than implicit.
update public.users set role = 'accounting' where id = '70000000-0400-0400-0400-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-0000000000fe"}';
select lives_ok(
  $$select public.close_muster_day('a3000000-0400-0400-0400-000000000003'::uuid, '2026-06-07'::date)$$,
  'accounting may close ⇒ may trigger a wage derive (u6c; NOT in derive_muster_labor)');
reset role;
update public.users set role = 'hr' where id = '70000000-0400-0400-0400-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-0000000000fe"}';
select lives_ok(
  $$select public.close_muster_day('a3000000-0400-0400-0400-000000000003'::uuid, '2026-06-08'::date)$$,
  'hr may close ⇒ may trigger a wage derive (u6c; NOT in derive_muster_labor)');
reset role;
update public.users set role = 'project_coordinator' where id = '70000000-0400-0400-0400-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-0000000000fe"}';
select lives_ok(
  $$select public.close_muster_day('a3000000-0400-0400-0400-000000000003'::uuid, '2026-06-09'::date)$$,
  'project_coordinator may close ⇒ may trigger a wage derive (u6c; NOT in derive_muster_labor)');
reset role;

-- REFUSED (8) — the complement. 9 + 8 = 17 = the whole enum, so a NEW enum value lands
-- in neither arm and the count assertion at the end of this block reds.
update public.users set role = 'technician' where id = '70000000-0400-0400-0400-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-0000000000fe"}';
select throws_ok(
  $$select public.close_muster_day('a3000000-0400-0400-0400-000000000003'::uuid, '2026-06-10'::date)$$,
  '42501', 'close_muster_day: role not permitted',
  'technician may NOT close (role gate, not membership — they ARE a member here)');
reset role;
update public.users set role = 'visitor' where id = '70000000-0400-0400-0400-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-0000000000fe"}';
select throws_ok(
  $$select public.close_muster_day('a3000000-0400-0400-0400-000000000003'::uuid, '2026-06-11'::date)$$,
  '42501', 'close_muster_day: role not permitted', 'visitor may NOT close');
reset role;
update public.users set role = 'legal' where id = '70000000-0400-0400-0400-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-0000000000fe"}';
select throws_ok(
  $$select public.close_muster_day('a3000000-0400-0400-0400-000000000003'::uuid, '2026-06-12'::date)$$,
  '42501', 'close_muster_day: role not permitted', 'legal may NOT close');
reset role;
update public.users set role = 'subcon_manager' where id = '70000000-0400-0400-0400-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-0000000000fe"}';
select throws_ok(
  $$select public.close_muster_day('a3000000-0400-0400-0400-000000000003'::uuid, '2026-06-13'::date)$$,
  '42501', 'close_muster_day: role not permitted', 'subcon_manager may NOT close');
reset role;
update public.users set role = 'site_owner' where id = '70000000-0400-0400-0400-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-0000000000fe"}';
select throws_ok(
  $$select public.close_muster_day('a3000000-0400-0400-0400-000000000003'::uuid, '2026-06-14'::date)$$,
  '42501', 'close_muster_day: role not permitted', 'site_owner may NOT close');
reset role;
update public.users set role = 'auditor' where id = '70000000-0400-0400-0400-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-0000000000fe"}';
select throws_ok(
  $$select public.close_muster_day('a3000000-0400-0400-0400-000000000003'::uuid, '2026-06-15'::date)$$,
  '42501', 'close_muster_day: role not permitted', 'auditor may NOT close');
reset role;
update public.users set role = 'client' where id = '70000000-0400-0400-0400-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-0000000000fe"}';
select throws_ok(
  $$select public.close_muster_day('a3000000-0400-0400-0400-000000000003'::uuid, '2026-06-16'::date)$$,
  '42501', 'close_muster_day: role not permitted', 'client may NOT close');
reset role;
update public.users set role = 'contractor' where id = '70000000-0400-0400-0400-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-0000000000fe"}';
select throws_ok(
  $$select public.close_muster_day('a3000000-0400-0400-0400-000000000003'::uuid, '2026-06-17'::date)$$,
  '42501', 'close_muster_day: role not permitted', 'contractor may NOT close');
reset role;

-- The completeness latch: 9 admitted + 8 refused must equal the enum. A new role value
-- makes this red, and the author then has to place it in one arm or the other — which
-- is exactly the re-derivation the internal-call bypass would otherwise skip.
select is(9 + 8, array_length(enum_range(null::public.user_role), 1),
  'every user_role is classified above — a new value must be placed in an arm');

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

-- The second bound (075914): a correction records a REGULAR session only. OT is
-- ×1.5 money (spec 351) and the ruling did not ask for the power to create it.
-- The SA arm keeps both sessions, which is what the next assertion proves — the
-- pair is what makes this a procurement-specific bound rather than a global one.
-- ⚠️ FIXED 2026-08-08 after a post-merge review found this assertion GREEN over a
-- deleted guard. It used to drive worker …0001 — team …0010's LEAD, which the fixture
-- never scans in — so spec 351's OWN precondition ("no regular session on this team
-- today") raised P0001 too, and with a `null` message `throws_ok` compares only the
-- SQLSTATE. Deleting 075914's `p_session <> 'regular'` block left this passing.
--
-- ⭐ THE GENERAL RULE, and it is why the message argument is now filled in:
-- `throws_ok(…, '<SQLSTATE>', null, …)` is WEAK whenever the function can raise that
-- code from more than one branch — and muster_scan_in raises P0001 from SIX. Pass the
-- message, AND pick a fixture that cannot trip any other branch raising the same code.
--
-- Worker …0002 was scanned into team …0010 (regular) by section C above, so spec 351's
-- precondition is SATISFIED and the regular-only guard is the only branch left that can
-- raise here.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-00000000000c"}';
select throws_ok(
  $$select public.muster_scan_in('71000000-0400-0400-0400-000000000010'::uuid,
      'e1000000-0400-0400-0400-000000000002'::uuid, 'manual'::public.muster_method,
      'ot'::public.muster_session)$$,
  'P0001', 'muster_scan_in: a correction may only record a regular session',
  'procurement may NOT open an OT session — a correction is regular-only (×1.5 money)');
reset role;
-- Positive control: the SA arm still opens OT on the same open day, for the SAME worker
-- and team the procurement attempt above was refused on — so the pair isolates the ROLE
-- as the only difference, and proves spec 351's precondition really was satisfied.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-00000000000d"}';
select lives_ok(
  $$select public.muster_scan_in('71000000-0400-0400-0400-000000000010'::uuid,
      'e1000000-0400-0400-0400-000000000002'::uuid, 'manual'::public.muster_method,
      'ot'::public.muster_session)$$,
  'site_admin still MAY open OT — the regular-only bound is procurement-specific');
reset role;

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

-- The closure audit row is deliberately written for EVERY closer, not only the new
-- arm: a closure is the event that triggers the wage derive, so "who finalised this
-- day" is the fact a later money question needs. 075913's header says so, and prose
-- is not a pin — without this assertion the claim is only true by accident, and an
-- edit that moved the insert inside `if v_role = 'procurement'` would stay green.
-- 07-20 is closed here, at the END of the file, because the scan-in and OT
-- assertions above all require it OPEN.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-00000000000d"}';
select lives_ok(
  $$select public.close_muster_day('a1000000-0400-0400-0400-000000000001'::uuid, '2026-07-20'::date)$$,
  'site_admin may still close (the widening added a role, it removed none)');
reset role;
select ok(
  exists (select 1 from public.audit_log
           where target_table = 'muster_day_closures'
             and payload->>'kind' = 'muster_day_close'
             and payload->>'work_date' = '2026-07-20'
             and actor_role = 'site_admin'),
  'a NON-procurement close is audited too — the closure audit is for every closer');

-- ============================================================================
-- H. The least-privilege split (migration 075913).
--
--    close_muster_day PERFORMs the wage derive, and derive_muster_labor carries a
--    THIRD gate one layer down — {site_admin, project_manager, super_admin,
--    project_director, procurement_manager} + can_see_project, commented "Same
--    authority as the labour engine. Money-writing." Widening close alone left
--    procurement passing two gates and dying at the third (found by section B's
--    lives_ok reporting `42501: derive_muster_labor: role not permitted`, which
--    reading close_muster_day's own body could never have revealed).
--
--    The operator declined widening the money function. So the mechanism moved to
--    an unexported helper and procurement reaches it ONLY through close_muster_day.
--    These assertions are what make that claim falsifiable: if someone later
--    "simplifies" it by adding procurement to derive_muster_labor's list, the
--    first assertion below reds.
-- ============================================================================
select has_function('public', 'derive_muster_labor_internal', array['uuid', 'date'],
  'the unexported mechanism exists');
select ok(
  not has_function_privilege('authenticated',
    'public.derive_muster_labor_internal(uuid,date)', 'EXECUTE'),
  'authenticated may NOT execute the mechanism directly (grants revoked, not merely ungranted)');
select ok(
  not has_function_privilege('anon',
    'public.derive_muster_labor_internal(uuid,date)', 'EXECUTE'),
  'anon may NOT execute the mechanism directly');

-- THE CRUX: procurement gained "re-close a day", NOT "derive wages". A direct
-- call must still be refused, or the split bought nothing over widening the list.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-00000000000c"}';
select throws_ok(
  $$select public.derive_muster_labor('a1000000-0400-0400-0400-000000000001'::uuid, '2026-07-22'::date)$$,
  '42501', null,
  'procurement STILL may not derive wages directly — the money gate is unchanged');
reset role;

-- And the roles that legitimately hold the labour-engine authority keep it: the
-- split must not have narrowed the public entry point either. super_admin is a
-- member of no project here, so this also proves can_see_project still applies —
-- it is the ROLE arm being checked, and super_admin passes can_see_project by role.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-000000000009"}';
select lives_ok(
  $$select public.derive_muster_labor('a1000000-0400-0400-0400-000000000001'::uuid, '2026-07-22'::date)$$,
  'super_admin may still derive directly — the split did not narrow the public gate');
reset role;

-- ============================================================================
-- Spec 400 U6c — the widened audience, asserted LAST because closing has side
-- effects (a closure row + derived wages) that every section above depends on the
-- absence of. See the note where this control used to live.
-- ============================================================================
reset role;
update public.users set role = 'accounting' where id = '70000000-0400-0400-0400-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0400-0400-0400-0000000000fe"}';
select lives_ok(
  $$select public.close_muster_day('a1000000-0400-0400-0400-000000000001'::uuid, '2026-07-20'::date)$$,
  'accounting MAY close since U6c — and so books the wages (the money step)');
reset role;
-- Cross-project, not a membership: can_see_project is `else false` for accounting,
-- and this probe user holds no project_members row. If the scoping arm had been
-- left alone, the call above would have raised 42501 one layer down — the
-- affordance-then-refuse this unit exists to remove.
select ok(
  exists (select 1 from public.muster_day_closures
           where project_id = 'a1000000-0400-0400-0400-000000000001'
             and work_date = '2026-07-20'),
  'and accounting''s closure really landed, holding no membership on the project');

select * from finish();
rollback;
