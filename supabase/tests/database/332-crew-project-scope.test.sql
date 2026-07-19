begin;
select plan(30);

-- ============================================================================
-- Spec 330 U3c — every crew RPC is scoped to the crew's OWN project.
--
-- WHY: U2 gave the eight crew RPCs a ROLE gate (is_back_office) and nothing
-- else. is_back_office admits procurement + procurement_manager, who are NOT
-- in PM_ROLES and therefore cannot open /projects/:id/team at all — yet the
-- functions are `grant execute to authenticated`, so those five live logins
-- could rename, dissolve, or re-crew ANY project straight through PostgREST.
-- A project_manager was equally unbounded: back-office role, any project.
-- Crew → /sa/plan draft → set_daily_plan_item_crew → mark-present →
-- log_labor_day → payroll, so this is a money-adjacent write path.
--
-- The fix mirrors the muster family (open_muster_team / move_muster_worker),
-- which has carried `can_see_project` since spec 306: role gate → row lookup
-- → scope gate. can_see_project() is itself the SSOT — super_admin /
-- project_coordinator / project_director see every project, PM / site_admin /
-- site_owner / auditor see the ones they are a member of (or lead), and
-- everyone else — procurement included — sees none.
--
-- The project is ALWAYS derived from the crew row, never from a caller-supplied
-- id; create_crew is the one exception and checks p_project itself, and
-- move_worker_between_crews checks BOTH ends.
--
-- ⭐ Every scope assert PINS the exception message. Without the pin these tests
-- pass off the functions' pre-existing guards ('crew not found', 'worker
-- belongs to another project', 'not authorized') and stay green with the scope
-- gate entirely absent — exactly the false green caught in U3a's review.
-- ============================================================================

-- ── actors ──────────────────────────────────────────────────────────────────
-- pmA  : project_manager, member of project A only
-- pmB  : project_manager, member of project B only  → back-office, non-member of A
-- proc : procurement       → is_back_office TRUE, can_see_project FALSE everywhere
-- sa   : super_admin       → sees every project unconditionally
insert into auth.users (id, email, raw_user_meta_data) values
  ('70000000-0332-0332-0332-700000000332', 'pma@s332.local', '{}'::jsonb),
  ('71000000-0332-0332-0332-710000000332', 'pmb@s332.local', '{}'::jsonb),
  ('72000000-0332-0332-0332-720000000332', 'proc@s332.local', '{}'::jsonb),
  ('73000000-0332-0332-0332-730000000332', 'sa@s332.local', '{}'::jsonb);
update public.users set role = 'project_manager' where id = '70000000-0332-0332-0332-700000000332';
update public.users set role = 'project_manager' where id = '71000000-0332-0332-0332-710000000332';
update public.users set role = 'procurement'     where id = '72000000-0332-0332-0332-720000000332';
update public.users set role = 'super_admin'     where id = '73000000-0332-0332-0332-730000000332';

insert into public.projects (id, code, name) values
  ('a1000000-0332-0332-0332-a10000000332', 'TAP-332A', 'โครงการทดสอบขอบเขต ก'),
  ('a2000000-0332-0332-0332-a20000000332', 'TAP-332B', 'โครงการทดสอบขอบเขต ข');
insert into public.project_members (project_id, user_id, added_by) values
  ('a1000000-0332-0332-0332-a10000000332', '70000000-0332-0332-0332-700000000332',
   '70000000-0332-0332-0332-700000000332'),
  ('a2000000-0332-0332-0332-a20000000332', '71000000-0332-0332-0332-710000000332',
   '71000000-0332-0332-0332-710000000332');

insert into public.workers (id, name, pay_type, employment_type, day_rate, active, project_id, created_by) values
  ('e1000000-0332-0332-0332-e10000000332', 'ช่างหนึ่ง', 'daily', 'temporary', 400, true,
   'a1000000-0332-0332-0332-a10000000332', '70000000-0332-0332-0332-700000000332'),
  ('e2000000-0332-0332-0332-e20000000332', 'ช่างสอง', 'daily', 'temporary', 400, true,
   'a1000000-0332-0332-0332-a10000000332', '70000000-0332-0332-0332-700000000332');

-- c1 + c2 live in project A; c3 lives in project B (the cross-project target).
insert into public.crews (id, project_id, name, kind, active, created_by) values
  ('c1000000-0332-0332-0332-c10000000332', 'a1000000-0332-0332-0332-a10000000332',
   'ทีมหนึ่ง', 'dc', true, '70000000-0332-0332-0332-700000000332'),
  ('c2000000-0332-0332-0332-c20000000332', 'a1000000-0332-0332-0332-a10000000332',
   'ทีมสอง', 'dc', true, '70000000-0332-0332-0332-700000000332'),
  ('c3000000-0332-0332-0332-c30000000332', 'a2000000-0332-0332-0332-a20000000332',
   'ทีมข', 'dc', true, '71000000-0332-0332-0332-710000000332');

grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. SOURCE PINS — all eight carry the scope gate.
--
-- Behavioural asserts alone are mutation-fragile: a later migration that
-- re-sources one body drops its guard silently while every other assert in
-- this file still passes (U3a lesson ③). These pin the property at the source
-- so a dropped guard is a red, not a hole.
-- ============================================================================
select ok(pg_get_functiondef('public.add_worker_to_crew(uuid,uuid)'::regprocedure)
  like '%can_see_project%', 'add_worker_to_crew carries the project-scope gate');
select ok(pg_get_functiondef('public.remove_worker_from_crew(uuid,uuid)'::regprocedure)
  like '%can_see_project%', 'remove_worker_from_crew carries the project-scope gate');
select ok(pg_get_functiondef('public.move_worker_between_crews(uuid,uuid,uuid)'::regprocedure)
  like '%can_see_project%', 'move_worker_between_crews carries the project-scope gate');
select ok(pg_get_functiondef('public.set_crew_lead(uuid,uuid)'::regprocedure)
  like '%can_see_project%', 'set_crew_lead carries the project-scope gate');
select ok(pg_get_functiondef('public.rename_crew(uuid,text)'::regprocedure)
  like '%can_see_project%', 'rename_crew carries the project-scope gate');
select ok(pg_get_functiondef('public.dissolve_crew(uuid)'::regprocedure)
  like '%can_see_project%', 'dissolve_crew carries the project-scope gate');
select ok(pg_get_functiondef('public.create_crew(uuid,text,uuid,text,numeric)'::regprocedure)
  like '%can_see_project%', 'create_crew carries the project-scope gate');
select ok(pg_get_functiondef('public.reassign_crew_lead(uuid,uuid)'::regprocedure)
  like '%can_see_project%', 'reassign_crew_lead carries the project-scope gate');

-- ============================================================================
-- B. POSITIVE CONTROLS FIRST — the member PM still runs the whole surface. A
--    gate that also blocks the legitimate caller is not a fix.
--
--    ⚠ ORDER IS DELIBERATE: the denial sections run LAST, and the destructive
--    denial (dissolve) runs last within its own section. In the RED state
--    those calls SUCCEED, and a dissolved c1 would make every later assert
--    abort the whole file on an uncaught 22023 instead of reporting a clean
--    per-assert failure — which is what the first draft of this file did.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0332-0332-0332-700000000332"}';

select ok(
  (select public.add_worker_to_crew('c1000000-0332-0332-0332-c10000000332',
     'e1000000-0332-0332-0332-e10000000332')) is not null,
  'the member PM still adds a worker to a crew');

-- MOVE CHECKS BOTH ENDS — a member of the source project must not be able to
-- push a worker into a crew belonging to a project they cannot see. The
-- message pin is what makes this real: without it the assert passes off the
-- pre-existing 'worker belongs to another project' guard.
select throws_ok(
  $$ select public.move_worker_between_crews('c1000000-0332-0332-0332-c10000000332',
       'c3000000-0332-0332-0332-c30000000332', 'e1000000-0332-0332-0332-e10000000332') $$,
  '42501', 'not a member of this project',
  'move is refused on the TARGET end when the target crew is in another project');

select ok(
  (select public.set_crew_lead('c1000000-0332-0332-0332-c10000000332',
     'e1000000-0332-0332-0332-e10000000332')) is not null,
  'the member PM still sets a crew lead');
select ok(
  (select public.rename_crew('c1000000-0332-0332-0332-c10000000332', 'ทีมหนึ่งแก้ชื่อ')) is not null,
  'the member PM still renames a crew');
select lives_ok(
  $$ select public.reassign_crew_lead('c1000000-0332-0332-0332-c10000000332',
       'e2000000-0332-0332-0332-e20000000332') $$,
  'the member PM still reassigns a crew lead');
select ok(
  (select public.move_worker_between_crews('c1000000-0332-0332-0332-c10000000332',
     'c2000000-0332-0332-0332-c20000000332',
     'e1000000-0332-0332-0332-e10000000332')) is not null,
  'the member PM still moves a worker between crews in their own project');
select ok(
  (select public.remove_worker_from_crew('c2000000-0332-0332-0332-c20000000332',
     'e1000000-0332-0332-0332-e10000000332')) is not null,
  'the member PM still removes a worker from a crew');
select ok(
  (select public.create_crew('a1000000-0332-0332-0332-a10000000332', 'ทีมสาม')) is not null,
  'the member PM still creates a crew in their own project');
select ok(
  (select public.dissolve_crew('c2000000-0332-0332-0332-c20000000332')) is not null,
  'the member PM still dissolves a crew');

-- ============================================================================
-- C. super_admin keeps the unconditional arm — can_see_project returns true
--    for every project, so cross-project administration still works.
-- ============================================================================
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "73000000-0332-0332-0332-730000000332"}';

select ok(
  (select public.rename_crew('c3000000-0332-0332-0332-c30000000332', 'ทีมข แก้โดยผู้ดูแล')) is not null,
  'super_admin still administers a crew in a project it is not a member of');

-- ============================================================================
-- D. THE HOLE, NAMED — procurement is back-office but sees no project.
-- ============================================================================
reset role;
select ok(public.is_back_office('procurement'::public.user_role),
  'procurement IS back-office — the U2 role gate admitted it');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "72000000-0332-0332-0332-720000000332"}';

select ok(not public.can_see_project('a1000000-0332-0332-0332-a10000000332'),
  'procurement can see NO project — so the page is closed to it and the RPC must be too');

select throws_ok(
  $$ select public.add_worker_to_crew('c1000000-0332-0332-0332-c10000000332',
       'e1000000-0332-0332-0332-e10000000332') $$,
  '42501', 'not a member of this project',
  'procurement cannot add a worker to a crew in a project it cannot open');
select throws_ok(
  $$ select public.create_crew('a1000000-0332-0332-0332-a10000000332', 'ทีมแอบตั้ง') $$,
  '42501', 'not a member of this project',
  'procurement cannot create a crew in a project it cannot open');

-- ============================================================================
-- E. A NON-MEMBER project_manager is refused by all eight.
--    pmB is back-office and a member of project B — never of project A.
--    dissolve runs LAST: in the RED state it succeeds, and a dissolved c1
--    would poison every assert after it.
-- ============================================================================
reset role;
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "71000000-0332-0332-0332-710000000332"}';

select throws_ok(
  $$ select public.add_worker_to_crew('c1000000-0332-0332-0332-c10000000332',
       'e2000000-0332-0332-0332-e20000000332') $$,
  '42501', 'not a member of this project',
  'add_worker_to_crew is scoped to the CREW''s project');
select throws_ok(
  $$ select public.remove_worker_from_crew('c1000000-0332-0332-0332-c10000000332',
       'e1000000-0332-0332-0332-e10000000332') $$,
  '42501', 'not a member of this project',
  'remove_worker_from_crew is scoped to the CREW''s project');
select throws_ok(
  $$ select public.move_worker_between_crews('c1000000-0332-0332-0332-c10000000332',
       'c2000000-0332-0332-0332-c20000000332', 'e1000000-0332-0332-0332-e10000000332') $$,
  '42501', 'not a member of this project',
  'move_worker_between_crews is scoped on the SOURCE crew');
select throws_ok(
  $$ select public.set_crew_lead('c1000000-0332-0332-0332-c10000000332',
       'e1000000-0332-0332-0332-e10000000332') $$,
  '42501', 'not a member of this project',
  'set_crew_lead is scoped to the crew''s project');
select throws_ok(
  $$ select public.rename_crew('c1000000-0332-0332-0332-c10000000332', 'ทีมโดนแก้ชื่อ') $$,
  '42501', 'not a member of this project',
  'rename_crew is scoped to the crew''s project');
select throws_ok(
  $$ select public.create_crew('a1000000-0332-0332-0332-a10000000332', 'ทีมข้ามโครงการ') $$,
  '42501', 'not a member of this project',
  'create_crew is scoped on p_project (the one caller-supplied project id)');
select throws_ok(
  $$ select public.reassign_crew_lead('c1000000-0332-0332-0332-c10000000332',
       'e1000000-0332-0332-0332-e10000000332') $$,
  '42501', 'not a member of this project',
  'reassign_crew_lead (the OTHER lead writer) is scoped too');
select throws_ok(
  $$ select public.dissolve_crew('c1000000-0332-0332-0332-c10000000332') $$,
  '42501', 'not a member of this project',
  'dissolve_crew is scoped to the crew''s project');

reset role;
select * from finish();
rollback;
