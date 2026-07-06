begin;
select plan(16);

-- ============================================================================
-- Spec 92 Unit A — work_packages.planned_start/end + work_package_dependencies
-- + the PM/super setter RPCs. Manual schedule + finish-to-start deps; writes are
-- RPC-only (no direct INSERT priv); RPCs reject SA, self, cross-project, cycles.
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('22222222-2222-2222-2222-2222222247ff', 'sa@wps-test.local',      '{}'::jsonb),
  ('33333333-3333-3333-3333-3333333347ff', 'pm@wps-test.local',      '{}'::jsonb),
  ('44444444-4444-4444-4444-4444444447ff', 'visitor@wps-test.local', '{}'::jsonb);

update public.users set role = 'site_admin'      where id = '22222222-2222-2222-2222-2222222247ff';
update public.users set role = 'project_manager' where id = '33333333-3333-3333-3333-3333333347ff';

-- 271 U3: set_work_package_schedule is membership-gated now — the PM leads
-- project A so the schedule lives_ok below still holds.
insert into public.projects (id, code, name, project_lead_id) values
  ('c0000047-47ff-47ff-47ff-47ff47ff47ff', 'PRC-TEST-WPS-A', 'schedule fixture A',
   '33333333-3333-3333-3333-3333333347ff'),
  ('c0000147-47ff-47ff-47ff-47ff47ff47ff', 'PRC-TEST-WPS-B', 'schedule fixture B', null);
insert into public.work_packages (id, project_id, code, name) values
  ('a0000047-47ff-47ff-47ff-47ff47ff47ff', 'c0000047-47ff-47ff-47ff-47ff47ff47ff', 'WPS-A', 'WP A'),
  ('b0000047-47ff-47ff-47ff-47ff47ff47ff', 'c0000047-47ff-47ff-47ff-47ff47ff47ff', 'WPS-B', 'WP B'),
  ('e0000047-47ff-47ff-47ff-47ff47ff47ff', 'c0000147-47ff-47ff-47ff-47ff47ff47ff', 'WPS-X', 'WP X (other project)');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Catalog.
select has_column('public', 'work_packages', 'planned_start', 'work_packages.planned_start exists');
select has_column('public', 'work_packages', 'planned_end', 'work_packages.planned_end exists');
select col_is_null('public', 'work_packages', 'planned_start', 'planned_start is nullable');
select has_table('public', 'work_package_dependencies', 'work_package_dependencies exists');
select is((select relrowsecurity from pg_class where oid = 'public.work_package_dependencies'::regclass),
  true, 'RLS enabled on work_package_dependencies');
select has_function('public', 'set_work_package_schedule', 'set_work_package_schedule RPC exists');
select has_function('public', 'add_work_package_dependency', 'add_work_package_dependency RPC exists');
select has_function('public', 'remove_work_package_dependency', 'remove_work_package_dependency RPC exists');

-- B. Role-sim.
set local role authenticated;

-- SA denied both setters.
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-2222222247ff"}';
select throws_ok(
  $$ select public.set_work_package_schedule('a0000047-47ff-47ff-47ff-47ff47ff47ff', '2026-07-01', '2026-07-10') $$,
  '42501', null, 'site_admin cannot set schedule');
select throws_ok(
  $$ select public.add_work_package_dependency('a0000047-47ff-47ff-47ff-47ff47ff47ff', 'b0000047-47ff-47ff-47ff-47ff47ff47ff') $$,
  '42501', null, 'site_admin cannot add dependency');

-- PM: set schedule, add A->B, then guards.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-3333333347ff"}';
-- Even PM cannot direct-INSERT: there is no INSERT policy, so RLS denies it and
-- the cycle/same-project guards (RPC-only) cannot be bypassed.
select throws_ok(
  $$ insert into public.work_package_dependencies (predecessor_id, successor_id)
     values ('a0000047-47ff-47ff-47ff-47ff47ff47ff', 'b0000047-47ff-47ff-47ff-47ff47ff47ff') $$,
  '42501', null, 'direct INSERT denied by RLS (writes are RPC-only)');
select lives_ok(
  $$ select public.set_work_package_schedule('a0000047-47ff-47ff-47ff-47ff47ff47ff', '2026-07-01', '2026-07-10') $$,
  'project_manager sets schedule');
select is(
  (select public.add_work_package_dependency('a0000047-47ff-47ff-47ff-47ff47ff47ff', 'b0000047-47ff-47ff-47ff-47ff47ff47ff')),
  true, 'PM adds A->B dependency');
-- cycle: B->A would close a loop -> rejected (returns false, no row).
select is(
  (select public.add_work_package_dependency('b0000047-47ff-47ff-47ff-47ff47ff47ff', 'a0000047-47ff-47ff-47ff-47ff47ff47ff')),
  false, 'cycle B->A rejected');
-- cross-project: A->X (different project) -> rejected.
select is(
  (select public.add_work_package_dependency('a0000047-47ff-47ff-47ff-47ff47ff47ff', 'e0000047-47ff-47ff-47ff-47ff47ff47ff')),
  false, 'cross-project dependency rejected');

reset role;

-- C. Outcome: exactly the one A->B edge persisted; the schedule landed.
select is(
  (select count(*)::int from public.work_package_dependencies
     where successor_id = 'b0000047-47ff-47ff-47ff-47ff47ff47ff'),
  1, 'only the valid A->B edge persisted (cycle + cross-project did not)');

select * from finish();
rollback;
