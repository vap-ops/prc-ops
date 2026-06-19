begin;
select plan(11);

-- ============================================================================
-- Spec 156 / ADR 0059 — set_work_package_name(p_work_package_id, p_name).
--   SECURITY DEFINER; PM/super/project_director, membership-gated (can_see_wp).
--   Name trimmed, non-empty, <= 200 chars (else 22023). site_admin + visitor
--   denied by role (42501); a non-member PM denied by membership (42501).
-- ============================================================================

insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111110156', 'super@wpn-test.local',  '{}'::jsonb),
  ('22222222-2222-2222-2222-222222220156', 'sa@wpn-test.local',     '{}'::jsonb),
  ('33333333-3333-3333-3333-333333330156', 'pmlead@wpn-test.local', '{}'::jsonb),
  ('55555555-5555-5555-5555-555555550156', 'dir@wpn-test.local',    '{}'::jsonb),
  ('66666666-6666-6666-6666-666666660156', 'pmoth@wpn-test.local',  '{}'::jsonb),
  ('88888888-8888-8888-8888-888888880156', 'vis@wpn-test.local',    '{}'::jsonb);

update public.users set role='super_admin'      where id='11111111-1111-1111-1111-111111110156';
update public.users set role='site_admin'       where id='22222222-2222-2222-2222-222222220156';
update public.users set role='project_manager'  where id='33333333-3333-3333-3333-333333330156';
update public.users set role='project_director'  where id='55555555-5555-5555-5555-555555550156';
update public.users set role='project_manager'  where id='66666666-6666-6666-6666-666666660156';
-- '8888…' stays visitor.

-- pm_lead (3333) is the lead → a member. site_admin (2222) is added as a member
-- (proves ROLE denial despite membership). pm_other (6666) is NOT on the project.
insert into public.projects (id, code, name, project_lead_id) values
  ('a1a10156-0156-0156-0156-a1a1a1a10156', 'PRC-156-P1', 'โครงการ',
   '33333333-3333-3333-3333-333333330156');
insert into public.project_members (project_id, user_id, added_by) values
  ('a1a10156-0156-0156-0156-a1a1a1a10156',
   '22222222-2222-2222-2222-222222220156', '11111111-1111-1111-1111-111111110156');
insert into public.work_packages (id, project_id, code, name) values
  ('c1c10156-0156-0156-0156-c1c1c1c10156', 'a1a10156-0156-0156-0156-a1a1a1a10156', 'WP-1', 'ชื่อเดิม');

grant insert on _tap_buf to authenticated;
grant select on _tap_buf to authenticated;
grant usage  on sequence _tap_buf_ord_seq to authenticated;

-- A. Catalog.
select ok(to_regprocedure('public.set_work_package_name(uuid,text)') is not null,
  'set_work_package_name(uuid,text) exists');
select is((select prosecdef from pg_proc
            where oid='public.set_work_package_name(uuid,text)'::regprocedure),
  true, 'set_work_package_name is SECURITY DEFINER');

set local role authenticated;

-- B.1 pm_lead (member) renames WP1 → true, name updated (trims).
set local "request.jwt.claims" = '{"sub": "33333333-3333-3333-3333-333333330156"}';
select is(
  (select public.set_work_package_name('c1c10156-0156-0156-0156-c1c1c1c10156', '  งานใหม่  ')),
  true, 'project_manager member renames the WP');
select is(
  (select name from public.work_packages where id='c1c10156-0156-0156-0156-c1c1c1c10156'),
  'งานใหม่', 'the name was updated and trimmed');

-- B.2 blank name rejected (22023).
select throws_ok(
  $$ select public.set_work_package_name('c1c10156-0156-0156-0156-c1c1c1c10156', '   ') $$,
  '22023', null, 'a blank name is rejected');

-- B.3 over-long name (> 200) rejected (22023).
select throws_ok(
  $$ select public.set_work_package_name('c1c10156-0156-0156-0156-c1c1c1c10156', repeat('x', 201)) $$,
  '22023', null, 'an over-long name is rejected');

-- B.4 super_admin renames (see-all) → true.
set local "request.jwt.claims" = '{"sub": "11111111-1111-1111-1111-111111110156"}';
select is(
  (select public.set_work_package_name('c1c10156-0156-0156-0156-c1c1c1c10156', 'โดยซุปเปอร์')),
  true, 'super_admin renames (see-all)');

-- B.5 project_director renames (see-all) → true.
set local "request.jwt.claims" = '{"sub": "55555555-5555-5555-5555-555555550156"}';
select is(
  (select public.set_work_package_name('c1c10156-0156-0156-0156-c1c1c1c10156', 'โดยไดเรกเตอร์')),
  true, 'project_director renames (see-all)');

-- B.6 site_admin (a MEMBER) denied by role (42501).
set local "request.jwt.claims" = '{"sub": "22222222-2222-2222-2222-222222220156"}';
select throws_ok(
  $$ select public.set_work_package_name('c1c10156-0156-0156-0156-c1c1c1c10156', 'โดยหน้างาน') $$,
  '42501', null, 'a site_admin member is denied by role');

-- B.7 visitor denied (42501).
set local "request.jwt.claims" = '{"sub": "88888888-8888-8888-8888-888888880156"}';
select throws_ok(
  $$ select public.set_work_package_name('c1c10156-0156-0156-0156-c1c1c1c10156', 'โดยวิสิเตอร์') $$,
  '42501', null, 'visitor denied');

-- B.8 a project_manager NOT on the project denied by membership (42501).
set local "request.jwt.claims" = '{"sub": "66666666-6666-6666-6666-666666660156"}';
select throws_ok(
  $$ select public.set_work_package_name('c1c10156-0156-0156-0156-c1c1c1c10156', 'โดยพีเอ็มอื่น') $$,
  '42501', null, 'a non-member project_manager denied by membership');

reset role;

select * from finish();
rollback;
