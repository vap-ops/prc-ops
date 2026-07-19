begin;
select plan(56);

-- ============================================================================
-- Spec 330 U2 — crew membership + lifecycle DEFINER RPCs over the dormant
-- spec-279 crews/crew_members tables (the team-map's write layer).
--   * Gate mirrors the live create_crew: is_back_office, fail-closed, audit_log
--     'crew_change' rows, revoke-anon.
--   * add_worker_to_crew: same-project active worker into an ACTIVE crew;
--     a worker holds ≤1 active membership (partial unique index) — adding
--     while active elsewhere MOVES (closes the old membership first).
--   * remove_worker_from_crew: soft-close (removed_at), history preserved;
--     re-add = NEW row.
--   * move_worker_between_crews: explicit move, requires active membership in
--     the from-crew.
--   * set_crew_lead: lead must be an ACTIVE MEMBER of the crew.
--   * rename_crew: nonblank.
--   * dissolve_crew: active=false + closes every active membership; add into a
--     dissolved crew refused; re-dissolve = no-op.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('70000000-0330-0330-0330-700000000330', 'pm@s330.local',      '{}'::jsonb),
  ('71000000-0330-0330-0330-710000000330', 'visitor@s330.local', '{}'::jsonb),
  ('72000000-0330-0330-0330-720000000330', 'tech@s330.local',    '{}'::jsonb);
update public.users set role = 'project_manager' where id = '70000000-0330-0330-0330-700000000330';
update public.users set role = 'visitor'         where id = '71000000-0330-0330-0330-710000000330';
update public.users set role = 'technician'      where id = '72000000-0330-0330-0330-720000000330';

insert into public.projects (id, code, name) values
  ('a1000000-0330-0330-0330-a10000000330', 'TAP-330A', 'โครงการทดสอบทีมช่าง'),
  ('a2000000-0330-0330-0330-a20000000330', 'TAP-330B', 'โครงการอื่น');
insert into public.project_members (project_id, user_id, added_by) values
  ('a1000000-0330-0330-0330-a10000000330', '70000000-0330-0330-0330-700000000330',
   '70000000-0330-0330-0330-700000000330'),
  -- Membership in project B is DELIBERATE and load-bearing: spec 330 U3c gates
  -- every crew RPC on can_see_project, and the cross-project asserts below are
  -- about the RPCs' OWN project-consistency rules ('worker belongs to another
  -- project', 22023). Without this row the U3c scope gate (42501) fires first
  -- and those asserts would silently stop testing what they name. The scope
  -- gate itself is covered by 332-crew-project-scope.test.sql.
  ('a2000000-0330-0330-0330-a20000000330', '70000000-0330-0330-0330-700000000330',
   '70000000-0330-0330-0330-700000000330');

insert into public.workers (id, name, pay_type, employment_type, day_rate, active, project_id, created_by) values
  ('e1000000-0330-0330-0330-e10000000330', 'ช่างหนึ่ง', 'daily', 'temporary', 400, true,
   'a1000000-0330-0330-0330-a10000000330', '70000000-0330-0330-0330-700000000330'),
  ('e2000000-0330-0330-0330-e20000000330', 'ช่างสอง', 'daily', 'temporary', 400, true,
   'a1000000-0330-0330-0330-a10000000330', '70000000-0330-0330-0330-700000000330'),
  ('e3000000-0330-0330-0330-e30000000330', 'ช่างหมดสภาพ', 'daily', 'temporary', 400, false,
   'a1000000-0330-0330-0330-a10000000330', '70000000-0330-0330-0330-700000000330'),
  ('e4000000-0330-0330-0330-e40000000330', 'ช่างข้ามโครงการ', 'daily', 'temporary', 400, true,
   'a2000000-0330-0330-0330-a20000000330', '70000000-0330-0330-0330-700000000330');

insert into public.crews (id, project_id, name, kind, active, created_by) values
  ('c1000000-0330-0330-0330-c10000000330', 'a1000000-0330-0330-0330-a10000000330',
   'ทีมปูน', 'dc', true, '70000000-0330-0330-0330-700000000330'),
  ('c2000000-0330-0330-0330-c20000000330', 'a1000000-0330-0330-0330-a10000000330',
   'ทีมเหล็ก', 'dc', true, '70000000-0330-0330-0330-700000000330'),
  ('c3000000-0330-0330-0330-c30000000330', 'a2000000-0330-0330-0330-a20000000330',
   'ทีมโครงการอื่น', 'dc', true, '70000000-0330-0330-0330-700000000330');

-- role-switched asserts write into the runner's collector (pgTAP-required
-- grant on role-switch — see pgtap-tapbuf lesson, PR #400).
grant insert on _tap_buf to authenticated, anon;
grant select on _tap_buf to authenticated, anon;
grant usage  on sequence _tap_buf_ord_seq to authenticated, anon;

-- ============================================================================
-- A. Existence + anon lock.
-- ============================================================================
select has_function('public', 'add_worker_to_crew', array['uuid','uuid'],
  'add_worker_to_crew exists');
select has_function('public', 'remove_worker_from_crew', array['uuid','uuid'],
  'remove_worker_from_crew exists');
select has_function('public', 'move_worker_between_crews', array['uuid','uuid','uuid'],
  'move_worker_between_crews exists');
select has_function('public', 'set_crew_lead', array['uuid','uuid'],
  'set_crew_lead exists');
select has_function('public', 'rename_crew', array['uuid','text'],
  'rename_crew exists');
select has_function('public', 'dissolve_crew', array['uuid'],
  'dissolve_crew exists');

select ok(not has_function_privilege('anon', 'public.add_worker_to_crew(uuid,uuid)', 'execute'),
  'anon cannot execute add_worker_to_crew');
select ok(not has_function_privilege('anon', 'public.remove_worker_from_crew(uuid,uuid)', 'execute'),
  'anon cannot execute remove_worker_from_crew');
select ok(not has_function_privilege('anon', 'public.move_worker_between_crews(uuid,uuid,uuid)', 'execute'),
  'anon cannot execute move_worker_between_crews');
select ok(not has_function_privilege('anon', 'public.set_crew_lead(uuid,uuid)', 'execute'),
  'anon cannot execute set_crew_lead');
select ok(not has_function_privilege('anon', 'public.rename_crew(uuid,text)', 'execute'),
  'anon cannot execute rename_crew');
select ok(not has_function_privilege('anon', 'public.dissolve_crew(uuid)', 'execute'),
  'anon cannot execute dissolve_crew');

-- The ≤1-active-crew rule is enforced by the ORIGINAL spec-279 index
-- (crew_members_one_active_per_worker_uq, mig 075410) — U2 must not have
-- added a functionally duplicate second index (fresh-eyes catch).
select ok(
  not exists (select 1 from pg_indexes
    where tablename = 'crew_members' and indexname = 'crew_members_one_active_per_worker'),
  'no duplicate active-membership unique index (279''s _uq is the enforcer)');

-- ============================================================================
-- B. add_worker_to_crew — gate, validation, add, idempotency, add-moves.
-- ============================================================================
-- JWT-less caller: current_user_role() is NULL → is_back_office must fail
-- CLOSED (the rls_null_safe_role_wrappers class).
set local role authenticated;
-- ⭐ The MESSAGE is pinned on all three. Since spec 330 U3c these functions
-- raise 42501 from TWO different guards — the role gate here and the
-- can_see_project scope gate — and none of these callers passes either. With
-- only the errcode pinned, deleting `is_back_office` from add_worker_to_crew
-- would leave all three green off the scope gate, and nothing else pins the
-- role gate. (Same discipline as 332's header: pin the message whenever one
-- function raises the same errcode from more than one place.)
set local "request.jwt.claims" = '{}';
select throws_ok(
  $$ select public.add_worker_to_crew('c1000000-0330-0330-0330-c10000000330',
       'e1000000-0330-0330-0330-e10000000330') $$,
  '42501', 'not authorized to manage crew members',
  'a roleless/JWT-less caller is refused ON THE ROLE GATE (null-safe)');

set local "request.jwt.claims" = '{"sub": "71000000-0330-0330-0330-710000000330"}';
select throws_ok(
  $$ select public.add_worker_to_crew('c1000000-0330-0330-0330-c10000000330',
       'e1000000-0330-0330-0330-e10000000330') $$,
  '42501', 'not authorized to manage crew members',
  'a visitor cannot add a crew member (role gate)');
set local "request.jwt.claims" = '{"sub": "72000000-0330-0330-0330-720000000330"}';
select throws_ok(
  $$ select public.add_worker_to_crew('c1000000-0330-0330-0330-c10000000330',
       'e1000000-0330-0330-0330-e10000000330') $$,
  '42501', 'not authorized to manage crew members',
  'a technician cannot add a crew member (role gate)');

set local "request.jwt.claims" = '{"sub": "70000000-0330-0330-0330-700000000330"}';
select ok(
  (select public.add_worker_to_crew('c1000000-0330-0330-0330-c10000000330',
     'e1000000-0330-0330-0330-e10000000330')) is not null,
  'PM adds worker 1 to ทีมปูน');
select ok(
  (select public.add_worker_to_crew('c1000000-0330-0330-0330-c10000000330',
     'e2000000-0330-0330-0330-e20000000330')) is not null,
  'PM adds worker 2 to ทีมปูน');

select throws_ok(
  $$ select public.add_worker_to_crew('c1000000-0330-0330-0330-c10000000330',
       'e3000000-0330-0330-0330-e30000000330') $$,
  'P0002', null, 'an inactive worker is refused');
select throws_ok(
  $$ select public.add_worker_to_crew('c1000000-0330-0330-0330-c10000000330',
       'e4000000-0330-0330-0330-e40000000330') $$,
  '22023', null, 'a worker bound to ANOTHER project is refused');
reset role;

select is(
  (select count(*)::int from public.crew_members
    where crew_id = 'c1000000-0330-0330-0330-c10000000330' and removed_at is null),
  2, 'ทีมปูน holds 2 active memberships');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0330-0330-0330-700000000330"}';
select ok(
  (select public.add_worker_to_crew('c1000000-0330-0330-0330-c10000000330',
     'e1000000-0330-0330-0330-e10000000330')) is not null,
  're-adding an active member is a friendly no-op (idempotent)');
reset role;
select is(
  (select count(*)::int from public.crew_members
    where crew_id = 'c1000000-0330-0330-0330-c10000000330'
      and worker_id = 'e1000000-0330-0330-0330-e10000000330'),
  1, 'idempotent re-add did not duplicate the membership row');

-- add-moves: worker 1 joins ทีมเหล็ก → the ทีมปูน membership closes.
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0330-0330-0330-700000000330"}';
select ok(
  (select public.add_worker_to_crew('c2000000-0330-0330-0330-c20000000330',
     'e1000000-0330-0330-0330-e10000000330')) is not null,
  'adding an already-teamed worker MOVES them (≤1 active crew)');
reset role;
select is(
  (select count(*)::int from public.crew_members
    where worker_id = 'e1000000-0330-0330-0330-e10000000330' and removed_at is null),
  1, 'worker 1 holds exactly ONE active membership after the move');
select is(
  (select crew_id from public.crew_members
    where worker_id = 'e1000000-0330-0330-0330-e10000000330' and removed_at is null),
  'c2000000-0330-0330-0330-c20000000330'::uuid,
  'the surviving active membership is ทีมเหล็ก');
select is(
  (select count(*)::int from public.crew_members
    where worker_id = 'e1000000-0330-0330-0330-e10000000330' and removed_at is not null),
  1, 'the ทีมปูน membership is CLOSED, not deleted (history preserved)');
-- The implicit move must be visible in BOTH crews' audit trails
-- (fresh-eyes catch: the departed crew's trail was silent).
select ok(
  (select count(*) from public.audit_log
    where action = 'crew_change' and target_table = 'crew_members'
      and payload->>'op' = 'remove'
      and payload->>'crew_id' = 'c1000000-0330-0330-0330-c10000000330'
      and payload->>'worker_id' = 'e1000000-0330-0330-0330-e10000000330') > 0,
  'the implicit move audited the DEPARTED crew (op=remove on ทีมปูน)');
select ok(
  (select count(*) from public.audit_log
    where action = 'crew_change' and target_table = 'crew_members'
      and payload->>'op' = 'add'
      and payload->>'moved_from_crew_id' = 'c1000000-0330-0330-0330-c10000000330') > 0,
  'the add-that-moves records moved_from_crew_id in its payload');

-- ============================================================================
-- C. remove_worker_from_crew — soft close + re-add = new row.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0330-0330-0330-700000000330"}';
select throws_ok(
  $$ select public.remove_worker_from_crew('c2000000-0330-0330-0330-c20000000330',
       'e2000000-0330-0330-0330-e20000000330') $$,
  'P0002', null, 'removing a non-member is refused');
select ok(
  (select public.remove_worker_from_crew('c2000000-0330-0330-0330-c20000000330',
     'e1000000-0330-0330-0330-e10000000330')) is not null,
  'PM removes worker 1 from ทีมเหล็ก');
reset role;
select is(
  (select count(*)::int from public.crew_members
    where worker_id = 'e1000000-0330-0330-0330-e10000000330' and removed_at is null),
  0, 'worker 1 holds no active membership after removal');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0330-0330-0330-700000000330"}';
select ok(
  (select public.add_worker_to_crew('c2000000-0330-0330-0330-c20000000330',
     'e1000000-0330-0330-0330-e10000000330')) is not null,
  're-add after removal works');
reset role;
select is(
  (select count(*)::int from public.crew_members
    where crew_id = 'c2000000-0330-0330-0330-c20000000330'
      and worker_id = 'e1000000-0330-0330-0330-e10000000330'),
  2, 're-add is a NEW row — membership history has 2 rows');

-- ============================================================================
-- D. move_worker_between_crews.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0330-0330-0330-700000000330"}';
-- e2 is active in ทีมปูน (c1), NOT in ทีมเหล็ก (c2) — so c2 as the source
-- must refuse.
select throws_ok(
  $$ select public.move_worker_between_crews('c2000000-0330-0330-0330-c20000000330',
       'c1000000-0330-0330-0330-c10000000330', 'e2000000-0330-0330-0330-e20000000330') $$,
  'P0002', null, 'moving a worker who is not active in the from-crew is refused');
select throws_ok(
  $$ select public.move_worker_between_crews('c2000000-0330-0330-0330-c20000000330',
       'c3000000-0330-0330-0330-c30000000330', 'e1000000-0330-0330-0330-e10000000330') $$,
  '22023', null, 'moving into a crew of ANOTHER project is refused');
select ok(
  (select public.move_worker_between_crews('c2000000-0330-0330-0330-c20000000330',
     'c1000000-0330-0330-0330-c10000000330', 'e1000000-0330-0330-0330-e10000000330')) is not null,
  'PM moves worker 1 ทีมเหล็ก → ทีมปูน');
-- Same-crew "move" = friendly no-op, and must NOT fabricate a move event
-- (fresh-eyes catch).
select ok(
  (select public.move_worker_between_crews('c1000000-0330-0330-0330-c10000000330',
     'c1000000-0330-0330-0330-c10000000330', 'e1000000-0330-0330-0330-e10000000330')) is not null,
  'moving a worker to the crew they are already in is a friendly no-op');
reset role;
select is(
  (select count(*)::int from public.audit_log
    where action = 'crew_change' and payload->>'op' = 'move'
      and payload->>'from_crew_id' = payload->>'to_crew_id'),
  0, 'a same-crew no-op move writes NO move audit row');
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0330-0330-0330-700000000330"}';
select is(
  (select crew_id from public.crew_members
    where worker_id = 'e1000000-0330-0330-0330-e10000000330' and removed_at is null),
  'c1000000-0330-0330-0330-c10000000330'::uuid,
  'after the move the single active membership is ทีมปูน');

-- ============================================================================
-- E. set_crew_lead — lead must be an active member.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0330-0330-0330-700000000330"}';
-- e3 never joined any crew — membership is the lead predicate.
select throws_ok(
  $$ select public.set_crew_lead('c1000000-0330-0330-0330-c10000000330',
       'e3000000-0330-0330-0330-e30000000330') $$,
  '22023', null, 'a non-member cannot be made lead');
select ok(
  (select public.set_crew_lead('c1000000-0330-0330-0330-c10000000330',
     'e1000000-0330-0330-0330-e10000000330')) is not null,
  'PM sets worker 1 as ทีมปูน lead');
reset role;
select is(
  (select lead_worker_id from public.crews where id = 'c1000000-0330-0330-0330-c10000000330'),
  'e1000000-0330-0330-0330-e10000000330'::uuid, 'crews.lead_worker_id updated');

-- ============================================================================
-- F. rename_crew.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0330-0330-0330-700000000330"}';
select throws_ok(
  $$ select public.rename_crew('c1000000-0330-0330-0330-c10000000330', '   ') $$,
  '22023', null, 'a blank crew name is refused');
select ok(
  (select public.rename_crew('c1000000-0330-0330-0330-c10000000330', 'ทีมปูนใหม่')) is not null,
  'PM renames ทีมปูน');
reset role;
select is(
  (select name from public.crews where id = 'c1000000-0330-0330-0330-c10000000330'),
  'ทีมปูนใหม่', 'crew name updated (trimmed)');

-- ============================================================================
-- G. dissolve_crew — deactivates + closes memberships; add refused after.
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0330-0330-0330-700000000330"}';
select ok(
  (select public.dissolve_crew('c1000000-0330-0330-0330-c10000000330')) is not null,
  'PM dissolves ทีมปูนใหม่');
reset role;
select is(
  (select active from public.crews where id = 'c1000000-0330-0330-0330-c10000000330'),
  false, 'dissolved crew is inactive');
select is(
  (select count(*)::int from public.crew_members
    where crew_id = 'c1000000-0330-0330-0330-c10000000330' and removed_at is null),
  0, 'dissolving closed every active membership');

set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0330-0330-0330-700000000330"}';
select throws_ok(
  $$ select public.add_worker_to_crew('c1000000-0330-0330-0330-c10000000330',
       'e2000000-0330-0330-0330-e20000000330') $$,
  '22023', null, 'adding into a dissolved crew is refused');
select ok(
  (select public.dissolve_crew('c1000000-0330-0330-0330-c10000000330')) is not null,
  're-dissolving is a friendly no-op');
reset role;

-- ============================================================================
-- G2. Unknown-crew P0002 paths (coverage: not-found before any mutation).
-- ============================================================================
set local role authenticated;
set local "request.jwt.claims" = '{"sub": "70000000-0330-0330-0330-700000000330"}';
select throws_ok(
  $$ select public.rename_crew('99999999-9999-9999-9999-999999999999', 'ทีมผี') $$,
  'P0002', null, 'renaming an unknown crew is refused');
select throws_ok(
  $$ select public.dissolve_crew('99999999-9999-9999-9999-999999999999') $$,
  'P0002', null, 'dissolving an unknown crew is refused');
select throws_ok(
  $$ select public.set_crew_lead('99999999-9999-9999-9999-999999999999',
       'e1000000-0330-0330-0330-e10000000330') $$,
  'P0002', null, 'setting a lead on an unknown crew is refused');
reset role;

-- ============================================================================
-- H. Audit trail — the family writes audit_log crew_change rows.
-- ============================================================================
select ok(
  (select count(*) from public.audit_log
    where action = 'crew_change' and target_table = 'crew_members') > 0,
  'membership changes write audit_log crew_change rows');
select ok(
  (select count(*) from public.audit_log
    where action = 'crew_change' and target_table = 'crews'
      and payload->>'op' in ('set_lead','rename','dissolve')) > 0,
  'crew lifecycle changes write audit_log crew_change rows');

select * from finish();
rollback;
