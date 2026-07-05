begin;
select plan(10);

-- ============================================================================
-- Spec 160 U3 / ADR 0061 (invariant 5/6) — the portal as the worker's home.
--   get_my_crew_assignments() (SECURITY DEFINER) surfaces, for the caller's OWN
--   crew only (workers.contractor_id = current_user_contractor_id(), ADR 0051),
--   each member's current project (U1 workers.project_id) with the assigned
--   project's code/name resolved past the staff-scoped projects RLS. An unbound
--   / staff caller sees ZERO rows; no contractor sees another's crew. Coins are
--   NOT here (ADR 0060 §4 externals-invisible + gift-first) — record, not coin.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('a1000000-0000-4000-8000-000000000197', 'ua@crew.local',  '{}'::jsonb),
  ('b1000000-0000-4000-8000-000000000197', 'ub@crew.local',  '{}'::jsonb),
  ('51000000-0000-4000-8000-000000000197', 'sup@crew.local', '{}'::jsonb);
update public.users set role='super_admin' where id='51000000-0000-4000-8000-000000000197';

insert into public.contractors (id, name, created_by) values
  ('aa000000-0000-4000-8000-000000000197', 'ผู้รับเหมา ก', '51000000-0000-4000-8000-000000000197'),
  ('bb000000-0000-4000-8000-000000000197', 'ผู้รับเหมา ข', '51000000-0000-4000-8000-000000000197');

-- Bind uA→A, uB→B and flip them to the contractor role (a claimed invite).
insert into public.contractor_users (user_id, contractor_id) values
  ('a1000000-0000-4000-8000-000000000197', 'aa000000-0000-4000-8000-000000000197'),
  ('b1000000-0000-4000-8000-000000000197', 'bb000000-0000-4000-8000-000000000197');
update public.users set role='contractor'
  where id in ('a1000000-0000-4000-8000-000000000197', 'b1000000-0000-4000-8000-000000000197');

insert into public.projects (id, code, name) values
  ('c0000000-0000-4000-8000-000000000197', 'PRC-197-P1', 'โครงการหนึ่ง');

-- Worker A is ASSIGNED to the project; Worker B is unassigned (null project).
insert into public.workers (id, name, pay_type, employment_type, contractor_id, user_id, day_rate, active, project_id, created_by) values
  ('a2000000-0000-4000-8000-000000000197', 'ช่าง ก', 'daily', 'permanent', 'aa000000-0000-4000-8000-000000000197', null, 0, true,
   'c0000000-0000-4000-8000-000000000197', '51000000-0000-4000-8000-000000000197'),
  ('b2000000-0000-4000-8000-000000000197', 'ช่าง ข', 'daily', 'permanent', 'bb000000-0000-4000-8000-000000000197', null, 0, true,
   null, '51000000-0000-4000-8000-000000000197');

-- A. Catalog (as owner).
select ok(to_regprocedure('public.get_my_crew_assignments()') is not null,
  'get_my_crew_assignments() exists');
select is((select prosecdef from pg_proc
            where oid='public.get_my_crew_assignments()'::regprocedure),
  true, 'get_my_crew_assignments is SECURITY DEFINER');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

set local role authenticated;

-- B. Contractor A sees only their own crew, with the project resolved.
set local "request.jwt.claims" = '{"sub": "a1000000-0000-4000-8000-000000000197"}';
select is(
  (select count(*)::int from public.get_my_crew_assignments()),
  1, 'contractor A sees exactly their one crew member');
select is(
  (select worker_id from public.get_my_crew_assignments()),
  'a2000000-0000-4000-8000-000000000197'::uuid, 'it is worker A');
select is(
  (select project_code from public.get_my_crew_assignments()),
  'PRC-197-P1', 'the assigned project code is resolved');
select is(
  (select project_name from public.get_my_crew_assignments()),
  'โครงการหนึ่ง', 'the assigned project name is resolved past projects RLS');
select is(
  (select count(*)::int from public.get_my_crew_assignments()
     where worker_id='b2000000-0000-4000-8000-000000000197'),
  0, 'contractor A never sees contractor B''s crew');

-- C. Contractor B sees only their own crew; unassigned → null project.
set local "request.jwt.claims" = '{"sub": "b1000000-0000-4000-8000-000000000197"}';
select is(
  (select worker_id from public.get_my_crew_assignments()),
  'b2000000-0000-4000-8000-000000000197'::uuid, 'contractor B sees worker B');
select is(
  (select project_name from public.get_my_crew_assignments()),
  null, 'an unassigned crew member resolves to a null project');

-- D. A staff / unbound caller has no contractor binding → zero rows.
set local "request.jwt.claims" = '{"sub": "51000000-0000-4000-8000-000000000197"}';
select is(
  (select count(*)::int from public.get_my_crew_assignments()),
  0, 'an unbound (staff) caller sees zero crew rows');

reset role;

select * from finish();
rollback;
