begin;
select plan(24);

-- ============================================================================
-- Spec 160 U1 / ADR 0061 (invariant 1) — DC as a durable person + project
--   assignment. workers gains a nullable current project_id (FK -> projects);
--   the DC-contractor force-tie (CHECK workers_dc_has_contractor) is DROPPED
--   (a DC may now have a null contractor), while workers_own_has_no_contractor
--   stays. worker_project_moves is an append-only move stream (RLS on, zero
--   write grant — RPC-only, no UPDATE/DELETE). assign_worker_to_project
--   (SECURITY DEFINER, pm/super only -> else 42501) sets workers.project_id,
--   appends a move row + an audit_log row in one tx; moving again appends a
--   second move row (history grows). NO economics here — the spine only.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110160', 'super@wpa-test.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220160', 'sa@wpa-test.local',    '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330160', 'pm@wpa-test.local',    '{}'::jsonb),
  ('88888888-8888-8888-8888-888888880160', 'vis@wpa-test.local',   '{}'::jsonb);

update public.users set role='super_admin'     where id='11111111-1111-1111-1111-111111110160';
update public.users set role='site_admin'      where id='22222222-2222-2222-2222-222222220160';
update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333330160';
-- '8888…' stays visitor.

insert into public.projects (id, code, name) values
  ('a1a10160-0160-0160-0160-a1a1a1a10160', 'PRC-160-P1', 'โครงการหนึ่ง'),
  ('a2a20160-0160-0160-0160-a2a2a2a20160', 'PRC-160-P2', 'โครงการสอง');

-- The DC we will assign — created (as the migration/owner role) with a NULL
-- contractor, which the relaxed CHECK now allows.
insert into public.workers (id, name, pay_type, employment_type, contractor_id, user_id, day_rate, active, created_by)
  values ('aaaa0160-0160-0160-0160-aaaaaaaa0160', 'DC ก', 'daily', 'permanent', null, null, 450.00, true,
          '11111111-1111-1111-1111-111111110160');

-- ---------------------------------------------------------------------------
-- A. Catalog — workers.project_id column + FK.
-- ---------------------------------------------------------------------------
select has_column('public', 'workers', 'project_id', 'workers has a project_id column');
select col_type_is('public', 'workers', 'project_id', 'uuid', 'workers.project_id is uuid');
select fk_ok('public', 'workers', 'project_id', 'public', 'projects', 'id',
  'workers.project_id FK references projects.id');

-- B. Catalog — worker_project_moves append-only stream.
select has_table('public', 'worker_project_moves', 'worker_project_moves table exists');
select has_column('public', 'worker_project_moves', 'worker_id', 'has worker_id');
select has_column('public', 'worker_project_moves', 'project_id', 'has project_id (nullable = unassigned)');
select has_column('public', 'worker_project_moves', 'moved_at', 'has moved_at');
select has_column('public', 'worker_project_moves', 'moved_by', 'has moved_by');
select fk_ok('public', 'worker_project_moves', 'worker_id', 'public', 'workers', 'id',
  'worker_project_moves.worker_id FK references workers.id');
select fk_ok('public', 'worker_project_moves', 'project_id', 'public', 'projects', 'id',
  'worker_project_moves.project_id FK references projects.id');
-- Append-only + zero write grant (RPC-only): no UPDATE/DELETE/INSERT privilege.
select ok(not has_table_privilege('authenticated', 'public.worker_project_moves', 'UPDATE'),
  'authenticated has no UPDATE privilege on worker_project_moves');
select ok(not has_table_privilege('authenticated', 'public.worker_project_moves', 'DELETE'),
  'authenticated has no DELETE privilege on worker_project_moves');
select ok(not has_table_privilege('authenticated', 'public.worker_project_moves', 'INSERT'),
  'authenticated has no INSERT privilege on worker_project_moves (RPC-only)');

-- C. The DC-contractor force-tie is DROPPED (workers_own_has_no_contractor was
-- dropped later by the spec 266 worker-identity merge; not re-asserted here).
select is(
  (select count(*)::int from pg_constraint where conname='workers_dc_has_contractor'),
  0, 'CHECK workers_dc_has_contractor is dropped');
-- Behavioral: a dc worker now inserts with a NULL contractor (was 23514).
select lives_ok(
  $$ insert into public.workers (name, pay_type, employment_type, contractor_id, day_rate, created_by)
     values ('DC ข', 'daily', 'permanent', null, 400.00, '11111111-1111-1111-1111-111111110160') $$,
  'a dc worker inserts with a null contractor (relaxed CHECK)');

-- D. The RPC.
select is((select prosecdef from pg_proc
            where oid='public.assign_worker_to_project(uuid,uuid,text)'::regprocedure),
  true, 'assign_worker_to_project is SECURITY DEFINER');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;

-- E. pm assigns the DC to P1 -> project_id set, move row + audit row appended.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330160"}';
select lives_ok(
  $$ select public.assign_worker_to_project(
       'aaaa0160-0160-0160-0160-aaaaaaaa0160',
       'a1a10160-0160-0160-0160-a1a1a1a10160', 'งานแรก') $$,
  'project_manager assigns a DC to a project');
select is(
  (select project_id from public.workers where id='aaaa0160-0160-0160-0160-aaaaaaaa0160'),
  'a1a10160-0160-0160-0160-a1a1a1a10160'::uuid,
  'workers.project_id is set to the assigned project');
select is(
  (select count(*)::int from public.worker_project_moves
     where worker_id='aaaa0160-0160-0160-0160-aaaaaaaa0160'),
  1, 'a worker_project_moves row was appended');
select is(
  (select count(*)::int from public.audit_log
     where target_id='aaaa0160-0160-0160-0160-aaaaaaaa0160'
       and payload->>'kind'='project_move'),
  1, 'an audit_log row recorded the move');

-- F. Role gate — site_admin and visitor are denied (42501).
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220160"}';
select throws_ok(
  $$ select public.assign_worker_to_project(
       'aaaa0160-0160-0160-0160-aaaaaaaa0160',
       'a2a20160-0160-0160-0160-a2a2a2a20160', null) $$,
  '42501', null, 'site_admin denied');
set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888880160"}';
select throws_ok(
  $$ select public.assign_worker_to_project(
       'aaaa0160-0160-0160-0160-aaaaaaaa0160',
       'a2a20160-0160-0160-0160-a2a2a2a20160', null) $$,
  '42501', null, 'visitor denied');

-- G. super_admin moves the DC again -> history grows to two rows.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110160"}';
select lives_ok(
  $$ select public.assign_worker_to_project(
       'aaaa0160-0160-0160-0160-aaaaaaaa0160',
       'a2a20160-0160-0160-0160-a2a2a2a20160', 'ย้ายโครงการ') $$,
  'super_admin moves the DC to another project');
select is(
  (select count(*)::int from public.worker_project_moves
     where worker_id='aaaa0160-0160-0160-0160-aaaaaaaa0160'),
  2, 'the move history grew to two rows (append-only stream)');

reset role;

select * from finish();
rollback;
