begin;
select plan(14);

-- ============================================================================
-- Spec 161 U2b / ADR 0060 §1 — HT (Head Technician) assignment. A project has
--   exactly one HT (a promoted, active DC), so projects.ht_worker_id is a single
--   nullable column (the one-per-project rule). assign_project_ht is the PM's
--   tool (pm + director + super; director rides along per ADR 0058) and validates
--   the worker is an active DC; assigning again overwrites (last-wins). Audited.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110200', 'super@ht.local', '{}'::jsonb),
  ('55555555-5555-5555-5555-555555550200', 'dir@ht.local',   '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330200', 'pm@ht.local',    '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220200', 'sa@ht.local',    '{}'::jsonb),
  ('88888888-8888-8888-8888-888888880200', 'vis@ht.local',   '{}'::jsonb);
update public.users set role='super_admin'     where id='11111111-1111-1111-1111-111111110200';
update public.users set role='project_director' where id='55555555-5555-5555-5555-555555550200';
update public.users set role='project_manager' where id='33333333-3333-3333-3333-333333330200';
update public.users set role='site_admin'      where id='22222222-2222-2222-2222-222222220200';
-- '8888…' stays visitor.

insert into public.projects (id, code, name) values
  ('a1a10200-0200-0200-0200-a1a1a1a10200', 'PRC-200-P1', 'โครงการ');

-- Two active DCs (eligible), an 'own' tech (not a DC), and an inactive DC.
insert into public.workers (id, name, worker_type, contractor_id, user_id, day_rate, active, created_by) values
  ('dc010200-0200-0200-0200-dcdcdcdc0200', 'DC ก', 'dc',  null, null, 0, true,
   '11111111-1111-1111-1111-111111110200'),
  ('dc020200-0200-0200-0200-dcdcdcdc0200', 'DC ข', 'dc',  null, null, 0, true,
   '11111111-1111-1111-1111-111111110200'),
  ('0a010200-0200-0200-0200-0a0a0a0a0200', 'ช่างบริษัท', 'own', null, null, 0, true,
   '11111111-1111-1111-1111-111111110200'),
  ('dcff0200-0200-0200-0200-dcffdcff0200', 'DC พักงาน', 'dc', null, null, 0, false,
   '11111111-1111-1111-1111-111111110200');

-- A. Catalog (as owner).
select has_column('public', 'projects', 'ht_worker_id', 'projects has ht_worker_id');
select col_type_is('public', 'projects', 'ht_worker_id', 'uuid', 'ht_worker_id is uuid');
select fk_ok('public', 'projects', 'ht_worker_id', 'public', 'workers', 'id',
  'ht_worker_id FK references workers.id');
select is((select prosecdef from pg_proc
            where oid='public.assign_project_ht(uuid,uuid)'::regprocedure),
  true, 'assign_project_ht is SECURITY DEFINER');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;

-- B. PM assigns an active DC; director overwrites (one-per-project, last-wins).
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330200"}';
select lives_ok(
  $$ select public.assign_project_ht('a1a10200-0200-0200-0200-a1a1a1a10200',
       'dc010200-0200-0200-0200-dcdcdcdc0200') $$,
  'project_manager assigns an active DC as HT');
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555550200"}';
select lives_ok(
  $$ select public.assign_project_ht('a1a10200-0200-0200-0200-a1a1a1a10200',
       'dc020200-0200-0200-0200-dcdcdcdc0200') $$,
  'project_director re-assigns the HT (overwrites)');

-- C. Role gate.
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220200"}';
select throws_ok(
  $$ select public.assign_project_ht('a1a10200-0200-0200-0200-a1a1a1a10200',
       'dc010200-0200-0200-0200-dcdcdcdc0200') $$,
  '42501', null, 'site_admin cannot assign an HT');
set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888880200"}';
select throws_ok(
  $$ select public.assign_project_ht('a1a10200-0200-0200-0200-a1a1a1a10200',
       'dc010200-0200-0200-0200-dcdcdcdc0200') $$,
  '42501', null, 'visitor cannot assign an HT');

-- D. The HT must be an active DC; the project + worker must exist.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330200"}';
select throws_ok(
  $$ select public.assign_project_ht('a1a10200-0200-0200-0200-a1a1a1a10200',
       '0a010200-0200-0200-0200-0a0a0a0a0200') $$,
  'P0001', null, 'an own (non-DC) worker cannot be HT');
select throws_ok(
  $$ select public.assign_project_ht('a1a10200-0200-0200-0200-a1a1a1a10200',
       'dcff0200-0200-0200-0200-dcffdcff0200') $$,
  'P0001', null, 'an inactive DC cannot be HT');
select throws_ok(
  $$ select public.assign_project_ht('dddddddd-0200-0200-0200-dddddddd0200',
       'dc010200-0200-0200-0200-dcdcdcdc0200') $$,
  'P0001', null, 'an unknown project is rejected');
select throws_ok(
  $$ select public.assign_project_ht('a1a10200-0200-0200-0200-a1a1a1a10200',
       'eeeeeeee-0200-0200-0200-eeeeeeee0200') $$,
  'P0001', null, 'an unknown worker is rejected');

reset role;

-- E. The current HT is the director's overwrite; both successful assigns audited.
select is(
  (select ht_worker_id from public.projects where id='a1a10200-0200-0200-0200-a1a1a1a10200'),
  'dc020200-0200-0200-0200-dcdcdcdc0200'::uuid, 'the current HT is the last one assigned');
select is(
  (select count(*)::int from public.audit_log
     where target_table='projects'
       and target_id='a1a10200-0200-0200-0200-a1a1a1a10200'
       and payload->>'field'='ht_worker_id'),
  2, 'both successful assignments were audited');

select * from finish();
rollback;
