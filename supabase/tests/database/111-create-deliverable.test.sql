begin;
select plan(14);

-- ============================================================================
-- Spec 164 U1 / ADR 0016 — create_deliverable(p_project_id, p_code, p_name).
--   SECURITY DEFINER; role gate project_manager/super_admin/project_director
--   (42501 else), like create_work_package. Validates code (≤50) + name (≤200)
--   non-empty and project existence (22023). sort_order auto = max+1 per
--   project. Duplicate (project_id, code) → 23505.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110164', 'super@del-test.local', '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220164', 'sa@del-test.local',    '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330164', 'pm@del-test.local',    '{}'::jsonb),
  ('55555555-5555-5555-5555-555555550164', 'dir@del-test.local',   '{}'::jsonb),
  ('88888888-8888-8888-8888-888888880164', 'vis@del-test.local',   '{}'::jsonb);

update public.users set role='super_admin'     where id='11111111-1111-1111-1111-111111110164';
update public.users set role='site_admin'      where id='22222222-2222-2222-2222-222222220164';
update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333330164';
update public.users set role='project_director' where id='55555555-5555-5555-5555-555555550164';
-- '8888…' stays visitor.

-- pm (3333) is the project lead + a member so the membership-scoped
-- deliverables SELECT (spec 143 / ADR 0056) lets it read back the row it
-- created. create_deliverable itself is role-only (no membership gate).
insert into public.projects (id, code, name, project_lead_id) values
  ('a1640164-0164-0164-0164-a1a1a1a10164', 'PRC-164-P1', 'โครงการงวดงาน',
   '33333333-3333-3333-3333-333333330164');
insert into public.project_members (project_id, user_id, added_by) values
  ('a1640164-0164-0164-0164-a1a1a1a10164',
   '33333333-3333-3333-3333-333333330164', '11111111-1111-1111-1111-111111110164');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Catalog.
select ok(to_regprocedure('public.create_deliverable(uuid,text,text)') is not null,
  'create_deliverable(uuid,text,text) exists');
select is((select prosecdef from pg_proc
            where oid='public.create_deliverable(uuid,text,text)'::regprocedure),
  true, 'create_deliverable is SECURITY DEFINER');

set local role authenticated;

-- B. project_manager creates D01 → returns a uuid; row exists at sort_order 1.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330164"}';
select ok(
  public.create_deliverable('a1640164-0164-0164-0164-a1a1a1a10164', 'D01', 'งวดงานหนึ่ง') is not null,
  'project_manager creates D01');
select is(
  (select sort_order from public.deliverables
     where project_id='a1640164-0164-0164-0164-a1a1a1a10164' and code='D01'),
  1, 'first deliverable gets sort_order 1');

-- C. super_admin creates D02 → sort_order increments to 2.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110164"}';
select ok(
  public.create_deliverable('a1640164-0164-0164-0164-a1a1a1a10164', 'D02', 'งวดงานสอง') is not null,
  'super_admin creates D02');
select is(
  (select sort_order from public.deliverables
     where project_id='a1640164-0164-0164-0164-a1a1a1a10164' and code='D02'),
  2, 'second deliverable gets sort_order 2');

-- D. project_director creates D03 → sort_order 3.
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555550164"}';
select is(
  (select coalesce((public.create_deliverable(
     'a1640164-0164-0164-0164-a1a1a1a10164', 'D03', 'งวดงานสาม') is not null), false)),
  true, 'project_director creates D03');

-- E. duplicate (project_id, code) → 23505.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330164"}';
select throws_ok(
  $$ select public.create_deliverable('a1640164-0164-0164-0164-a1a1a1a10164', 'D01', 'ซ้ำ') $$,
  '23505', null, 'duplicate (project_id, code) rejected');

-- F. empty code → 22023.
select throws_ok(
  $$ select public.create_deliverable('a1640164-0164-0164-0164-a1a1a1a10164', '   ', 'ชื่อ') $$,
  '22023', null, 'empty code rejected');

-- G. code longer than 50 → 22023.
select throws_ok(
  format($$ select public.create_deliverable('a1640164-0164-0164-0164-a1a1a1a10164', %L, 'ชื่อ') $$,
         repeat('D', 51)),
  '22023', null, 'over-long code rejected');

-- H. empty name → 22023.
select throws_ok(
  $$ select public.create_deliverable('a1640164-0164-0164-0164-a1a1a1a10164', 'D09', '  ') $$,
  '22023', null, 'empty name rejected');

-- I. unknown project → 22023.
select throws_ok(
  $$ select public.create_deliverable('00000000-0000-0000-0000-000000000164', 'D01', 'ชื่อ') $$,
  '22023', null, 'unknown project rejected');

-- J. site_admin denied by role → 42501.
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220164"}';
select throws_ok(
  $$ select public.create_deliverable('a1640164-0164-0164-0164-a1a1a1a10164', 'D20', 'ชื่อ') $$,
  '42501', null, 'site_admin denied by role');

-- K. visitor denied → 42501.
set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888880164"}';
select throws_ok(
  $$ select public.create_deliverable('a1640164-0164-0164-0164-a1a1a1a10164', 'D21', 'ชื่อ') $$,
  '42501', null, 'visitor denied');

reset role;

select * from finish();
rollback;
