begin;
select plan(31);

-- ============================================================================
-- Spec 397 U3 — reopen_muster_day(project, date, reason).
--
-- A closed muster day is FINAL: muster_undo_scan raises P0001 against it, and
-- close_muster_day books wages inline (derive_muster_labor). There was no way
-- back, so a wrong or half-recorded day stayed wrong — 2026-08-04 carries FOUR
-- check-ins between a 21 and a 23, closed.
--
-- Gate = the roles that may CLOSE (site_admin, super_admin, procurement_manager)
-- PLUS procurement, the tier spec 397 put on the audit report. Scope mirrors the
-- audit RPCs' inner arm rather than close_muster_day's: can_see_project is FALSE
-- for procurement (verified live — it falls to `else false`), so gating them on
-- it would admit them at the door and refuse them at every project.
--
-- The money guard is the point of the whole function: reopening a day whose
-- wages are booked would strand a labor_logs row whose basis can then be edited
-- away. It refuses instead — the same anti-join muster_undo_scan already uses
-- (a retraction is a null-fraction supersede row, so `exists` alone would freeze
-- an already-retracted day forever).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('70000000-0397-0397-0397-000000000009', 'super@s397.local', '{}'::jsonb),
  ('70000000-0397-0397-0397-00000000000c', 'proc@s397.local',  '{}'::jsonb),
  ('70000000-0397-0397-0397-00000000000d', 'sa@s397.local',    '{}'::jsonb),
  ('70000000-0397-0397-0397-00000000000e', 'pm@s397.local',    '{}'::jsonb),
  ('70000000-0397-0397-0397-0000000000fe', 'probe@s397.local', '{}'::jsonb);
update public.users set role = 'super_admin'  where id = '70000000-0397-0397-0397-000000000009';
update public.users set role = 'procurement'  where id = '70000000-0397-0397-0397-00000000000c';
update public.users set role = 'site_admin'   where id = '70000000-0397-0397-0397-00000000000d';
update public.users set role = 'procurement_manager' where id = '70000000-0397-0397-0397-00000000000e';

insert into public.projects (id, code, name) values
  ('a1000000-0397-0397-0397-000000000001', 'TAP-397A', 'โครงการเอ'),
  ('a2000000-0397-0397-0397-000000000002', 'TAP-397B', 'โครงการบี');

-- The site_admin is a member of A only — the membership arm of can_see_project.
insert into public.project_members (project_id, user_id, added_by) values
  ('a1000000-0397-0397-0397-000000000001', '70000000-0397-0397-0397-00000000000d',
   '70000000-0397-0397-0397-000000000009');

insert into public.workers (id, name, pay_type, employment_type, day_rate, active, created_by) values
  ('e1000000-0397-0397-0397-000000000001', 'ช่าง สาม', 'daily', 'temporary', 400, true,
   '70000000-0397-0397-0397-000000000009');

insert into public.muster_teams (id, project_id, work_date, lead_worker_id, created_by) values
  ('71000000-0397-0397-0397-000000000010', 'a1000000-0397-0397-0397-000000000001', '2026-07-10',
   'e1000000-0397-0397-0397-000000000001', '70000000-0397-0397-0397-000000000009');

insert into public.muster_attendance
  (id, team_id, worker_id, work_date, session, in_method, out_at, scanned_by) values
  ('b1000000-0397-0397-0397-000000000001', '71000000-0397-0397-0397-000000000010',
   'e1000000-0397-0397-0397-000000000001', '2026-07-10', 'regular', 'manual',
   '2026-07-10 17:00:00+07', '70000000-0397-0397-0397-000000000009');

insert into public.muster_day_closures (project_id, work_date, closed_at, closed_by) values
  ('a1000000-0397-0397-0397-000000000001', '2026-07-10', now(),
   '70000000-0397-0397-0397-000000000009');

-- The runner rewrites each assertion into an insert on the temp collector, and
-- this file asserts WHILE `set local role authenticated` — a fresh temp table
-- grants `authenticated` nothing, so without this the first post-switch assert
-- dies 42501 and the WHOLE file reports `not ok` with zero assertions run.
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Shape
-- ============================================================================
select has_function('public', 'reopen_muster_day', array['uuid', 'date', 'text'],
  'reopen_muster_day(project, date, reason) exists');
select is(
  (select prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'reopen_muster_day'),
  true, 'it is SECURITY DEFINER (muster RLS cannot serve procurement)');
select ok(
  has_function_privilege('authenticated', 'public.reopen_muster_day(uuid,date,text)', 'EXECUTE'),
  'authenticated may execute');
select ok(
  not has_function_privilege('anon', 'public.reopen_muster_day(uuid,date,text)', 'EXECUTE'),
  'anon may NOT execute (default grants are revoked)');

-- ============================================================================
-- B. The gate over ALL 17 roles: 4 may reopen, the other 13 raise 42501.
--    (probe user id fixed; only its role flips. A new enum value lands in the
--    denied arm and this count forces the author to classify it.)
-- ============================================================================
select is(array_length(enum_range(null::public.user_role), 1), 17,
  'user_role has 17 values — a new one must be classified into the gate below');

reset role;
update public.users set role = 'technician' where id = '70000000-0397-0397-0397-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0397-0397-0397-0000000000fe"}';
select throws_ok(
  $$select public.reopen_muster_day('a1000000-0397-0397-0397-000000000001'::uuid, '2026-07-10'::date, 'ตรวจสอบพบว่าลงเวลาไม่ครบ')$$,
  '42501', null, 'technician denied');
reset role;
-- ⚠️ RE-POINTED by spec 400 U6c, not deleted. `accounting` used to be the
-- headline denial here ("it READS the report, it does not edit the muster") — the
-- operator reversed exactly that on 2026-08-07 ("let's enable them first, we trust
-- the current team"), so the correction audience is now the AUDIT audience and
-- accounting is admitted. It moved to the positive controls below, where it also
-- has to re-close like every other admitted role.
update public.users set role = 'project_manager' where id = '70000000-0397-0397-0397-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0397-0397-0397-0000000000fe"}';
select throws_ok(
  $$select public.reopen_muster_day('a1000000-0397-0397-0397-000000000001'::uuid, '2026-07-10'::date, 'ตรวจสอบพบว่าลงเวลาไม่ครบ')$$,
  '42501', null,
  -- The REASON changed even though the verdict did not, so the message changed
  -- with it: U6c put project_manager IN the allowlist, and this probe user holds
  -- no project_members row, so it is now refused one layer down by MEMBERSHIP.
  -- That is the same tiering the READ side applies to project_manager, and the
  -- old wording ("it may not close either") would have been a false explanation
  -- of a passing test.
  'project_manager denied — in the allowlist since U6c, but NOT a member of this project');
reset role;
update public.users set role = 'visitor' where id = '70000000-0397-0397-0397-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0397-0397-0397-0000000000fe"}';
select throws_ok(
  $$select public.reopen_muster_day('a1000000-0397-0397-0397-000000000001'::uuid, '2026-07-10'::date, 'ตรวจสอบพบว่าลงเวลาไม่ครบ')$$,
  '42501', null, 'visitor denied');
reset role;
-- Unbound caller (no public.users row) — the coalesce/is-null hardening.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "00000000-0397-0397-0397-000000000000"}';
select throws_ok(
  $$select public.reopen_muster_day('a1000000-0397-0397-0397-000000000001'::uuid, '2026-07-10'::date, 'ตรวจสอบพบว่าลงเวลาไม่ครบ')$$,
  '42501', null, 'unbound caller (null role) denied, not silently allowed');
reset role;

-- POSITIVE CONTROLS for the other three allowed roles. Counting enum labels
-- against a hardcoded list would have "passed" without executing the function at
-- all — the denial arm above proves nothing about who is admitted. Each reopen
-- consumes the closure, so each control re-closes first.
-- Spec 400 U6c — accounting is now admitted and CROSS-PROJECT (can_see_project is
-- `else false` for it, so this proves the exemption arm, not a membership). It runs
-- first among the controls, and re-closes after, so the assertions below still meet
-- a closed day.
reset role;
update public.users set role = 'accounting' where id = '70000000-0397-0397-0397-0000000000fe';
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0397-0397-0397-0000000000fe"}';
select lives_ok(
  $$select public.reopen_muster_day('a1000000-0397-0397-0397-000000000001'::uuid, '2026-07-10'::date, 'เหตุผล')$$,
  'accounting MAY reopen since U6c — and cross-project, holding no membership');
reset role;
insert into public.muster_day_closures (project_id, work_date, closed_at, closed_by) values
  ('a1000000-0397-0397-0397-000000000001', '2026-07-10', now(),
   '70000000-0397-0397-0397-000000000009');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0397-0397-0397-000000000009"}';
select lives_ok(
  $$select public.reopen_muster_day('a1000000-0397-0397-0397-000000000001'::uuid, '2026-07-10'::date, 'เหตุผล')$$,
  'super_admin may reopen');
reset role;
insert into public.muster_day_closures (project_id, work_date, closed_at, closed_by) values
  ('a1000000-0397-0397-0397-000000000001', '2026-07-10', now(),
   '70000000-0397-0397-0397-000000000009');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0397-0397-0397-00000000000e"}';
select lives_ok(
  $$select public.reopen_muster_day('a1000000-0397-0397-0397-000000000001'::uuid, '2026-07-10'::date, 'เหตุผล')$$,
  'procurement_manager may reopen (it may close, so it may undo that)');
reset role;
insert into public.muster_day_closures (project_id, work_date, closed_at, closed_by) values
  ('a1000000-0397-0397-0397-000000000001', '2026-07-10', now(),
   '70000000-0397-0397-0397-000000000009');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0397-0397-0397-00000000000d"}';
select lives_ok(
  $$select public.reopen_muster_day('a1000000-0397-0397-0397-000000000001'::uuid, '2026-07-10'::date, 'เหตุผล')$$,
  'site_admin may reopen a project they ARE a member of');
reset role;
-- Restore the closure the D section reopens.
insert into public.muster_day_closures (project_id, work_date, closed_at, closed_by) values
  ('a1000000-0397-0397-0397-000000000001', '2026-07-10', now(),
   '70000000-0397-0397-0397-000000000009');

-- ============================================================================
-- C. Argument guards — a reason is MANDATORY (it is the whole audit value).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0397-0397-0397-00000000000c"}';
select throws_ok(
  $$select public.reopen_muster_day('a1000000-0397-0397-0397-000000000001'::uuid, '2026-07-10'::date, null)$$,
  'P0001', null, 'a null reason is refused');
select throws_ok(
  $$select public.reopen_muster_day('a1000000-0397-0397-0397-000000000001'::uuid, '2026-07-10'::date, '   ')$$,
  'P0001', null, 'a blank reason is refused (trimmed, not just null-checked)');
select throws_ok(
  $$select public.reopen_muster_day(null::uuid, '2026-07-10'::date, 'เหตุผล')$$,
  'P0001', null, 'a null project is refused');
-- A day that was never closed: refuse rather than silently succeed, so the UI
-- cannot report "reopened" for a day it did not change.
select throws_ok(
  $$select public.reopen_muster_day('a2000000-0397-0397-0397-000000000002'::uuid, '2026-07-10'::date, 'เหตุผล')$$,
  'P0001', null, 'a day with no closure is refused, not a silent no-op');
reset role;

-- ============================================================================
-- D. procurement reopens — WITHOUT can_see_project, which is false for the role.
-- ============================================================================
-- BEFORE: the closure exists. Read as the OWNER, and read FIRST — this is the
-- positive control that gives the "gone" assertion below its meaning.
-- `muster_day_closures`' only SELECT policy is can_see_project(project_id), which
-- this file asserts is FALSE for procurement, so under the caller's role BOTH
-- reads return 0 and the pair would stay green with the DELETE removed entirely.
-- Same trap as the audit_log block further down; caught by the U3 review, not by
-- the run.
set local role postgres;
select is(
  (select count(*)::int from public.muster_day_closures
    where project_id = 'a1000000-0397-0397-0397-000000000001' and work_date = '2026-07-10'),
  1, 'control: the closure IS there before procurement reopens it');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0397-0397-0397-00000000000c"}';
select is(public.can_see_project('a1000000-0397-0397-0397-000000000001'::uuid), false,
  'control: can_see_project IS false for procurement — the reason reopen cannot gate on it');
select lives_ok(
  $$select public.reopen_muster_day('a1000000-0397-0397-0397-000000000001'::uuid, '2026-07-10'::date, 'ตรวจสอบพบว่าลงเวลาไม่ครบ')$$,
  'procurement may reopen a closed day');

set local role postgres;
select is(
  (select count(*)::int from public.muster_day_closures
    where project_id = 'a1000000-0397-0397-0397-000000000001' and work_date = '2026-07-10'),
  0, 'the closure row is gone — the day is open again');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0397-0397-0397-00000000000c"}';
-- And undo, which refuses on a closed day, now works — that is the POINT.
select lives_ok(
  $$select public.muster_undo_scan('e1000000-0397-0397-0397-000000000001'::uuid, '2026-07-10'::date, 'regular'::public.muster_session)$$,
  'the check-in can now be undone — reopen is what unblocks the correction');
reset role;

-- The audit row is the artifact the whole unit exists for — asserted as the
-- OWNER, not as the caller. audit_log's SELECT policy is an EVENT ALLOWLIST
-- (privileged internal roles, plus site_admin/procurement for wp-rework events
-- ONLY), so reading it back as `procurement` returns zero rows for a row that
-- WAS written: the first cut of these asserts failed for a reason that had
-- nothing to do with the function — proved by running this file's own fixture
-- path under `db query`, where the same four reopens leave four audit rows.
-- `set local role postgres`, not a bare `reset role`: under the runner the reset
-- did not restore owner visibility, and a filtered read would have made these
-- asserts report 0 forever.
-- ⚠️ It also means no app surface shows this event to procurement — the role
-- that performs it cannot read its own audit trail. Recorded in the spec §9.
set local role postgres;
-- Scoped by ACTOR, not by `order by created_at desc limit 1`: every reopen in
-- this file happens inside ONE transaction, and `now()` is the transaction
-- timestamp — so all four rows share a created_at to the microsecond and any
-- ordering tie-break is arbitrary. The first cut of these asserts read
-- super_admin's row (from the section-B positive controls) and called it
-- procurement's.
select is(
  (select count(*)::int from public.audit_log
    where target_table = 'muster_day_closures'
      and payload->>'kind' = 'muster_day_reopen'
      and payload->>'work_date' = '2026-07-10'
      and actor_id = '70000000-0397-0397-0397-00000000000c'),
  1, 'exactly one audit row records procurement''s reopen');
select is(
  (select payload->>'reason' from public.audit_log
    where target_table = 'muster_day_closures' and payload->>'kind' = 'muster_day_reopen'
      and actor_id = '70000000-0397-0397-0397-00000000000c'),
  'ตรวจสอบพบว่าลงเวลาไม่ครบ', 'the audit row carries the operator''s reason verbatim');
select is(
  (select actor_role::text from public.audit_log
    where target_table = 'muster_day_closures' and payload->>'kind' = 'muster_day_reopen'
      and actor_id = '70000000-0397-0397-0397-00000000000c'),
  'procurement', 'the audit row names who did it');
select is(
  (select payload->'closure'->>'closed_by' from public.audit_log
    where target_table = 'muster_day_closures' and payload->>'kind' = 'muster_day_reopen'
      and actor_id = '70000000-0397-0397-0397-00000000000c'),
  '70000000-0397-0397-0397-000000000009',
  'and it preserves the closure row it deleted (the only surviving copy)');
-- Every reopen in this file is audited — the trail has no gaps, whoever did it.
-- ⚠️ 4 → 5 with spec 400 U6c: accounting became an admitted role and so added a
-- fifth successful reopen above. The number is a COUNT of real calls, so it moves
-- whenever the audience does — that is the assertion working, not drifting.
select is(
  (select count(*)::int from public.audit_log
    where payload->>'kind' = 'muster_day_reopen'
      and payload->>'work_date' = '2026-07-10'),
  5, 'every reopen in this file left an audit row (4 positive controls + procurement)');

-- ============================================================================
-- E. The money guard — a day whose wages are CURRENT may not be reopened.
-- ============================================================================
insert into public.muster_attendance
  (id, team_id, worker_id, work_date, session, in_method, out_at, scanned_by) values
  ('b2000000-0397-0397-0397-000000000002', '71000000-0397-0397-0397-000000000010',
   'e1000000-0397-0397-0397-000000000001', '2026-07-10', 'regular', 'manual',
   '2026-07-10 17:00:00+07', '70000000-0397-0397-0397-000000000009');
insert into public.muster_day_closures (project_id, work_date, closed_at, closed_by) values
  ('a1000000-0397-0397-0397-000000000001', '2026-07-10', now(),
   '70000000-0397-0397-0397-000000000009');
insert into public.labor_logs
  (work_package_id, worker_id, work_date, day_fraction, source_muster_id, day_rate_snapshot,
   worker_name_snapshot, pay_type_snapshot, entered_by, self_logged)
select wp.id, 'e1000000-0397-0397-0397-000000000001', '2026-07-10', 'full'::public.day_fraction,
       'b2000000-0397-0397-0397-000000000002', 400, 'ช่าง สาม', 'daily',
       '70000000-0397-0397-0397-000000000009', false
  -- A LEAF work package: wp_reject_group_binding() refuses a labor_logs row bound
  -- to a group (งาน). Borrowing a live WP is fine — the row is rolled back, and
  -- the guard under test keys on source_muster_id, not on which WP it names.
  from public.work_packages wp where wp.is_group = false limit 1;

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0397-0397-0397-00000000000c"}';
select throws_ok(
  $$select public.reopen_muster_day('a1000000-0397-0397-0397-000000000001'::uuid, '2026-07-10'::date, 'เหตุผล')$$,
  'P0001', null, 'a day with CURRENT wage rows is refused — reopening would strand them');
reset role;

-- A RETRACTED wage (null fraction supersede, ADR 0009/0015) must NOT freeze the
-- day forever: the guard is an anti-join, not a bare exists().
insert into public.labor_logs
  (work_package_id, worker_id, work_date, day_fraction, source_muster_id, day_rate_snapshot,
   worker_name_snapshot, pay_type_snapshot, entered_by, self_logged, superseded_by,
   correction_reason)
-- `labor_logs_reason_iff_correction` — a null day_fraction (a retraction) MUST
-- carry a reason, and a normal row must not. The check is what makes a retraction
-- self-describing, which is exactly what the anti-join below relies on.
select ll.work_package_id, ll.worker_id, ll.work_date, null, ll.source_muster_id,
       ll.day_rate_snapshot, ll.worker_name_snapshot, ll.pay_type_snapshot, ll.entered_by,
       ll.self_logged, ll.id, 'ยกเลิกเพื่อทดสอบ'
  from public.labor_logs ll
 where ll.source_muster_id = 'b2000000-0397-0397-0397-000000000002';

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0397-0397-0397-00000000000c"}';
select lives_ok(
  $$select public.reopen_muster_day('a1000000-0397-0397-0397-000000000001'::uuid, '2026-07-10'::date, 'เหตุผล')$$,
  'a day whose wages were RETRACTED reopens — the guard is an anti-join, not exists()');
reset role;

-- ============================================================================
-- F. site_admin keeps close_muster_day's membership scope; procurement does not.
-- ============================================================================
insert into public.muster_day_closures (project_id, work_date, closed_at, closed_by) values
  ('a2000000-0397-0397-0397-000000000002', '2026-07-10', now(),
   '70000000-0397-0397-0397-000000000009');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0397-0397-0397-00000000000d"}';
select throws_ok(
  $$select public.reopen_muster_day('a2000000-0397-0397-0397-000000000002'::uuid, '2026-07-10'::date, 'เหตุผล')$$,
  '42501', null, 'site_admin may not reopen a project they are not a member of');
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0397-0397-0397-00000000000c"}';
select lives_ok(
  $$select public.reopen_muster_day('a2000000-0397-0397-0397-000000000002'::uuid, '2026-07-10'::date, 'เหตุผล')$$,
  'procurement reopens ANY project — the cross-project tier, mirroring the audit RPCs');
reset role;

select * from finish();
rollback;
