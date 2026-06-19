begin;
select plan(13);

-- ============================================================================
-- Spec 155 / ADR 0059 — set_work_package_deliverable(p_work_package_id,
--   p_deliverable_id). SECURITY DEFINER; PM/super/project_director, membership-
--   gated (can_see_wp). NULL = ungroup. A non-null deliverable must share the
--   WP's project (cross-project / unknown → 22023). site_admin + visitor denied
--   by role (42501); a non-member PM denied by membership (42501).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110155', 'super@wpd-test.local',  '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220155', 'sa@wpd-test.local',     '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330155', 'pmlead@wpd-test.local', '{}'::jsonb),
  ('55555555-5555-5555-5555-555555550155', 'dir@wpd-test.local',    '{}'::jsonb),
  ('66666666-6666-6666-6666-666666660155', 'pmoth@wpd-test.local',  '{}'::jsonb),
  ('88888888-8888-8888-8888-888888880155', 'vis@wpd-test.local',    '{}'::jsonb);

update public.users set role='super_admin'      where id='11111111-1111-1111-1111-111111110155';
update public.users set role='site_admin'       where id='22222222-2222-2222-2222-222222220155';
update public.users set role='project_manager'  where id='33333333-3333-3333-3333-333333330155';
update public.users set role='project_director'  where id='55555555-5555-5555-5555-555555550155';
update public.users set role='project_manager'  where id='66666666-6666-6666-6666-666666660155';
-- '8888…' stays visitor.

-- P1: pm_lead (3333) is the lead → a member. site_admin (2222) is added as a
-- member (to prove ROLE denial despite membership). pm_other (6666) is NOT on P1.
insert into public.projects (id, code, name, project_lead_id) values
  ('a1a10155-0155-0155-0155-a1a1a1a10155', 'PRC-155-P1', 'โครงการหนึ่ง',
   '33333333-3333-3333-3333-333333330155'),
  ('a2a20155-0155-0155-0155-a2a2a2a20155', 'PRC-155-P2', 'โครงการสอง', null);
insert into public.project_members (project_id, user_id, added_by) values
  ('a1a10155-0155-0155-0155-a1a1a1a10155',
   '22222222-2222-2222-2222-222222220155', '11111111-1111-1111-1111-111111110155');
insert into public.deliverables (id, project_id, code, name, sort_order) values
  ('d1d10155-0155-0155-0155-d1d1d1d10155', 'a1a10155-0155-0155-0155-a1a1a1a10155', 'D01', 'งวดงานหนึ่ง', 1),
  ('d2d20155-0155-0155-0155-d2d2d2d20155', 'a2a20155-0155-0155-0155-a2a2a2a20155', 'D01', 'งวดอื่น', 1);
insert into public.work_packages (id, project_id, code, name) values
  ('c1c10155-0155-0155-0155-c1c1c1c10155', 'a1a10155-0155-0155-0155-a1a1a1a10155', 'WP-1', 'งานหนึ่ง');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Catalog.
select ok(to_regprocedure('public.set_work_package_deliverable(uuid,uuid)') is not null,
  'set_work_package_deliverable(uuid,uuid) exists');
select is((select prosecdef from pg_proc
            where oid='public.set_work_package_deliverable(uuid,uuid)'::regprocedure),
  true, 'set_work_package_deliverable is SECURITY DEFINER');

set local role authenticated;

-- B.1 pm_lead (member) binds WP1 → D1 → true, deliverable_id set.
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330155"}';
select is(
  (select public.set_work_package_deliverable(
     'c1c10155-0155-0155-0155-c1c1c1c10155', 'd1d10155-0155-0155-0155-d1d1d1d10155')),
  true, 'project_manager member binds a WP to a deliverable');
select is(
  (select deliverable_id::text from public.work_packages where id='c1c10155-0155-0155-0155-c1c1c1c10155'),
  'd1d10155-0155-0155-0155-d1d1d1d10155', 'the WP is now bound to D1');

-- B.2 pm_lead clears (NULL = ungroup) → true, deliverable_id null.
select is(
  (select public.set_work_package_deliverable(
     'c1c10155-0155-0155-0155-c1c1c1c10155', null)),
  true, 'NULL clears the deliverable (ungroup)');
select ok(
  (select deliverable_id is null from public.work_packages where id='c1c10155-0155-0155-0155-c1c1c1c10155'),
  'the WP is now ungrouped');

-- B.3 cross-project deliverable rejected (22023).
select throws_ok(
  $$ select public.set_work_package_deliverable(
       'c1c10155-0155-0155-0155-c1c1c1c10155', 'd2d20155-0155-0155-0155-d2d2d2d20155') $$,
  '22023', null, 'a deliverable from another project is rejected');

-- B.4 unknown deliverable rejected (22023).
select throws_ok(
  $$ select public.set_work_package_deliverable(
       'c1c10155-0155-0155-0155-c1c1c1c10155', '00000000-0000-0000-0000-000000000155') $$,
  '22023', null, 'an unknown deliverable is rejected');

-- B.5 super_admin binds (see-all) → true.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110155"}';
select is(
  (select public.set_work_package_deliverable(
     'c1c10155-0155-0155-0155-c1c1c1c10155', 'd1d10155-0155-0155-0155-d1d1d1d10155')),
  true, 'super_admin binds (see-all)');

-- B.6 project_director binds (see-all) → true.
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555550155"}';
select is(
  (select public.set_work_package_deliverable(
     'c1c10155-0155-0155-0155-c1c1c1c10155', null)),
  true, 'project_director binds (see-all)');

-- B.7 site_admin (a MEMBER) denied by role (42501).
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220155"}';
select throws_ok(
  $$ select public.set_work_package_deliverable(
       'c1c10155-0155-0155-0155-c1c1c1c10155', 'd1d10155-0155-0155-0155-d1d1d1d10155') $$,
  '42501', null, 'a site_admin member is denied by role');

-- B.8 visitor denied (42501).
set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888880155"}';
select throws_ok(
  $$ select public.set_work_package_deliverable(
       'c1c10155-0155-0155-0155-c1c1c1c10155', 'd1d10155-0155-0155-0155-d1d1d1d10155') $$,
  '42501', null, 'visitor denied');

-- B.9 a project_manager NOT on the project denied by membership (42501).
set local "request.jwt.claims" = '{"sub": "66666666-6666-6666-6666-666666660155"}';
select throws_ok(
  $$ select public.set_work_package_deliverable(
       'c1c10155-0155-0155-0155-c1c1c1c10155', 'd1d10155-0155-0155-0155-d1d1d1d10155') $$,
  '42501', null, 'a non-member project_manager denied by membership');

reset role;

select * from finish();
rollback;
